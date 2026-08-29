/** Any value that survives a JSON round-trip. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object: the shape every JSON Schema and OpenAPI document fragment here is built from. */
export type JsonObject = Record<string, JsonValue>;

/** Narrows a value of unknown provenance to a plain object, without claiming its property types. */
export function isObjectLike<T>(value: T): value is T & JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonString<T>(value: T): value is T & string {
  return typeof value === 'string';
}
