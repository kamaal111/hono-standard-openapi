import type { TypedResponse } from 'hono';
import { hc } from 'hono/client';
import { createMiddleware } from 'hono/factory';
import type { SuccessStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { createRoute, StandardOpenAPIHono } from '../src/index.ts';
import type { RouteConfigToTypedResponse, RouteHandlerResponse } from '../src/type-inference.ts';

describe('RPC client typing', () => {
  const create = createRoute({
    method: 'post',
    path: '/users',
    request: { body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } }, required: true } },
    responses: {
      200: { content: { 'application/json': { schema: z.object({ id: z.string() }) } }, description: 'created' },
    },
  });

  const read = createRoute({
    method: 'get',
    path: '/users/{id}',
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { 'application/json': { schema: z.object({ name: z.string() }) } }, description: 'found' },
    },
  });

  const app = new StandardOpenAPIHono()
    .openapi(create, c => c.json({ id: '1' }, 200))
    .openapi(read, c => c.json({ name: 'Ada' }, 200));

  it('types the request body a route accepts', async () => {
    const client = hc<typeof app>('http://localhost');
    const response = await client.users.$post({ json: { name: 'Ada' } });

    expectTypeOf(await response.json()).toEqualTypeOf<{ id: string }>();
  });

  it('types a path parameter and its response', async () => {
    const client = hc<typeof app>('http://localhost');
    const response = await client.users[':id'].$get({ param: { id: '1' } });

    expectTypeOf(await response.json()).toEqualTypeOf<{ name: string }>();
  });

  it('pins the body a route accepts to the schema it documents', () => {
    const client = hc<typeof app>('http://localhost');

    type CreateBody = NonNullable<Parameters<typeof client.users.$post>[0]>['json'];

    expectTypeOf<CreateBody>().toEqualTypeOf<{ name: string }>();
  });

  it('accumulates routes registered together', async () => {
    const routes = new StandardOpenAPIHono().openapiRoutes([
      { handler: c => c.json({ id: '1' }, 200), route: create },
      { handler: c => c.json({ name: 'Ada' }, 200), route: read },
    ]);

    const client = hc<typeof routes>('http://localhost');

    expectTypeOf(await (await client.users.$post({ json: { name: 'Ada' } })).json()).toEqualTypeOf<{ id: string }>();
  });
});

describe('environment inferred from route middleware', () => {
  const identify = createMiddleware<{ Variables: { user: string } }>(async (c, next) => {
    c.set('user', 'Ada');

    await next();
  });

  const trace = createMiddleware<{ Variables: { traceId: number } }>(async (c, next) => {
    c.set('traceId', 1);

    await next();
  });

  it('gives the handler the variables one middleware sets', () => {
    const route = createRoute({
      method: 'get',
      middleware: [identify],
      path: '/one',
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(route, c => {
      expectTypeOf(c.var.user).toEqualTypeOf<string>();

      return c.body(null, 200);
    });
  });

  it('intersects the variables several middleware set', () => {
    const route = createRoute({
      method: 'get',
      middleware: [identify, trace],
      path: '/several',
      responses: { 200: { description: 'ok' } },
    });

    new StandardOpenAPIHono().openapi(route, c => {
      expectTypeOf(c.var.user).toEqualTypeOf<string>();
      expectTypeOf(c.var.traceId).toEqualTypeOf<number>();

      return c.body(null, 200);
    });
  });

  it('leaves the app environment alone when a route brings no middleware', () => {
    const route = createRoute({ method: 'get', path: '/none', responses: { 200: { description: 'ok' } } });

    new StandardOpenAPIHono<{ Variables: { fromApp: string } }>().openapi(route, c => {
      expectTypeOf(c.var.fromApp).toEqualTypeOf<string>();

      return c.body(null, 200);
    });
  });
});

describe('status ranges and default responses', () => {
  it('lets a handler answer any code a range covers', () => {
    const route = createRoute({
      method: 'get',
      path: '/ranged',
      responses: {
        '2XX': { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'fine' },
      },
    });

    new StandardOpenAPIHono().openapi(route, c => c.json({ ok: true }, 201));
  });

  it('allows only the codes the range covers, so a 404 is not one of them', () => {
    const route = createRoute({
      method: 'get',
      path: '/ranged-only',
      responses: {
        '2XX': { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'fine' },
      },
    });

    expectTypeOf<RouteConfigToTypedResponse<typeof route>>().toEqualTypeOf<
      Response & TypedResponse<{ ok: boolean }, SuccessStatusCode, 'json'>
    >();
  });

  it('falls back to the default response for an undocumented code', () => {
    const route = createRoute({
      method: 'get',
      path: '/with-default',
      responses: {
        200: { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'ok' },
        default: { content: { 'application/json': { schema: z.object({ message: z.string() }) } }, description: 'bad' },
      },
    });

    new StandardOpenAPIHono().openapi(route, c =>
      Math.random() > 0.5 ? c.json({ message: 'boom' }, 503) : c.json({ ok: true }, 200),
    );
  });
});

describe('handler returns held to the documented responses', () => {
  it('offers a pinned route nothing but the response it documents', () => {
    const route = createRoute({
      method: 'get',
      path: '/pinned',
      responses: {
        200: { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'ok' },
      },
    });

    type Documented = Response & TypedResponse<{ ok: boolean }, 200, 'json'>;

    expectTypeOf<RouteHandlerResponse<typeof route>>().toEqualTypeOf<Documented | Promise<Documented>>();
  });

  it('still allows a plain Response when a response is left undocumented', () => {
    const route = createRoute({
      method: 'get',
      path: '/loose',
      responses: { 204: { description: 'no content' } },
    });

    type Documented = Response & TypedResponse<unknown, 204, 'text'>;

    expectTypeOf<RouteHandlerResponse<typeof route>>().toEqualTypeOf<
      Documented | Promise<Documented> | Response | Promise<Response>
    >();

    new StandardOpenAPIHono().openapi(route, () => new Response(null, { status: 204 }));
  });
});
