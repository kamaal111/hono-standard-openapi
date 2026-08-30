import type { SchemaOrReference } from './types.ts';

type Composite =
  | { readonly kind: typeof COMPOSITE_KINDS.ALL_OF; readonly schemas: readonly SchemaOrReference[] }
  | { readonly kind: typeof COMPOSITE_KINDS.OBEJCT; readonly properties: Readonly<Record<string, SchemaOrReference>> };

/**
 * Several schemas presented to the document as one `allOf`, or several properties presented as one
 * object.
 *
 * Built by {@link allOf} or {@link objectSchema}; carries the member schemas rather than a converted
 * fragment, since each member may come from a different Standard Schema library and needs its own
 * conversion.
 */
export interface ComposedSchema {
  readonly [COMPOSE]: Composite;
}

const COMPOSE: unique symbol = Symbol.for('@kamaalio/hono-standard-openapi/compose');

const COMPOSITE_KINDS = { ALL_OF: 'allOf', OBEJCT: 'object' } as const;

/**
 * Presents several schemas to a route as one `allOf`, so e.g. a base object and an app-supplied
 * extension can each keep their own schema library while the document sees a single composite.
 *
 * Every member converts independently: one that names itself becomes a `$ref` to its own component,
 * exactly as it would if it were the route's only schema.
 */
export function allOf(schemas: readonly SchemaOrReference[]): ComposedSchema {
  return { [COMPOSE]: { kind: COMPOSITE_KINDS.ALL_OF, schemas } };
}

/**
 * Builds an object schema out of independently-converted properties, every one required.
 *
 * Exists to nest a schema from one library inside a property of an object described by another —
 * for example, folding an app-supplied extension under the `user` key of a base response that
 * {@link allOf} then composes with the rest of that response.
 */
export function objectSchema(properties: Readonly<Record<string, SchemaOrReference>>): ComposedSchema {
  return { [COMPOSE]: { kind: COMPOSITE_KINDS.OBEJCT, properties } };
}

export function isComposedSchema(value: unknown): value is ComposedSchema {
  return typeof value === 'object' && value !== null && COMPOSE in value;
}

export function compositeOf(schema: ComposedSchema): Composite {
  return schema[COMPOSE];
}
