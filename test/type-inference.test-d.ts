import type { TypedResponse } from 'hono';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createRoute, StandardOpenAPIHono } from '../src/index.ts';
import type { RouteConfigToTypedResponse } from '../src/index.ts';

describe('status code keys', () => {
  const quoted = createRoute({
    method: 'get',
    path: '/quoted',
    responses: {
      '200': { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'ok' },
    },
  });

  const unquoted = createRoute({
    method: 'get',
    path: '/unquoted',
    responses: {
      200: { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'ok' },
    },
  });

  it('reads a quoted status key as the same code as an unquoted one', () => {
    expectTypeOf<RouteConfigToTypedResponse<typeof quoted>>().toEqualTypeOf<
      RouteConfigToTypedResponse<typeof unquoted>
    >();
  });

  it('resolves a quoted status key to its numeric code', () => {
    expectTypeOf<RouteConfigToTypedResponse<typeof quoted>>().toEqualTypeOf<
      Response & TypedResponse<{ ok: boolean }, 200, 'json'>
    >();
  });

  it('lets a handler answer a quoted status key', () => {
    new StandardOpenAPIHono().openapi(quoted, c => c.json({ ok: true }, 200));
  });
});

describe('request body media types', () => {
  it('types each target from its own media type, not from every media type', () => {
    const bothBodies = createRoute({
      method: 'post',
      path: '/both',
      request: {
        body: {
          content: {
            'application/json': { schema: z.object({ fromJson: z.string() }) },
            'multipart/form-data': { schema: z.object({ fromForm: z.string() }) },
          },
          required: true,
        },
      },
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(bothBodies, c => {
      expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ fromJson: string }>();
      expectTypeOf(c.req.valid('form')).toEqualTypeOf<{ fromForm: string }>();

      return c.body(null, 200);
    });
  });

  it('recognises a vendor JSON media type', () => {
    const vendor = createRoute({
      method: 'post',
      path: '/vendor',
      request: {
        body: { content: { 'application/vnd.api+json': { schema: z.object({ name: z.string() }) } }, required: true },
      },
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(vendor, c => {
      expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();

      return c.body(null, 200);
    });
  });

  it('offers no body target to a route that documents no body', () => {
    const bodiless = createRoute({
      method: 'get',
      path: '/bodiless',
      request: { query: z.object({ q: z.string() }) },
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(bodiless, c => {
      expectTypeOf<Parameters<typeof c.req.valid>[0]>().toEqualTypeOf<'query'>();

      return c.body(null, 200);
    });
  });
});

describe('request parts', () => {
  it('leaves a query value optional when the schema makes it optional', () => {
    const optionalQuery = createRoute({
      method: 'get',
      path: '/optional-query',
      request: { query: z.object({ q: z.optional(z.string()) }) },
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(optionalQuery, c => {
      expectTypeOf(c.req.valid('query')).toEqualTypeOf<{ q?: string | undefined }>();

      return c.body(null, 200);
    });
  });

  it('types params, headers and cookies from their own schemas', () => {
    const everyPart = createRoute({
      method: 'get',
      path: '/cards/{cardId}',
      request: {
        cookies: z.object({ session: z.string() }),
        headers: z.object({ 'x-token': z.string() }),
        params: z.object({ cardId: z.string() }),
      },
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(everyPart, c => {
      expectTypeOf(c.req.valid('param')).toEqualTypeOf<{ cardId: string }>();
      expectTypeOf(c.req.valid('header')).toEqualTypeOf<{ 'x-token': string }>();
      expectTypeOf(c.req.valid('cookie')).toEqualTypeOf<{ session: string }>();

      return c.body(null, 200);
    });
  });
});

describe('responses', () => {
  it('keeps the status of a response documented without content', () => {
    const empty = createRoute({
      method: 'delete',
      path: '/empty',
      responses: { 204: { description: 'gone' } },
    });

    expectTypeOf<RouteConfigToTypedResponse<typeof empty>>().toEqualTypeOf<
      Response & TypedResponse<unknown, 204, 'text'>
    >();
  });

  it('rewrites an OpenAPI path into the Hono path a handler sees', () => {
    const withParam = createRoute({
      method: 'get',
      path: '/cards/{cardId}/prices/{priceId}',
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(withParam, c => {
      // An unknown param name would widen to `string | undefined`, so `string` proves the
      // `{cardId}` -> `:cardId` rewrite reached the handler's path type.
      expectTypeOf(c.req.param('cardId')).toEqualTypeOf<string>();
      expectTypeOf(c.req.param('priceId')).toEqualTypeOf<string>();

      return c.body(null, 200);
    });
  });
});
