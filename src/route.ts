import type { Env, MiddlewareHandler } from 'hono';

import type { ConvertPathType } from './type-inference.ts';
import type { RouteConfigBase } from './types.ts';

export interface RouteConfig<E extends Env = Env> extends RouteConfigBase {
  /** Middleware to run before this route's validators and handler. */
  readonly middleware?: MiddlewareHandler<E> | readonly MiddlewareHandler<E>[] | undefined;
  /** Keeps the route out of the generated document while still serving it. */
  readonly hide?: boolean | undefined;
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
): R & { getRoutingPath(): ConvertPathType<P> } {
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
