import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { createRoute, defineOpenAPIRoute } from '../src/route.ts';
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
