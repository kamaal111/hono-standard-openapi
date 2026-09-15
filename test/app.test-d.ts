import type { Hono } from 'hono';
import type { BlankSchema } from 'hono/types';

import type { HonoToStandardOpenAPIHono } from '../src/app.ts';
import { $, StandardOpenAPIHono } from '../src/index.ts';

interface MyEnv {
  Variables: { userId: string };
}

describe('HonoToStandardOpenAPIHono', () => {
  it('resolves a Hono type to the equivalent StandardOpenAPIHono type', () => {
    expectTypeOf<HonoToStandardOpenAPIHono<Hono<MyEnv, BlankSchema, '/api'>>>().toEqualTypeOf<
      StandardOpenAPIHono<MyEnv, BlankSchema, '/api'>
    >();
  });

  it('leaves a non-Hono type unchanged', () => {
    expectTypeOf<HonoToStandardOpenAPIHono<{ id: string }>>().toEqualTypeOf<{ id: string }>();
  });
});

describe('$', () => {
  it('restores the app’s own type parameters after Hono widens them', () => {
    const app = new StandardOpenAPIHono<MyEnv, BlankSchema, '/api'>();
    const widened: Hono<MyEnv, BlankSchema, '/api'> = app;

    expectTypeOf($(widened)).toEqualTypeOf<StandardOpenAPIHono<MyEnv, BlankSchema, '/api'>>();
  });
});

describe('StandardOpenAPIHono.route', () => {
  it('keeps the parent’s own type parameters after mounting a sub-app', () => {
    const app = new StandardOpenAPIHono<MyEnv>();
    const sub = new StandardOpenAPIHono();

    expectTypeOf(app.route('/sub', sub)).toEqualTypeOf<StandardOpenAPIHono<MyEnv, BlankSchema, '/'>>();
  });
});
