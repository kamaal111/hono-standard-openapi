import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Env, Handler, Input, MiddlewareHandler, ToSchema, TypedResponse, ValidationTargets } from 'hono';
import type { MergePath } from 'hono/types';
import type {
  ClientErrorStatusCode,
  InfoStatusCode,
  RedirectStatusCode,
  ServerErrorStatusCode,
  StatusCode,
  SuccessStatusCode,
} from 'hono/utils/http-status';

import type { ContentObject, RouteConfigBase } from './types.ts';

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

type InputTypeBase<R extends RouteConfigBase, Part extends string, Type extends keyof ValidationTargets> = [
  RequestPart<R, Part>,
] extends [never]
  ? {}
  : RequestPart<R, Part> extends infer Schema extends StandardSchemaV1
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

type InputTypeBody<R extends RouteConfigBase, MediaType, Target extends 'json' | 'form'> = [
  BodySchema<RequestContent<R>, MediaType>,
] extends [never]
  ? {}
  : BodySchema<RequestContent<R>, MediaType> extends infer Schema extends StandardSchemaV1
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

type StatusCodeRanges = {
  '1XX': InfoStatusCode;
  '2XX': SuccessStatusCode;
  '3XX': RedirectStatusCode;
  '4XX': ClientErrorStatusCode;
  '5XX': ServerErrorStatusCode;
};

type StatusFrom<Key> = Key extends keyof StatusCodeRanges
  ? StatusCodeRanges[Key]
  : Key extends StatusCode
    ? Key
    : Key extends `${infer Status extends number}`
      ? Status extends StatusCode
        ? Status
        : never
      : never;

type ResponseBody<ResponseEntry, MediaType> = MediaType extends keyof ResponseEntry
  ? ResponseEntry[MediaType] extends { schema: infer Schema extends StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<Schema>
    : never
  : never;

type TypedResponseFor<ResponseEntry, Status extends StatusCode> = ResponseEntry extends { content: infer Content }
  ? JsonMediaType<Content> extends never
    ? Response & TypedResponse<unknown, Status, 'text'>
    : [ResponseBody<Content, JsonMediaType<Content>>] extends [infer Body]
      ? [Body] extends [never]
        ? Response & TypedResponse<unknown, Status, 'json'>
        : Response & TypedResponse<Body, Status, 'json'>
      : never
  : Response & TypedResponse<unknown, Status, 'text'>;

type StatusKeys<R extends RouteConfigBase> = {
  [Key in keyof R['responses']]: [StatusFrom<Key>] extends [never] ? never : Key;
}[keyof R['responses']];

/** The responses a handler is allowed to return, one per documented status code. */
export type RouteConfigToTypedResponse<R extends RouteConfigBase> =
  | {
      [Key in StatusKeys<R> & keyof R['responses']]: TypedResponseFor<
        R['responses'][Key],
        Extract<StatusFrom<Key>, StatusCode>
      >;
    }[StatusKeys<R> & keyof R['responses']]
  | ('default' extends keyof R['responses']
      ? TypedResponseFor<
          R['responses']['default'],
          Exclude<StatusCode, Extract<StatusFrom<keyof R['responses']>, StatusCode>>
        >
      : never);

type PinsResponseContent<R extends RouteConfigBase> = {
  [Key in keyof R['responses']]: R['responses'][Key] extends { content: ContentObject } ? true : false;
}[keyof R['responses']] extends true
  ? true
  : false;

/**
 * What a handler may return: the response typed against the route's own documented schemas, plus a
 * plain `Response` it built itself when the route leaves any response undocumented. Hono accepts a
 * raw `Response` from any handler, so the looser arm only ever loses precision — it is dropped once
 * the route has pinned every response.
 */
export type RouteHandlerResponse<R extends RouteConfigBase> =
  PinsResponseContent<R> extends true
    ? RouteConfigToTypedResponse<R> | Promise<RouteConfigToTypedResponse<R>>
    : RouteConfigToTypedResponse<R> | Promise<RouteConfigToTypedResponse<R>> | Response | Promise<Response>;

export type RouteHandler<R extends RouteConfigBase, E extends Env = Env> = Handler<
  E,
  ConvertPathType<R['path']>,
  ComputeInput<R>,
  RouteHandlerResponse<R>
>;

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never;

type EnvOf<M> = M extends MiddlewareHandler<infer HandlerEnv, string, Input> ? HandlerEnv : never;

type EnvsOf<M> = M extends readonly unknown[] ? EnvOf<M[number]> : EnvOf<M>;

/**
 * The environment a route's own middleware adds to its handler.
 *
 * Each middleware contributes its own bindings and variables, so several of them intersect. A route
 * with no middleware adds nothing, which has to be `{}` rather than `never` — intersecting `never`
 * would erase the app's own environment.
 */
export type MiddlewareEnv<M> = [EnvsOf<M>] extends [never] ? {} : UnionToIntersection<EnvsOf<M>>;

/** The environment a route's handler runs in: the app's, widened by the route's own middleware. */
export type RouteEnv<M, E extends Env> = E & MiddlewareEnv<M>;

export type RouteMiddleware<E extends Env = Env> = MiddlewareHandler<E> | readonly MiddlewareHandler<E>[];

/** The Hono schema entry one route contributes, which is what types an RPC client. */
export type RouteToSchema<R extends RouteConfigBase, BasePath extends string> = ToSchema<
  R['method'],
  MergePath<BasePath, ConvertPathType<R['path']>>,
  ComputeInput<R>,
  RouteConfigToTypedResponse<R>
>;

/** The schema entries a tuple of routes contributes, in order. */
export type RoutesToSchema<
  Configs extends readonly RouteConfigBase[],
  BasePath extends string,
> = Configs extends readonly [infer Head, ...infer Tail]
  ? Head extends RouteConfigBase
    ? RouteToSchema<Head, BasePath> & RoutesToSchema<Tail extends readonly RouteConfigBase[] ? Tail : [], BasePath>
    : {}
  : {};
