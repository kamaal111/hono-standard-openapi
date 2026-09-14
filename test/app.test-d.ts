import type { Hono } from 'hono';
import { describe, expectTypeOf, it } from 'vitest';

import type { HonoToStandardOpenAPIHono } from '../src/app.ts';
import { $, StandardOpenAPIHono } from '../src/index.ts';

type MyEnv = { Variables: { userId: string } };

describe('HonoToStandardOpenAPIHono', () => {
  it('resolves a Hono type to the equivalent StandardOpenAPIHono type', () => {
    expectTypeOf<HonoToStandardOpenAPIHono<Hono<MyEnv, {}, '/api'>>>().toEqualTypeOf<
      StandardOpenAPIHono<MyEnv, {}, '/api'>
    >();
  });

  it('leaves a non-Hono type unchanged', () => {
    expectTypeOf<HonoToStandardOpenAPIHono<{ id: string }>>().toEqualTypeOf<{ id: string }>();
  });
});

describe('$', () => {
  it('restores the app’s own type parameters after Hono widens them', () => {
    const app = new StandardOpenAPIHono<MyEnv, {}, '/api'>();
    const widened: Hono<MyEnv, {}, '/api'> = app;

    expectTypeOf($(widened)).toEqualTypeOf<StandardOpenAPIHono<MyEnv, {}, '/api'>>();
  });
});

describe('StandardOpenAPIHono.route', () => {
  it('keeps the parent’s own type parameters after mounting a sub-app', () => {
    const app = new StandardOpenAPIHono<MyEnv>();
    const sub = new StandardOpenAPIHono();

    expectTypeOf(app.route('/sub', sub)).toEqualTypeOf<StandardOpenAPIHono<MyEnv, {}, '/'>>();
  });
});
