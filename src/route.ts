import type { Hook } from '@hono/standard-validator';
import type { Env, ValidationTargets } from 'hono';
import type { H } from 'hono/types';

import type { ConvertPathType, RouteConfigToTypedResponse, RouteEnv, RouteHandler } from './type-inference.ts';
import type { RouteConfigBase } from './types.ts';

/**
 * Middleware attached to a single route.
 *
 * Deliberately not tied to the app's own environment: a route may bring middleware that declares
 * variables the app knows nothing about, and {@link RouteEnv} widens the handler to match.
 */
export type RouteMiddlewareList = H | readonly H[];

export interface RouteConfig extends RouteConfigBase {
  /** Middleware to run before this route's validators and handler. */
  readonly middleware?: RouteMiddlewareList | undefined;
  /** Keeps the route out of the generated document while still serving it. */
  readonly hide?: boolean | undefined;
}

/**
 * A hook for one route's validation.
 *
 * The return type is the route's own: a hook that answers early may only answer with a response the
 * route documents. `data` stays wide because the hook runs once per validated target, so its value
 * is whichever part is being validated, not the whole request.
 */
export type RouteHook<R extends RouteConfigBase, E extends Env = Env> = Hook<
  unknown,
  E,
  ConvertPathType<R['path']>,
  keyof ValidationTargets,
  RouteConfigToTypedResponse<R> | Response | void | Promise<RouteConfigToTypedResponse<R> | Response | void>
>;

/** A route and the functions that register it with {@link StandardOpenAPIHono.openapi}. */
export interface OpenAPIRoute<E extends Env = Env, R extends RouteConfig = RouteConfig> {
  readonly route: R;
  readonly handler: RouteHandler<R, RouteEnv<R['middleware'], E>>;
  readonly hook?: RouteHook<R, E> | undefined;
}

/**
 * Bundles a route with its typed handler and optional validation hook for reuse across modules.
 *
 * The definition is returned unchanged; register it with
 * `app.openapi(definition.route, definition.handler, definition.hook)`.
 */
export function defineOpenAPIRoute<E extends Env = Env, R extends RouteConfig = RouteConfig>(
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
