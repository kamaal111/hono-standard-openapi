import type { Hook } from '@hono/standard-validator';
import type { Env, MiddlewareHandler } from 'hono';

import type { ConvertPathType, RouteHandler } from './type-inference.ts';
import type { RouteConfigBase } from './types.ts';

export interface RouteConfig<E extends Env = Env> extends RouteConfigBase {
  /** Middleware to run before this route's validators and handler. */
  readonly middleware?: MiddlewareHandler<E> | readonly MiddlewareHandler<E>[] | undefined;
  /** Keeps the route out of the generated document while still serving it. */
  readonly hide?: boolean | undefined;
}

/** A route and the functions that register it with {@link StandardOpenAPIHono.openapi}. */
export interface OpenAPIRoute<E extends Env = Env, R extends RouteConfig<E> = RouteConfig<E>> {
  readonly route: R;
  readonly handler: RouteHandler<R, E>;
  readonly hook?: Hook<unknown, E, string> | undefined;
}

/**
 * Bundles a route with its typed handler and optional validation hook for reuse across modules.
 *
 * The definition is returned unchanged; register it with
 * `app.openapi(definition.route, definition.handler, definition.hook)`.
 */
export function defineOpenAPIRoute<E extends Env = Env, R extends RouteConfig<E> = RouteConfig<E>>(
  definition: OpenAPIRoute<E, R>,
): OpenAPIRoute<E, R> {
  return definition;
}

/**
 * Describes a route once, for both the router and the document.
 *
 * The returned config carries a non-enumerable `getRoutingPath()`, so the OpenAPI path stays exactly
 * as written while Hono gets the `:param` form it needs, and neither the document nor an equality
 * check on the config ever sees the extra key.
 */
export function createRoute<P extends string, R extends Omit<RouteConfig, 'path'> & { path: P }>(
  routeConfig: R,
): R & { getRoutingPath(): ConvertPathType<R['path']> } {
  const routingPath = toRoutingPath(routeConfig.path);
  const route = { ...routeConfig, getRoutingPath: () => routingPath };

  Object.defineProperty(route, 'getRoutingPath', { enumerable: false });

  return route;
}

/** Rewrites `/cards/{cardId}` as `/cards/:cardId`, the same rewrite `ConvertPathType` describes. */
export function toRoutingPath<P extends string>(path: P): ConvertPathType<P>;
export function toRoutingPath(path: string): string {
  return path.replaceAll(/\/{(.+?)}/g, '/:$1');
}
