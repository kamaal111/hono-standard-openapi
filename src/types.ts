import type {
  HeadersObject,
  LinksObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  ResponsesObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

import type { StandardSchema } from './standard-schema.ts';

export type { ReferenceObject, SchemaObject };

/** Either a schema to convert, or an already-written OpenAPI schema to pass through untouched. */
export type SchemaOrReference = StandardSchema | SchemaObject | ReferenceObject;

export interface MediaTypeObject {
  readonly schema?: SchemaOrReference | undefined;
  readonly example?: unknown;
  readonly examples?: Record<string, unknown> | undefined;
  readonly encoding?: Record<string, unknown> | undefined;
}

export type ContentObject = Record<string, MediaTypeObject>;

export interface RequestBody extends Omit<RequestBodyObject, 'content'> {
  readonly content: ContentObject;
}

export interface ResponseConfig {
  readonly description: string;
  readonly headers?: StandardSchema | HeadersObject | undefined;
  readonly links?: LinksObject | undefined;
  readonly content?: ContentObject | undefined;
}

export interface RouteRequest {
  readonly body?: RequestBody | undefined;
  readonly params?: StandardSchema | undefined;
  readonly query?: StandardSchema | undefined;
  readonly cookies?: StandardSchema | undefined;
  readonly headers?: StandardSchema | undefined;
}

export type RouteMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options' | 'trace';

export interface RouteConfigBase extends Omit<OperationObject, 'responses' | 'parameters'> {
  readonly method: RouteMethod;
  readonly path: string;
  readonly request?: RouteRequest | undefined;
  readonly parameters?: (ParameterObject | ReferenceObject)[] | undefined;
  readonly responses: Record<string, ResponseConfig | ReferenceObject>;
}

export type { ResponsesObject };

/** Where a parameter lives in the request. */
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** The request keys that become parameters, in the order the document lists them. */
export const PARAMETER_SOURCES = [
  { key: 'params', location: 'path' },
  { key: 'query', location: 'query' },
  { key: 'headers', location: 'header' },
  { key: 'cookies', location: 'cookie' },
] as const satisfies readonly { key: keyof RouteRequest; location: ParameterLocation }[];
