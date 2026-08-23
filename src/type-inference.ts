import type { Env, Handler, MiddlewareHandler, TypedResponse, ValidationTargets } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

import type { StandardSchemaV1 } from './standard-schema.ts';
import type { RouteConfigBase } from './types.ts';

type HasUndefined<T> = undefined extends T ? true : false;

/** Rewrites OpenAPI's `/users/{id}` into the `/users/:id` Hono routes with. */
export type ConvertPathType<T extends string> = T extends `${infer Start}/{${infer Param}}${infer Rest}`
  ? `${Start}/:${Param}${ConvertPathType<Rest>}`
  : T;

type RequestPart<R extends RouteConfigBase, Part extends string> = R extends { request: infer Request }
  ? Part extends keyof Request
    ? Request[Part]
    : never
  : never;

type InputTypeBase<R extends RouteConfigBase, Part extends string, Type extends keyof ValidationTargets> =
  RequestPart<R, Part> extends infer Schema extends StandardSchemaV1
    ? {
        in: {
          [K in Type]: HasUndefined<ValidationTargets[K]> extends true
            ? { [K2 in keyof StandardSchemaV1.InferInput<Schema>]?: StandardSchemaV1.InferInput<Schema>[K2] }
            : { [K2 in keyof StandardSchemaV1.InferInput<Schema>]: StandardSchemaV1.InferInput<Schema>[K2] };
        };
        out: { [K in Type]: StandardSchemaV1.InferOutput<Schema> };
      }
    : {};

type RequestContent<R extends RouteConfigBase> = R extends { request: { body: { content: infer Content } } }
  ? Content
  : never;

type JsonMediaType<Content> = {
  [K in keyof Content]: K extends `application/${string}json` ? K : never;
}[keyof Content];

type FormMediaType<Content> = {
  [K in keyof Content]: K extends 'multipart/form-data' | 'application/x-www-form-urlencoded' ? K : never;
}[keyof Content];

type BodySchema<Content, MediaType> = MediaType extends keyof Content
  ? Content[MediaType] extends { schema: infer Schema extends StandardSchemaV1 }
    ? Schema
    : never
  : never;

type InputTypeBody<R extends RouteConfigBase, MediaType, Target extends 'json' | 'form'> =
  BodySchema<RequestContent<R>, MediaType> extends infer Schema extends StandardSchemaV1
    ? {
        in: { [K in Target]: StandardSchemaV1.InferInput<Schema> };
        out: { [K in Target]: StandardSchemaV1.InferOutput<Schema> };
      }
    : {};

/** Everything a handler can read off the request, derived from the route's schemas. */
export type ComputeInput<R extends RouteConfigBase> = InputTypeBase<R, 'params', 'param'> &
  InputTypeBase<R, 'query', 'query'> &
  InputTypeBase<R, 'headers', 'header'> &
  InputTypeBase<R, 'cookies', 'cookie'> &
  InputTypeBody<R, JsonMediaType<RequestContent<R>>, 'json'> &
  InputTypeBody<R, FormMediaType<RequestContent<R>>, 'form'>;

/**
 * The status code a response key stands for.
 *
 * Keys can be written either way — `200` or `'200'` — so both forms resolve to the same code.
 */
type StatusFrom<Key> = Key extends StatusCode
  ? Key
  : Key extends `${infer Status extends number}`
    ? Status extends StatusCode
      ? Status
      : never
    : never;

type ResponseBody<Response, MediaType> = MediaType extends keyof Response
  ? Response[MediaType] extends { schema: infer Schema extends StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<Schema>
    : never
  : never;

type TypedResponseFor<Response, Status extends StatusCode> = Response extends { content: infer Content }
  ? ResponseBody<Content, JsonMediaType<Content>> extends infer Body
    ? [Body] extends [never]
      ? TypedResponse<unknown, Status, 'text'>
      : TypedResponse<Body, Status, 'json'>
    : never
  : never;

/** The responses a handler is allowed to return, one per documented status code. */
export type RouteConfigToTypedResponse<R extends RouteConfigBase> = {
  [Key in keyof R['responses']]: TypedResponseFor<R['responses'][Key], StatusFrom<Key>>;
}[keyof R['responses']];

type HasContentlessResponse<R extends RouteConfigBase> = {
  [Key in keyof R['responses']]: R['responses'][Key] extends { content: unknown } ? never : true;
}[keyof R['responses']];

/**
 * What a handler may return.
 *
 * A route that documents a response without a body — a 204, say — can also answer with a plain
 * `Response`, since there is no schema to satisfy.
 */
export type RouteHandlerResponse<R extends RouteConfigBase> = [HasContentlessResponse<R>] extends [never]
  ? RouteConfigToTypedResponse<R> | Promise<RouteConfigToTypedResponse<R>>
  : RouteConfigToTypedResponse<R> | Promise<RouteConfigToTypedResponse<R>> | Response | Promise<Response>;

export type RouteHandler<R extends RouteConfigBase, E extends Env = Env> = Handler<
  E,
  ConvertPathType<R['path']>,
  ComputeInput<R>,
  RouteHandlerResponse<R>
>;

export type RouteMiddleware<E extends Env = Env> = MiddlewareHandler<E> | readonly MiddlewareHandler<E>[];
