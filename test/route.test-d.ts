import { describe, expectTypeOf, it } from 'vitest';
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
