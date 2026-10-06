import type { TypedResponse } from 'hono';
import { hc } from 'hono/client';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { StandardOpenAPIHono } from '../src/index.ts';
import { createRoute, defineOpenAPIRoute } from '../src/route.ts';
import type { RouteHook } from '../src/route.ts';
import type { RouteHandler } from '../src/type-inference.ts';

describe('createRoute', () => {
  it('narrows getRoutingPath() to a plain path unchanged', () => {
    const plain = createRoute({ method: 'get', path: '/health', responses: { 200: { description: 'ok' } } });

    expectTypeOf(plain.getRoutingPath()).toEqualTypeOf<'/health'>();
  });

  it('narrows getRoutingPath() to the routing form of a param path', () => {
    const withParam = createRoute({
      method: 'get',
      path: '/cards/{cardId}',
      responses: { 200: { description: 'ok' } },
    });

    expectTypeOf(withParam.getRoutingPath()).toEqualTypeOf<'/cards/:cardId'>();
  });
});

describe('defineOpenAPIRoute', () => {
  it('returns the route config unchanged', () => {
    const route = createRoute({
      method: 'post',
      path: '/cards',
      request: {
        body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } }, required: true },
      },
      responses: { 200: { description: 'ok' } },
    });

    const definition = defineOpenAPIRoute({ route, handler: c => c.body(null, 200) });

    expectTypeOf(definition.route).toEqualTypeOf<typeof route>();
    expectTypeOf(definition.handler).toEqualTypeOf<RouteHandler<typeof route>>();
  });
});

describe('curried defineOpenAPIRoute', () => {
  interface CardRepository {
    list: (game?: 'pokemon') => Promise<string[]>;
  }

  interface AppEnv {
    Variables: { cardRepository: CardRepository };
    Bindings: { API_KEY: string };
  }

  const route = createRoute({
    method: 'get',
    path: '/cards/{cardId}',
    request: {
      params: z.object({ cardId: z.string() }),
      query: z.object({ game: z.enum(['pokemon']).optional() }),
    },
    responses: {
      200: { description: 'Cards retrieved', content: { 'application/json': { schema: z.array(z.string()) } } },
    },
  });

  it('infers route inputs and preserves the explicitly supplied environment', () => {
    const defineRoute = defineOpenAPIRoute<AppEnv>();

    const definition = defineRoute({
      route,
      handler: async c => {
        const repository = c.get('cardRepository');
        const { game } = c.req.valid('query');

        expectTypeOf(repository.list).not.toBeAny();
        expectTypeOf(repository.list).toEqualTypeOf<CardRepository['list']>();
        expectTypeOf(c.req.valid('query')).toEqualTypeOf<{ game?: 'pokemon' | undefined }>();
        expectTypeOf(c.req.valid('param')).toEqualTypeOf<{ cardId: string }>();
        expectTypeOf(c.env.API_KEY).toEqualTypeOf<string>();

        return c.json(await repository.list(game), 200);
      },
      hook: (_result, c) => {
        expectTypeOf(c.get('cardRepository')).toEqualTypeOf<CardRepository>();
        expectTypeOf(c.env.API_KEY).toEqualTypeOf<string>();
      },
    });

    expectTypeOf(definition.route).toEqualTypeOf<typeof route>();
    expectTypeOf(definition.handler).toEqualTypeOf<RouteHandler<typeof route, AppEnv>>();
    expectTypeOf(definition.hook).toEqualTypeOf<RouteHook<typeof route, AppEnv> | undefined>();
    expectTypeOf<Response & TypedResponse<number[], 200, 'json'>>().not.toExtend<
      Awaited<ReturnType<typeof definition.handler>>
    >();
    expectTypeOf<Response & TypedResponse<string[], 201, 'json'>>().not.toExtend<
      Awaited<ReturnType<typeof definition.handler>>
    >();
  });

  it('infers each route independently when a factory is reused', () => {
    const defineRoute = defineOpenAPIRoute<AppEnv>();

    const otherRoute = createRoute({
      method: 'get',
      path: '/search',
      request: { query: z.object({ term: z.string() }) },
      responses: { 200: { description: 'ok' } },
    });

    const first = defineRoute({
      route,
      handler: c => {
        expectTypeOf(c.req.valid('query')).toEqualTypeOf<{ game?: 'pokemon' | undefined }>();

        return c.json(['Pikachu'], 200);
      },
    });

    const second = defineRoute({
      route: otherRoute,
      handler: c => {
        expectTypeOf(c.req.valid('query')).toEqualTypeOf<{ term: string }>();

        return c.text(c.req.valid('query').term, 200);
      },
    });

    expectTypeOf(first.route).toEqualTypeOf<typeof route>();
    expectTypeOf(second.route).toEqualTypeOf<typeof otherRoute>();
  });

  it('preserves typed middleware contributions', () => {
    const trace = createMiddleware<{ Variables: { traceId: number } }>(async (c, next) => {
      c.set('traceId', 1);

      await next();
    });

    const tracedRoute = createRoute({ ...route, middleware: [trace] as const });

    defineOpenAPIRoute<AppEnv>()({
      route: tracedRoute,
      handler: c => {
        expectTypeOf(c.get('traceId')).toEqualTypeOf<number>();
        expectTypeOf(c.get('cardRepository')).toEqualTypeOf<CardRepository>();

        return c.json(['Pikachu'], 200);
      },
    });
  });

  it('registers curried definitions without losing RPC response types', async () => {
    const definition = defineOpenAPIRoute<AppEnv>()({ route, handler: c => c.json(['Pikachu'], 200) });
    const app = new StandardOpenAPIHono<AppEnv>().openapiRoutes([definition]);
    const client = hc<typeof app>('http://localhost');
    const response = await client.cards[':cardId'].$get({ param: { cardId: '1' }, query: { game: 'pokemon' } });

    expectTypeOf(await response.json()).toEqualTypeOf<string[]>();
  });

  it('keeps the explicitly typed direct call compatible', () => {
    const definition = defineOpenAPIRoute<AppEnv, typeof route>({
      route,
      handler: c => {
        expectTypeOf(c.get('cardRepository')).toEqualTypeOf<CardRepository>();

        return c.json(['Pikachu'], 200);
      },
    });

    expectTypeOf(definition.handler).toEqualTypeOf<RouteHandler<typeof route, AppEnv>>();
  });

  it('allows a factory without an explicit environment', () => {
    const definition = defineOpenAPIRoute()({ route, handler: c => c.json(['Pikachu'], 200) });

    expectTypeOf(definition.route).toEqualTypeOf<typeof route>();
    expectTypeOf(definition.handler).toEqualTypeOf<RouteHandler<typeof route>>();
  });
});

describe('defineOpenAPIRoute environment preservation', () => {
  interface CardRepository {
    list: (game?: 'pokemon') => Promise<string[]>;
  }

  interface AppEnv {
    Variables: { cardRepository: CardRepository };
    Bindings: { API_KEY: string };
  }

  const session = createMiddleware<AppEnv>(async (_c, next) => {
    await next();
  });

  const trace = createMiddleware<{ Variables: { traceId: number } }>(async (c, next) => {
    c.set('traceId', 1);

    await next();
  });

  const config = {
    method: 'get' as const,
    path: '/cards',
    request: { query: z.object({ game: z.enum(['pokemon']).optional() }) },
    responses: {
      200: { description: 'Cards retrieved', content: { 'application/json': { schema: z.array(z.string()) } } },
    },
  };

  it('preserves the app environment with middleware composed by every', () => {
    const route = createRoute({ ...config, middleware: [every(session)] as const });

    defineOpenAPIRoute<AppEnv, typeof route>({
      route,
      handler: async c => {
        const repository = c.get('cardRepository');
        const { game } = c.req.valid('query');

        expectTypeOf(repository).not.toBeAny();
        expectTypeOf(repository).toEqualTypeOf<CardRepository>();
        expectTypeOf(repository.list).not.toBeAny();
        expectTypeOf(repository.list).toEqualTypeOf<CardRepository['list']>();
        expectTypeOf<Parameters<typeof repository.list>>().toEqualTypeOf<[game?: 'pokemon']>();
        expectTypeOf<ReturnType<typeof repository.list>>().toEqualTypeOf<Promise<string[]>>();
        expectTypeOf(game).toEqualTypeOf<'pokemon' | undefined>();
        expectTypeOf(c.env.API_KEY).toEqualTypeOf<string>();

        return c.json(await repository.list(game), 200);
      },
    });
  });

  it('preserves typed middleware contributions alongside untyped middleware', () => {
    const route = createRoute({ ...config, middleware: [every(session), trace] as const });

    defineOpenAPIRoute<AppEnv, typeof route>({
      route,
      handler: async c => {
        const repository = c.get('cardRepository');

        expectTypeOf(repository).not.toBeAny();
        expectTypeOf(repository).toEqualTypeOf<CardRepository>();
        expectTypeOf(repository.list).toEqualTypeOf<CardRepository['list']>();
        expectTypeOf(c.get('traceId')).toEqualTypeOf<number>();
        expectTypeOf(c.env.API_KEY).toEqualTypeOf<string>();

        return c.json(await repository.list('pokemon'), 200);
      },
    });
  });
});
