import type { StandardJSONSchemaV1 } from '@standard-schema/spec';

import { ComponentNameConflictError, UnsupportedSchemaError } from './errors.ts';
import { isJsonString, isObjectLike } from './json-value.ts';
import {
  type JSONSchema,
  type SchemaIO,
  type SchemaValue,
  type StandardSchema,
  isStandardJSONSchema,
} from './standard-schema.ts';

/** The JSON Schema dialect asked of the schema library. */
export type JSONSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0';

/**
 * Adjustments applied to converted JSON Schema so it reads as an idiomatic OpenAPI document.
 *
 * Each rule is opt-out on its own: they are conveniences, not corrections, and a document that wants
 * the schema library's output verbatim can switch any of them off.
 */
export interface NormalizationOptions {
  /**
   * Drop `additionalProperties: false`, which schema libraries emit for objects that strip unknown
   * keys. `additionalProperties: {}` from a permissive object is left alone.
   */
  readonly dropStrictAdditionalProperties?: boolean;
  /** Drop `pattern` when a `format` is present, since the format already implies it. */
  readonly dropFormatImpliedPatterns?: boolean;
  /** Collapse `anyOf: [<schema>, { type: 'null' }]` into a nullable type array. */
  readonly collapseNullableUnions?: boolean;
  /** Rewrite `const: <value>` as `enum: [<value>]`, which more OpenAPI tooling understands. */
  readonly constToEnum?: boolean;
  /**
   * Emit each schema's keywords in the conventional order — what a value is, then how it is
   * constrained, then how it is described — instead of the order the schema library happened to
   * produce, which varies with where the metadata was attached.
   */
  readonly orderKeywords?: boolean;
}

const DEFAULT_NORMALIZATION: Required<NormalizationOptions> = {
  dropStrictAdditionalProperties: true,
  dropFormatImpliedPatterns: true,
  collapseNullableUnions: true,
  constToEnum: true,
  orderKeywords: true,
};

/** The order OpenAPI documents conventionally present a schema's keywords in. */
const KEYWORD_ORDER = [
  '$ref',
  'type',
  'format',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'patternProperties',
  'required',
  'additionalProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'discriminator',
  'title',
  'description',
  'example',
  'examples',
  'default',
  'readOnly',
  'writeOnly',
  'deprecated',
];

const KEYWORD_RANK = new Map(KEYWORD_ORDER.map((keyword, index) => [keyword, index]));

/** Keywords whose values are data rather than subschemas, so the walk must not descend into them. */
const DATA_KEYWORDS = new Set(['example', 'examples', 'default', 'const', 'enum']);

const DEFINITIONS_KEYWORDS = ['$defs', 'definitions'] as const;

const COMPONENT_SCHEMAS_POINTER = '#/components/schemas';

/**
 * Collects the named schemas a document refers to.
 *
 * Names arrive from two places — a `$defs` key or an explicit `$id` — and both land here, so a schema
 * referenced from several routes is emitted once and shared.
 */
export class ComponentCollector {
  /** Reserved-but-not-yet-generated names hold `undefined`, which keeps their place in the order. */
  readonly #schemas = new Map<string, JSONSchema | undefined>();

  get schemas() {
    const generated: Record<string, JSONSchema> = {};
    for (const [name, schema] of this.#schemas) {
      if (schema != null) {
        generated[name] = schema;
      }
    }

    return generated;
  }

  has(name: string): boolean {
    return this.#schemas.get(name) != null;
  }

  /** Holds a place for a schema that is about to be generated, keeping the document's order stable. */
  reserve(name: string): void {
    if (!this.#schemas.has(name)) {
      this.#schemas.set(name, undefined);
    }
  }

  register(name: string, schema: JSONSchema): void {
    const existing = this.#schemas.get(name);
    if (existing != null) {
      if (!deepEquals(existing, schema)) {
        throw new ComponentNameConflictError(name);
      }

      return;
    }

    this.#schemas.set(name, schema);
  }
}

export interface ConvertOptions {
  readonly io: SchemaIO;
  readonly target: JSONSchemaTarget;
  readonly components: ComponentCollector;
  /** Vendor-specific conversion options defined by Standard JSON Schema. */
  readonly libraryOptions?: StandardJSONSchemaV1.Options['libraryOptions'];
  readonly normalization?: NormalizationOptions | undefined;
  /** Name for the schema itself, for schemas that don't name themselves through `$id`. */
  readonly name?: string | undefined;
  /**
   * Whether a self-naming schema becomes a component and a `$ref`.
   *
   * Parameters and headers are described in place rather than referenced, because the document needs
   * their properties spread across separate parameter entries.
   */
  readonly hoistRoot?: boolean | undefined;
}

/**
 * Turns a schema into the fragment an OpenAPI document holds, registering every named schema it
 * carries as a component along the way.
 *
 * The returned value is a `$ref` when the schema names itself, and the schema body when it doesn't.
 */
export function convertSchema<T>(schema: T, options: ConvertOptions): JSONSchema {
  if (!isStandardJSONSchema(schema)) {
    throw new UnsupportedSchemaError(isStandardSchemaLike(schema) ? schema['~standard'].vendor : undefined);
  }

  const raw = describe(schema, options.io, options.target, options.libraryOptions);
  const context: WalkContext = {
    components: options.components,
    normalization: { ...DEFAULT_NORMALIZATION, ...options.normalization },
    pointers: new Map(),
  };

  const { definitions, root } = splitDefinitions(raw);
  const named = options.name == null ? root : { $id: options.name, ...root };

  // A schema claims its own place in the document before the schemas it refers to, so a composite
  // reads ahead of its parts rather than after them.
  reserve(named, context);
  registerDefinitions(definitions, context);

  if (options.hoistRoot === false) {
    return prepare(stripIdentity(root), context);
  }

  return walk(named, context);
}

function describe(
  schema: StandardSchema,
  io: SchemaIO,
  target: JSONSchemaTarget,
  libraryOptions: StandardJSONSchemaV1.Options['libraryOptions'],
): JSONSchema {
  const { $schema: _dialect, ...rest } = schema['~standard'].jsonSchema[io]({ libraryOptions, target });

  return rest;
}

interface WalkContext {
  readonly components: ComponentCollector;
  readonly normalization: Required<NormalizationOptions>;
  /** Maps a converter-local pointer such as `#/$defs/Card` onto its component pointer. */
  readonly pointers: Map<string, string>;
}

function splitDefinitions(raw: JSONSchema) {
  const root: JSONSchema = { ...raw };
  const definitions: Record<string, JSONSchema> = {};

  for (const keyword of DEFINITIONS_KEYWORDS) {
    const block = root[keyword];
    if (!isObjectLike(block)) {
      continue;
    }

    delete root[keyword];
    for (const [key, value] of Object.entries(block)) {
      if (isObjectLike(value)) {
        definitions[key] = value;
      }
    }
  }

  return { definitions, root };
}

/**
 * Registers every definition as a component.
 *
 * Pointers are mapped first so that definitions referring to each other — in either direction —
 * resolve, however they happen to be ordered.
 */
function registerDefinitions(definitions: Record<string, JSONSchema>, context: WalkContext): void {
  const named = Object.entries(definitions).map(([key, definition]) => ({
    definition,
    key,
    name: isJsonString(definition.$id) ? definition.$id : key,
  }));

  for (const { key, name } of named) {
    for (const keyword of DEFINITIONS_KEYWORDS) {
      context.pointers.set(`#/${keyword}/${key}`, `${COMPONENT_SCHEMAS_POINTER}/${name}`);
    }
  }

  for (const { definition, name } of named) {
    context.components.register(name, stripIdentity(prepare(definition, context)));
  }
}

/** Claims a component slot for a self-naming schema, to be filled once the schema is walked. */
function reserve(node: JSONSchema, context: WalkContext): void {
  if (isJsonString(node.$id)) {
    context.components.reserve(node.$id);
  }
}

/** Walks a node, hoisting it into components when it names itself. */
function walk(node: JSONSchema, context: WalkContext): JSONSchema {
  const prepared = prepare(node, context);
  const name = prepared.$id;
  if (!isJsonString(name)) {
    return prepared;
  }

  context.components.register(name, stripIdentity(prepared));

  return { $ref: `${COMPONENT_SCHEMAS_POINTER}/${name}` };
}

/** Rewrites references, descends into subschemas, then normalizes — but leaves `$id` in place. */
function prepare(node: JSONSchema, context: WalkContext): JSONSchema {
  const reference = node.$ref;
  if (isJsonString(reference)) {
    return { ...node, $ref: context.pointers.get(reference) ?? reference };
  }

  const walked: JSONSchema = {};
  for (const [key, value] of Object.entries(node)) {
    walked[key] = DATA_KEYWORDS.has(key) ? value : walkChild(value, context);
  }

  return normalize(walked, context.normalization);
}

function walkChild(value: SchemaValue, context: WalkContext): SchemaValue {
  if (Array.isArray(value)) {
    return value.map(entry => walkChild(entry, context));
  }
  if (!isObjectLike(value)) {
    return value;
  }

  return walk(value, context);
}

function stripIdentity(schema: JSONSchema): JSONSchema {
  const { $id: _identity, ...rest } = schema;

  return rest;
}

function normalize(schema: JSONSchema, options: Required<NormalizationOptions>): JSONSchema {
  const collapsed = options.collapseNullableUnions ? collapseNullableUnion(schema) : schema;
  const normalized: JSONSchema = {};

  for (const [key, value] of Object.entries(collapsed)) {
    if (options.dropStrictAdditionalProperties && key === 'additionalProperties' && value === false) {
      continue;
    }
    if (options.dropFormatImpliedPatterns && key === 'pattern' && isJsonString(collapsed.format)) {
      continue;
    }

    if (options.constToEnum && key === 'const') {
      normalized.enum = [value];
      continue;
    }

    normalized[key] = value;
  }

  return options.orderKeywords ? orderKeywords(normalized) : normalized;
}

/** Sorts a schema's keywords into `KEYWORD_ORDER`, leaving anything unrecognized at the end. */
function orderKeywords(schema: JSONSchema): JSONSchema {
  const entries = Object.entries(schema);
  const ranked = entries.map((entry, index) => ({
    entry,
    index,
    rank: KEYWORD_RANK.get(entry[0]) ?? KEYWORD_ORDER.length,
  }));
  ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);

  return Object.fromEntries(ranked.map(({ entry }) => entry));
}

/**
 * Rewrites the two-branch nullable union schema libraries produce into OpenAPI 3.1's nullable type
 * array, so `string | null` reads as one schema instead of a union.
 */
function collapseNullableUnion(schema: JSONSchema): JSONSchema {
  const branches = schema.anyOf;
  if (!Array.isArray(branches) || branches.length !== 2) {
    return schema;
  }

  const nullBranchIndex = branches.findIndex(branch => isObjectLike(branch) && branch.type === 'null');
  if (nullBranchIndex === -1) {
    return schema;
  }

  const valueBranch = branches[nullBranchIndex === 0 ? 1 : 0];
  if (!isObjectLike(valueBranch) || !isJsonString(valueBranch.type)) {
    return schema;
  }
  if (Object.keys(valueBranch).some(key => key === '$ref' || key === '$id')) {
    return schema;
  }

  const { type, ...valueRest } = valueBranch;
  const { anyOf: _branches, ...rest } = schema;

  return { type: [null, type], ...valueRest, ...rest };
}

function isStandardSchemaLike<T>(value: T): value is T & { '~standard': { vendor: string } } {
  return isObjectLike(value) && isObjectLike(value['~standard']) && isJsonString(value['~standard'].vendor);
}

function deepEquals(left: SchemaValue, right: SchemaValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
