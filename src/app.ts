import { type Hook, sValidator } from '@hono/standard-validator';
import { type Env, Hono, type Schema, type ToSchema, type ValidationTargets } from 'hono';
import type { BlankInput, BlankSchema, H, Handler, MergePath, MergeSchemaPath } from 'hono/types';
import { mergePath } from 'hono/utils/url';
import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { type DocumentConfig, type GeneratorOptions, OpenAPIGenerator } from './generator.ts';
import { OpenAPIRegistry } from './registry.ts';
import type { OpenAPIRoute, RouteConfig, RouteHook, RouteMiddlewareList } from './route.ts';
import { isStandardJSONSchema } from './standard-schema.ts';
import type { RouteEnv, RouteHandler, RoutesToSchema, RouteToSchema } from './type-inference.ts';
import { type ContentObject, PARAMETER_SOURCES, type RouteRequest } from './types.ts';

export interface StandardOpenAPIHonoOptions<E extends Env> {
  /** Runs for every validation on this app, and on apps mounted under it that define none. */
  readonly defaultHook?: Hook<unknown, E, string>;
}

type HonoInit<E extends Env> = ConstructorParameters<typeof Hono>[0] & StandardOpenAPIHonoOptions<E>;

/** Any app, whatever it was parameterized with — used where apps are handled as peers. */
interface StandardOpenAPIHonoParent<E extends Env> {
  getDefaultHook(visited?: Set<StandardOpenAPIHonoParent<E>>): Hook<unknown, E, string> | undefined;
}

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
  S extends Schema = BlankSchema,
  BasePath extends string = '/',
> extends Hono<E, S, BasePath> {
  readonly defaultHook: StandardOpenAPIHonoOptions<E>['defaultHook'];
  #registry: OpenAPIRegistry;
  #parentApp?: StandardOpenAPIHonoParent<E> | undefined;
  #routePrefix = '/';

  constructor(init?: HonoInit<E>) {
    super(init);
    this.#registry = new OpenAPIRegistry();
    this.defaultHook = init?.defaultHook;
  }

  /** Everything recorded for the document so far. Shared with apps derived by `basePath()`. */
  get openAPIRegistry(): OpenAPIRegistry {
    return this.#registry;
  }

  /** Registers a route: mounts it, validates its request, and records it in the document. */
  openapi<R extends RouteConfig>(
    route: R,
    handler: RouteHandler<R, RouteEnv<R['middleware'], E>>,
    hook?: RouteHook<R, E>,
  ): StandardOpenAPIHono<E, S & RouteToSchema<R, BasePath>, BasePath> {
    const { hide, middleware, ...documented } = route;

    if (hide !== true) {
      this.openAPIRegistry.registerPath({ ...documented, path: this.#documentPath(route.path) });
    }

    const effectiveHook: Hook<unknown, E, string> = (result, c) => {
      const resolved = hook ?? this.getDefaultHook();

      return resolved?.(result, c);
    };

    const methods = [route.method];
    const paths = [toRoutingPath(route.path)];

    for (const middlewareHandler of normalizeMiddleware(middleware)) {
      this.on(methods, paths, middlewareHandler);
    }

    for (const validator of this.#buildValidators(route.request, effectiveHook)) {
      this.on(methods, paths, validator);
    }

    this.on(methods, paths, handler);

    return this;
  }

  /**
   * Registers reusable route definitions, mounting and documenting each one.
   *
   * The configs are inferred as a tuple and each entry is checked against its own route, so a
   * handler still sees exactly the request and responses its own route declares.
   */
  openapiRoutes<const Configs extends readonly RouteConfig[]>(routes: {
    readonly [K in keyof Configs]: OpenAPIRoute<E, Configs[K]>;
  }): StandardOpenAPIHono<E, S & RoutesToSchema<Configs, BasePath>, BasePath> {
    for (const { route, handler, hook } of routes) {
      this.openapi(route, handler, hook);
    }

    return this;
  }

  /** Mounts another app, taking its documented routes along with its handlers. */
  route<SubPath extends string, SubEnv extends Env, SubSchema extends Schema, SubBasePath extends string>(
    path: SubPath,
    app: Hono<SubEnv, SubSchema, SubBasePath>,
  ): StandardOpenAPIHono<E, MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> & S, BasePath> {
    super.route(path, app);

    if (app instanceof StandardOpenAPIHono) {
      app.#parentApp ??= this;
      const prefix = path.replaceAll(/:([^/]+)/g, '{$1}');
      this.openAPIRegistry.absorb(app.openAPIRegistry, routePath => mergePath(prefix, routePath));
    }

    return this;
  }

  /**
   * Narrows the app to a path prefix, the way Hono's own `basePath` does.
   *
   * Hono clones into a plain `Hono`, which would drop both the registry and `openapi()`, so the
   * derived app is rebuilt here. It shares the router, the routes and the registry, so either app
   * serves and documents the whole surface.
   */
  basePath<SubPath extends string>(path: SubPath): StandardOpenAPIHono<E, S, MergePath<BasePath, SubPath>> {
    const cloned = super.basePath(path);
    const derived = new StandardOpenAPIHono<E, S, MergePath<BasePath, SubPath>>({ defaultHook: this.defaultHook });
    const prefix = mergePath(this.#routePrefix, path);

    derived.#registry = this.#registry;
    derived.#parentApp = this;
    derived.#routePrefix = prefix;
    derived.router = cloned.router;
    derived.routes = cloned.routes;
    Object.assign(derived, { _basePath: prefix, getPath: cloned.getPath });

    return derived;
  }

  #documentPath(path: string): string {
    return mergePath(this.#routePrefix.replaceAll(/:([^/]+)/g, '{$1}'), path);
  }

  /** Builds the document for everything registered so far. */
  getOpenAPIDocument(config: DocumentConfig, generatorConfig: GeneratorOptions = {}): OpenAPIObject {
    return new OpenAPIGenerator(this.openAPIRegistry, generatorConfig).generateDocument(config);
  }

  /** Serves the document as JSON at `path`. */
  doc<P extends string>(
    path: P,
    config: DocumentConfig,
    generatorConfig: GeneratorOptions = {},
  ): StandardOpenAPIHono<E, S & ToSchema<'get', MergePath<BasePath, P>, BlankInput, BlankInput>, BasePath> {
    this.get(path, c => c.json(this.getOpenAPIDocument(config, generatorConfig)));

    return this;
  }

  /** The nearest hook, preferring this app's own and falling back to the app it is mounted under. */
  getDefaultHook(visited = new Set<StandardOpenAPIHonoParent<E>>()): Hook<unknown, E, string> | undefined {
    if (this.defaultHook != null) {
      return this.defaultHook;
    }

    if (visited.has(this)) {
      return undefined;
    }

    visited.add(this);

    return this.#parentApp?.getDefaultHook(visited);
  }

  #buildValidators(request: RouteRequest | undefined, hook: Hook<unknown, E, string>): Handler<E, string>[] {
    if (request == null) {
      return [];
    }

    const validators: Handler<E, string>[] = [];

    for (const { key, target } of VALIDATED_PARTS) {
      const schema = request[key];

      if (schema == null) {
        continue;
      }

      validators.push(sValidator(target, schema, hook));
    }

    const body = request.body;

    if (body != null) {
      validators.push(...buildBodyValidators(body.content, body.required === true, hook));
    }

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
  hook: Hook<unknown, E, string>,
): Handler<E, string>[] {
  const validators: Handler<E, string>[] = [];

  for (const [mediaType, media] of Object.entries(content)) {
    const schema = media.schema;

    if (!isStandardJSONSchema(schema)) {
      continue;
    }

    const target = JSON_CONTENT_TYPE.test(mediaType)
      ? 'json'
      : FORM_CONTENT_TYPES.some(formType => mediaType.startsWith(formType))
        ? 'form'
        : undefined;

    if (target == null) {
      continue;
    }

    const validator = sValidator(target, schema, hook);
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
  validator: Handler<E, string>,
  mediaType: string,
  target: 'json' | 'form',
): Handler<E, string> {
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

function isSingleMiddleware(value: RouteMiddlewareList): value is H {
  return !Array.isArray(value);
}

function normalizeMiddleware(middleware: RouteConfig['middleware']): H[] {
  if (middleware == null) {
    return [];
  }

  if (isSingleMiddleware(middleware)) {
    return [middleware];
  }

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
export function $<E extends Env, S extends Schema, BasePath extends string>(
  app: Hono<E, S, BasePath>,
): StandardOpenAPIHono<E, S, BasePath> {
  if (!(app instanceof StandardOpenAPIHono)) {
    throw new TypeError('The chaining helper only accepts a StandardOpenAPIHono instance.');
  }

  return app;
}

export { PARAMETER_SOURCES };
