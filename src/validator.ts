import type { Context, Env, MiddlewareHandler, ValidationTargets } from 'hono';
import { validator } from 'hono/validator';

import type { StandardSchemaV1 } from './standard-schema.ts';

/** What a validation attempt produced, handed to a hook before the handler runs. */
export type ValidationResult<T> =
  | { readonly target: keyof ValidationTargets; readonly success: true; readonly data: T }
  | {
      readonly target: keyof ValidationTargets;
      readonly success: false;
      readonly data: unknown;
      readonly error: { readonly issues: readonly StandardSchemaV1.Issue[] };
    };

/**
 * Runs before the handler, once per validated part of the request.
 *
 * Returning a `Response` (or throwing) takes over the request; returning nothing lets it continue,
 * which is how a hook can log a failure without changing the outcome.
 */
export type Hook<T, E extends Env, P extends string, R> = (
  result: ValidationResult<T>,
  c: Context<E, P>,
) => R | undefined;

/**
 * Validates one part of a request against a Standard Schema.
 *
 * Header names are matched case-insensitively against the schema's own property names, because HTTP
 * header casing is not something a caller should have to get right.
 */
export function standardValidator<E extends Env, P extends string>(
  target: keyof ValidationTargets,
  schema: StandardSchemaV1,
  propertyNames: readonly string[],
  hook?: Hook<unknown, E, P, unknown>,
): MiddlewareHandler<E, P> {
  return validator(target, async (value, c) => {
    const candidate = target === 'header' ? withSchemaCasing(value, propertyNames) : value;
    const result = await schema['~standard'].validate(candidate);

    if (result.issues == null) {
      const hooked = hook?.({ data: result.value, success: true, target }, c);
      if (hooked instanceof Response) return hooked;

      return result.value;
    }

    const failure = { data: candidate, error: { issues: result.issues }, success: false, target } as const;
    const hooked = hook?.(failure, c);
    if (hooked instanceof Response) return hooked;

    return c.json({ error: { issues: result.issues }, success: false }, 400);
  });
}

function withSchemaCasing(value: unknown, propertyNames: readonly string[]): unknown {
  if (typeof value !== 'object' || value == null || propertyNames.length === 0) return value;

  const casingByLowercased = new Map(propertyNames.map(name => [name.toLowerCase(), name]));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [casingByLowercased.get(key.toLowerCase()) ?? key, entry]),
  );
}
