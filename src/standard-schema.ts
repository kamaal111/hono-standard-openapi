import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

/**
 * A schema that can both validate values and describe itself as JSON Schema.
 *
 * Every schema handed to a route needs both halves: validation drives the request middleware and the
 * JSON Schema conversion drives the OpenAPI document.
 */
export type StandardSchema = StandardSchemaV1 & StandardJSONSchemaV1;

/** A JSON Schema document fragment, as produced by a Standard JSON Schema converter. */
export type JSONSchema = ReturnType<StandardJSONSchemaV1.Converter['input']>;

/** One value inside a JSON Schema fragment: a keyword's value, or a nested schema. */
export type SchemaValue = JSONSchema[string];

/** Which side of a schema to describe: what a request accepts, or what a response produces. */
export type SchemaIO = 'input' | 'output';

export function isStandardSchema<T>(value: T): value is T & StandardSchemaV1 {
  if ((typeof value !== 'object' && typeof value !== 'function') || value == null || !('~standard' in value)) {
    return false;
  }

  const props: unknown = value['~standard'];

  return typeof props === 'object' && props != null && 'version' in props && props.version === 1;
}

export function isStandardJSONSchema<T>(value: T): value is T & StandardSchema {
  if (!isStandardSchema(value)) {
    return false;
  }

  const props: StandardSchemaV1.Props & { jsonSchema?: unknown } = value['~standard'];

  return typeof props.jsonSchema === 'object' && props.jsonSchema != null;
}

export function validateWithStandardSchema<V>(
  schema: StandardSchemaV1,
  value: V,
): StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>> {
  return schema['~standard'].validate(value);
}
