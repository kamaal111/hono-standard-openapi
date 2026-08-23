/** Base class for every error this package throws, so consumers can catch them as a group. */
export class StandardOpenAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when a schema cannot describe itself as JSON Schema. */
export class UnsupportedSchemaError extends StandardOpenAPIError {
  constructor(vendor?: string) {
    super(
      `Schema${vendor == null ? '' : ` from "${vendor}"`} does not implement Standard JSON Schema. ` +
        'Only schemas exposing `~standard.jsonSchema` can be turned into an OpenAPI document.',
    );
  }
}

/** Thrown when two different schemas claim the same component name. */
export class ComponentNameConflictError extends StandardOpenAPIError {
  constructor(name: string) {
    super(
      `Two different schemas are both named "${name}". Component names must be unique; ` +
        'give one of them a different `$id`.',
    );
  }
}

/** Thrown when a schema used for parameters or headers is not a JSON Schema object type. */
export class UnsupportedParameterSchemaError extends StandardOpenAPIError {
  constructor(location: string) {
    super(
      `The schema for "${location}" must describe an object, because each of its properties becomes ` +
        'one OpenAPI parameter.',
    );
  }
}
