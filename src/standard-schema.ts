import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

/**
 * A schema that can both validate values and describe itself as JSON Schema.
 *
 * Every schema handed to a route needs both halves: validation drives the request middleware and the
 * JSON Schema conversion drives the OpenAPI document.
 */
export type StandardSchema = StandardSchemaV1 & StandardJSONSchemaV1;

/** A JSON Schema document fragment, as produced by a Standard JSON Schema converter. */
export type JSONSchema = Record<string, unknown>;

/** Which side of a schema to describe: what a request accepts, or what a response produces. */
export type SchemaIO = 'input' | 'output';

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== 'object' || value == null || !('~standard' in value)) return false;

  const props: unknown = value['~standard'];

  return typeof props === 'object' && props != null && 'version' in props && props.version === 1;
}

export function isStandardJSONSchema(value: unknown): value is StandardSchema {
  if (!isStandardSchema(value)) return false;

  const props: StandardSchemaV1.Props & { jsonSchema?: unknown } = value['~standard'];

  return typeof props.jsonSchema === 'object' && props.jsonSchema != null;
}

export function validateWithStandardSchema(
  schema: StandardSchemaV1,
  value: unknown,
): StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>> {
  return schema['~standard'].validate(value);
}
