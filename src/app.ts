import { type Env, Hono, type MiddlewareHandler, type Schema, type ValidationTargets } from 'hono';
import { mergePath } from 'hono/utils/url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { type DocumentConfig, type GeneratorOptions, OpenAPIGenerator } from './generator.ts';
import { ComponentCollector, convertSchema } from './json-schema.ts';
import { OpenAPIRegistry } from './registry.ts';
import type { RouteConfig } from './route.ts';
import { type StandardSchema, isStandardJSONSchema } from './standard-schema.ts';
import type { RouteHandler } from './type-inference.ts';
import { type ContentObject, PARAMETER_SOURCES, type RouteRequest } from './types.ts';
import { type Hook, standardValidator } from './validator.ts';

export interface StandardOpenAPIHonoOptions<E extends Env> {
  /** Runs for every validation on this app, and on apps mounted under it that define none. */
  readonly defaultHook?: Hook<unknown, E, string, unknown>;
}

type HonoInit<E extends Env> = ConstructorParameters<typeof Hono>[0] & StandardOpenAPIHonoOptions<E>;

/** Any app, whatever it was parameterized with — used where apps are handled as peers. */
// oxlint-disable-next-line typescript/no-explicit-any
type AnyStandardOpenAPIHono = StandardOpenAPIHono<any, any, any>;

const JSON_CONTENT_TYPE = /^application\/([a-z\-.]+\+)?json/;

const FORM_CONTENT_TYPES = ['multipart/form-data', 'application/x-www-form-urlencoded'];

/**
 * A Hono app that documents itself.
 *
 * Routes registered through {@link StandardOpenAPIHono.openapi} are both served and recorded, so the
 * document can never drift from what the server actually accepts.
 */
export class StandardOpenAPIHono<
  E extends Env = Env,
  S extends Schema = {},
  BasePath extends string = '/',
> extends Hono<E, S, BasePath> {
  readonly openAPIRegistry: OpenAPIRegistry;
  readonly defaultHook: StandardOpenAPIHonoOptions<E>['defaultHook'];
  #parentApp?: AnyStandardOpenAPIHono | undefined;

  constructor(init?: HonoInit<E>) {
    super(init);
    this.openAPIRegistry = new OpenAPIRegistry();
    this.defaultHook = init?.defaultHook;
  }

  /** Registers a route: mounts it, validates its request, and records it in the document. */
  openapi<R extends RouteConfig>(
    route: R,
    handler: RouteHandler<R, E>,
    hook?: Hook<unknown, E, string, unknown>,
  ): this {
    const { hide, middleware, ...documented } = route;
    if (hide !== true) this.openAPIRegistry.registerPath(documented);

    const effectiveHook: Hook<unknown, E, string, unknown> = (result, c) => {
      const resolved = hook ?? this.#resolveDefaultHook();

      return resolved?.(result, c);
    };
    const handlers = [
      ...normalizeMiddleware(middleware),
      ...this.#buildValidators(route.request, effectiveHook),
      handler,
    ];

    // @ts-expect-error: the handler chain is validated by `RouteHandler`, not by Hono's own inference.
    this.on([route.method], [toRoutingPath(route.path)], ...handlers);

    return this;
  }

  /** Mounts another app, taking its documented routes along with its handlers. */
  route<SubPath extends string, SubEnv extends Env, SubSchema extends Schema, SubBasePath extends string>(
    path: SubPath,
    app: Hono<SubEnv, SubSchema, SubBasePath>,
  ): this {
    super.route(path, app);

    if (app instanceof StandardOpenAPIHono) {
      app.#parentApp ??= this;
      const prefix = path.replaceAll(/:([^/]+)/g, '{$1}');
      this.openAPIRegistry.absorb(app.openAPIRegistry, routePath => mergePath(prefix, routePath));
    }

    return this;
  }

  /** Builds the document for everything registered so far. */
  getOpenAPIDocument(config: DocumentConfig, generatorConfig: GeneratorOptions = {}): OpenAPIObject {
    return new OpenAPIGenerator(this.openAPIRegistry, generatorConfig).generateDocument(config);
  }

  /** Serves the document as JSON at `path`. */
  doc(path: string, config: DocumentConfig, generatorConfig: GeneratorOptions = {}): this {
    this.get(path, c => c.json(this.getOpenAPIDocument(config, generatorConfig)));

    return this;
  }

  /** The nearest hook, preferring this app's own and falling back to the app it is mounted under. */
  #resolveDefaultHook(): Hook<unknown, E, string, unknown> | undefined {
    if (this.defaultHook != null) return this.defaultHook;

    const visited = new Set<AnyStandardOpenAPIHono>([this]);
    let ancestor = this.#parentApp;

    while (ancestor != null && !visited.has(ancestor)) {
      if (ancestor.defaultHook != null) return ancestor.defaultHook;

      visited.add(ancestor);
      ancestor = ancestor.#parentApp;
    }

    return undefined;
  }

  #buildValidators(
    request: RouteRequest | undefined,
    hook: Hook<unknown, E, string, unknown>,
  ): MiddlewareHandler<E, string>[] {
    if (request == null) return [];

    const validators: MiddlewareHandler<E, string>[] = [];
    for (const { key, target } of VALIDATED_PARTS) {
      const schema = request[key];
      if (schema == null) continue;

      validators.push(standardValidator(target, schema, propertyNamesOf(schema), hook));
    }

    const body = request.body;
    if (body != null) validators.push(...buildBodyValidators(body.content, body.required === true, hook));

    return validators;
  }
}

const VALIDATED_PARTS = [
  { key: 'query', target: 'query' },
  { key: 'params', target: 'param' },
  { key: 'headers', target: 'header' },
  { key: 'cookies', target: 'cookie' },
] as const satisfies readonly { key: keyof RouteRequest; target: keyof ValidationTargets }[];

function buildBodyValidators<E extends Env>(
  content: ContentObject,
  required: boolean,
  hook: Hook<unknown, E, string, unknown>,
): MiddlewareHandler<E, string>[] {
  const validators: MiddlewareHandler<E, string>[] = [];

  for (const [mediaType, media] of Object.entries(content)) {
    const schema = media.schema;
    if (!isStandardJSONSchema(schema)) continue;

    const target = JSON_CONTENT_TYPE.test(mediaType)
      ? 'json'
      : FORM_CONTENT_TYPES.some(formType => mediaType.startsWith(formType))
        ? 'form'
        : undefined;
    if (target == null) continue;

    const validator = standardValidator<E, string>(target, schema, propertyNamesOf(schema), hook);
    validators.push(required ? validator : skipWhenBodyAbsent(validator, mediaType, target));
  }

  return validators;
}

/**
 * Lets an optional body through when the request didn't send one.
 *
 * The handler still gets an empty value from `c.req.valid()`, so it can read the body the same way
 * whether or not the caller supplied it.
 */
function skipWhenBodyAbsent<E extends Env>(
  validator: MiddlewareHandler<E, string>,
  mediaType: string,
  target: 'json' | 'form',
): MiddlewareHandler<E, string> {
  return async (c, next) => {
    const contentType = c.req.header('content-type');
    if (contentType != null && contentType.startsWith(mediaType.replace(/;.*/, ''))) {
      return validator(c, next);
    }

    c.req.addValidatedData(target, {});

    await next();

    return undefined;
  };
}

/** The property names a schema describes, used to match header names case-insensitively. */
function propertyNamesOf(schema: StandardSchema): string[] {
  try {
    const converted = convertSchema(schema, {
      components: new ComponentCollector(),
      hoistRoot: false,
      io: 'input',
      target: 'draft-2020-12',
    });
    const properties = converted.properties;
    if (typeof properties !== 'object' || properties == null) return [];

    return Object.keys(properties);
  } catch {
    return [];
  }
}

function normalizeMiddleware(middleware: RouteConfig['middleware']): MiddlewareHandler<Env>[] {
  if (middleware == null) return [];
  if (typeof middleware === 'function') return [middleware];

  return [...middleware];
}

function toRoutingPath(path: string): string {
  return path.replaceAll(/\/{(.+?)}/g, '/:$1');
}

/**
 * The documenting app type behind a plain Hono type.
 *
 * Hono's own chaining methods return `Hono`, which loses the registry from the type but not from the
 * value; this names what the value actually is.
 */
export type HonoToStandardOpenAPIHono<T> =
  T extends Hono<infer E, infer S, infer BasePath> ? StandardOpenAPIHono<E, S, BasePath> : T;

/** Restores an app's type after Hono's own chaining methods widen it. */
// oxlint-disable-next-line typescript/no-explicit-any
export function $<T extends Hono<any, any, any>>(app: T): HonoToStandardOpenAPIHono<T> {
  // @ts-expect-error: chaining only widens the type; the value is still this package's app.
  return app;
}

export { PARAMETER_SOURCES };
