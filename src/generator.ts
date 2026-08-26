import type { ComponentsObject, OpenAPIObject, ParameterObject } from 'openapi3-ts/oas31';

import { UnsupportedParameterSchemaError, UnsupportedSchemaError } from './errors.ts';
import { ComponentCollector, type JSONSchemaTarget, type NormalizationOptions, convertSchema } from './json-schema.ts';
import type { OpenAPIDefinition, OpenAPIRegistry } from './registry.ts';
import { type JSONSchema, type SchemaIO, isStandardJSONSchema, isStandardSchema } from './standard-schema.ts';
import {
  type ContentObject,
  PARAMETER_SOURCES,
  type ParameterLocation,
  type ResponseConfig,
  type RouteConfigBase,
  type RouteRequest,
} from './types.ts';

/** The OpenAPI version to emit. 3.1 is JSON Schema draft 2020-12; 3.0 is its own dialect. */
export type OpenAPIVersion = '3.0' | '3.1';

export interface GeneratorOptions {
  readonly version?: OpenAPIVersion;
  /** Options forwarded to every Standard JSON Schema conversion in this document. */
  readonly libraryOptions?: Record<string, unknown>;
  readonly normalization?: NormalizationOptions;
  /**
   * How `components.schemas` is ordered.
   *
   * `first-referenced` walks the finished document and orders components the way a reader meets
   * them, which keeps the output stable as unrelated schemas come and go. `registration` keeps the
   * order they were generated in.
   */
  readonly componentOrder?: 'first-referenced' | 'registration' | 'alphabetical';
}

export type DocumentConfig = Omit<OpenAPIObject, 'paths' | 'webhooks'>;

/**
 * The document under construction.
 *
 * It is assembled as plain JSON — the OpenAPI types describe the finished document, not every
 * intermediate step, and typing the assembly against them costs more than it catches.
 */
type DocumentPaths = Record<string, Record<string, unknown>>;

const TARGETS: Record<OpenAPIVersion, JSONSchemaTarget> = {
  '3.0': 'openapi-3.0',
  '3.1': 'draft-2020-12',
};

/** Assembles an OpenAPI document from what a registry collected. */
export class OpenAPIGenerator {
  readonly #definitions: OpenAPIDefinition[];
  readonly #options: GeneratorOptions;
  readonly #components = new ComponentCollector();
  /** Names given to schemas from the outside, for schemas that carry no `$id` of their own. */
  readonly #names = new WeakMap<object, string>();

  constructor(definitions: OpenAPIDefinition[] | OpenAPIRegistry, options: GeneratorOptions = {}) {
    this.#definitions = Array.isArray(definitions) ? definitions : definitions.definitions;
    this.#options = options;

    for (const definition of this.#definitions) {
      if (definition.type === 'schema') this.#names.set(definition.schema, definition.name);
    }
  }

  generateDocument(config: DocumentConfig): OpenAPIObject {
    const paths: DocumentPaths = {};
    const webhooks: DocumentPaths = {};
    const rawComponents: Record<string, Record<string, object>> = {};

    for (const definition of this.#definitions) {
      switch (definition.type) {
        case 'component':
          rawComponents[definition.componentType] = {
            ...rawComponents[definition.componentType],
            [definition.name]: definition.component,
          };
          break;
        case 'schema':
          this.#convert(definition.schema, 'output');
          break;
        case 'route':
          mergePathItem(paths, definition.route, this.#generateOperation(definition.route));
          break;
        case 'webhook':
          mergePathItem(webhooks, definition.webhook, this.#generateOperation(definition.webhook));
          break;
      }
    }

    const { components: configuredComponents, ...rest } = config;
    const document: OpenAPIObject = {
      ...rest,
      paths,
      components: this.#buildComponents(configuredComponents, rawComponents, paths),
    };

    if (Object.keys(webhooks).length > 0) document.webhooks = webhooks;

    return document;
  }

  #buildComponents(
    configured: ComponentsObject | undefined,
    raw: Record<string, Record<string, object>>,
    paths: DocumentPaths,
  ): ComponentsObject {
    const schemas = orderSchemas(this.#components.schemas, this.#options.componentOrder ?? 'registration', paths);
    const merged: ComponentsObject = { ...configured, ...raw };

    return {
      ...merged,
      schemas: { ...merged.schemas, ...schemas },
    };
  }

  #convert(schema: object, io: SchemaIO, hoistRoot?: boolean): JSONSchema {
    return convertSchema(schema, {
      components: this.#components,
      hoistRoot,
      io,
      libraryOptions: this.#options.libraryOptions,
      name: this.#names.get(schema),
      normalization: this.#options.normalization,
      target: TARGETS[this.#options.version ?? '3.1'],
    });
  }

  #generateOperation(route: RouteConfigBase): { method: string; operation: Record<string, unknown> } {
    const { method, parameters: declaredParameters, path: _path, request, responses, ...operationConfig } = route;
    const parameters = [...(declaredParameters ?? []), ...this.#generateParameters(request)];
    const operation: Record<string, unknown> = { ...operationConfig, responses: this.#generateResponses(responses) };

    if (parameters.length > 0) operation.parameters = parameters;

    const requestBody = request?.body;
    if (requestBody != null) {
      const { content, ...bodyConfig } = requestBody;
      operation.requestBody = { ...bodyConfig, content: this.#generateContent(content, 'input') };
    }

    return { method, operation: reorderOperation(operation) };
  }

  #generateParameters(request: RouteRequest | undefined): ParameterObject[] {
    if (request == null) return [];

    return PARAMETER_SOURCES.flatMap(({ key, location }) => {
      const schema = request[key];
      if (schema == null) return [];

      return this.#generateParametersFor(schema, location);
    });
  }

  #generateParametersFor(schema: object, location: ParameterLocation): ParameterObject[] {
    const converted = this.#convert(schema, 'input', false);
    const properties = converted.properties;
    if (converted.type !== 'object' || !isRecord(properties)) throw new UnsupportedParameterSchemaError(location);

    const required = Array.isArray(converted.required) ? converted.required : [];

    return Object.entries(properties).map(([name, property]) => ({
      ...describeParameter(property, location === 'path' || required.includes(name)),
      name,
      in: location,
    }));
  }

  #generateResponses(responses: RouteConfigBase['responses']): Record<string, unknown> {
    const generated: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(responses)) {
      generated[status] = '$ref' in response ? response : this.#generateResponse(response);
    }

    return generated;
  }

  #generateResponse(response: ResponseConfig): Record<string, unknown> {
    const { content, description, headers, links } = response;
    const generated: Record<string, unknown> = { description };

    if (headers != null) generated.headers = this.#generateResponseHeaders(headers);
    if (content != null) generated.content = this.#generateContent(content, 'output');
    if (links != null) generated.links = links;

    return generated;
  }

  #generateResponseHeaders(headers: NonNullable<ResponseConfig['headers']>): object {
    if (!isStandardJSONSchema(headers)) {
      if (isStandardSchema(headers)) throw new UnsupportedSchemaError(headers['~standard'].vendor);

      return headers;
    }

    const converted = this.#convert(headers, 'output', false);
    const properties = converted.properties;
    if (converted.type !== 'object' || !isRecord(properties)) throw new UnsupportedParameterSchemaError('headers');

    const required = Array.isArray(converted.required) ? converted.required : [];
    const generated: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      generated[name] = describeParameter(property, required.includes(name));
    }

    return generated;
  }

  /** Converts a schema, or passes an already-written OpenAPI schema through untouched. */
  #describe(schema: NonNullable<ContentObject[string]['schema']>, io: SchemaIO): unknown {
    if (isStandardJSONSchema(schema)) return this.#convert(schema, io);
    if (isStandardSchema(schema)) throw new UnsupportedSchemaError(schema['~standard'].vendor);

    return schema;
  }

  #generateContent(content: ContentObject, io: SchemaIO): Record<string, unknown> {
    const generated: Record<string, unknown> = {};
    for (const [mediaType, media] of Object.entries(content)) {
      const { schema, ...rest } = media;
      generated[mediaType] = { ...rest, ...(schema == null ? {} : { schema: this.#describe(schema, io) }) };
    }

    return generated;
  }
}

/**
 * Describes one parameter or response header.
 *
 * A description on the schema is repeated on the parameter itself, because tools read it from either
 * place and OpenAPI has no notion of inheriting it.
 */
function describeParameter(property: unknown, required: boolean): Record<string, unknown> {
  const described: Record<string, unknown> = { schema: property, required };
  if (isRecord(property) && typeof property.description === 'string') described.description = property.description;

  return described;
}

/** Puts an operation's keys in the order the OpenAPI specification presents them. */
function reorderOperation(operation: Record<string, unknown>): Record<string, unknown> {
  const { parameters, requestBody, responses, ...rest } = operation;
  const ordered: Record<string, unknown> = { ...rest };

  if (parameters != null) ordered.parameters = parameters;
  if (requestBody != null) ordered.requestBody = requestBody;
  ordered.responses = responses;

  return ordered;
}

function mergePathItem(
  paths: DocumentPaths,
  route: RouteConfigBase,
  { method, operation }: { method: string; operation: Record<string, unknown> },
): void {
  paths[route.path] = { ...paths[route.path], [method]: operation };
}

function orderSchemas(
  schemas: Record<string, JSONSchema>,
  order: NonNullable<GeneratorOptions['componentOrder']>,
  paths: DocumentPaths,
): Record<string, JSONSchema> {
  if (order === 'registration') return schemas;
  if (order === 'alphabetical') {
    return Object.fromEntries(Object.entries(schemas).sort(([left], [right]) => left.localeCompare(right)));
  }

  const ordered: Record<string, JSONSchema> = {};
  for (const name of referencedNames(paths, schemas)) {
    const schema = schemas[name];
    if (schema != null) ordered[name] = schema;
  }

  return { ...ordered, ...schemas };
}

/** Names of components in the order a depth-first read of the document first meets them. */
function referencedNames(paths: DocumentPaths, schemas: Record<string, JSONSchema>): string[] {
  const seen: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);

      return;
    }
    if (!isRecord(node)) return;

    const reference = node.$ref;
    if (typeof reference === 'string') {
      const name = reference.startsWith('#/components/schemas/') ? reference.slice(21) : undefined;
      if (name == null || seen.includes(name)) return;

      seen.push(name);
      visit(schemas[name]);

      return;
    }

    for (const value of Object.values(node)) visit(value);
  };

  visit(paths);

  return seen;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
