import { toStandardJsonSchema } from '@valibot/to-json-schema';
import vine from '@vinejs/vine';
import { type as arkType } from 'arktype';
import { createMiddleware } from 'hono/factory';
import * as S from 'sury';
import * as v from 'valibot';
import { z } from 'zod';
import * as zMini from 'zod/mini';

import { type LibraryRecord, listLibraries } from './library-names.ts';
import { createRoute, StandardOpenAPIHono } from '../src/index.ts';
import type { StandardSchema } from '../src/standard-schema.ts';

const JSON_TYPE = 'application/json';

const documentConfig = { info: { title: 'Cards', version: '1.0.0' }, openapi: '3.1.0' } as const;

S.enableStandardJSONSchema();

interface SchemaLibrary {
  createMessageSchema(): StandardSchema;
  createOkSchema(): StandardSchema;
  createUserSchema(): StandardSchema;
  createUUIDParamsSchema(): StandardSchema;
}

const schemaLibraryRecord: LibraryRecord<SchemaLibrary> = {
  ArkType: {
    createMessageSchema: () => arkType({ message: 'string' }),
    createOkSchema: () => arkType({ ok: 'boolean' }),
    createUserSchema: () => arkType({ user: 'string' }),
    createUUIDParamsSchema: () => arkType({ cardId: 'string.uuid' }),
  },
  Sury: {
    createMessageSchema: () => S.schema({ message: S.string }),
    createOkSchema: () => S.schema({ ok: S.boolean }),
    createUserSchema: () => S.schema({ user: S.string }),
    createUUIDParamsSchema: () => S.schema({ cardId: S.uuid }),
  },
  Valibot: {
    createMessageSchema: () => toStandardJsonSchema(v.object({ message: v.string() })),
    createOkSchema: () => toStandardJsonSchema(v.object({ ok: v.boolean() })),
    createUserSchema: () => toStandardJsonSchema(v.object({ user: v.string() })),
    createUUIDParamsSchema: () => toStandardJsonSchema(v.object({ cardId: v.pipe(v.string(), v.uuid()) })),
  },
  VineJS: {
    createMessageSchema: () => vine.create({ message: vine.string() }),
    createOkSchema: () => vine.create({ ok: vine.boolean() }),
    createUserSchema: () => vine.create({ user: vine.string() }),
    createUUIDParamsSchema: () => vine.create({ cardId: vine.string().uuid() }),
  },
  Zod: {
    createMessageSchema: () => z.object({ message: z.string() }),
    createOkSchema: () => z.object({ ok: z.boolean() }),
    createUserSchema: () => z.object({ user: z.string() }),
    createUUIDParamsSchema: () => z.object({ cardId: z.uuid() }),
  },
  'Zod Compiled': {
    createMessageSchema: () => z.compile(z.object({ message: z.string() })),
    createOkSchema: () => z.compile(z.object({ ok: z.boolean() })),
    createUserSchema: () => z.compile(z.object({ user: z.string() })),
    createUUIDParamsSchema: () => z.compile(z.object({ cardId: z.uuid() })),
  },
  'Zod Mini': {
    createMessageSchema: () => zMini.toJSONSchema(zMini.object({ message: zMini.string() })),
    createOkSchema: () => zMini.toJSONSchema(zMini.object({ ok: zMini.boolean() })),
    createUserSchema: () => zMini.toJSONSchema(zMini.object({ user: zMini.string() })),
    createUUIDParamsSchema: () => zMini.toJSONSchema(zMini.object({ cardId: zMini.uuid() })),
  },
};

const schemaLibraries = listLibraries(schemaLibraryRecord);

function createCardsRoute(library: SchemaLibrary) {
  return createRoute({
    method: 'get',
    path: '/cards',
    responses: { 200: { content: { [JSON_TYPE]: { schema: library.createOkSchema() } }, description: 'ok' } },
  });
}

function createCardByIdRoute(library: SchemaLibrary) {
  return createRoute({
    method: 'get',
    path: '/cards/{cardId}',
    request: { params: library.createUUIDParamsSchema() },
    responses: { 200: { description: 'ok' } },
  });
}

describe.each(schemaLibraries)('$name basePath', library => {
  it('keeps serving and documenting under the prefix', async () => {
    const api = new StandardOpenAPIHono().basePath('/api');

    api.openapi(createCardsRoute(library), c => c.json({ ok: true }, 200));

    expect(Object.keys(api.getOpenAPIDocument(documentConfig).paths ?? {})).toEqual(['/api/cards']);
    expect((await api.request('/api/cards')).status).toBe(200);
    expect((await api.request('/cards')).status).toBe(404);
  });

  it('shares one registry with the app it came from', () => {
    const app = new StandardOpenAPIHono();
    const api = app.basePath('/api');

    api.openapi(createCardsRoute(library), c => c.json({ ok: true }, 200));

    expect(Object.keys(app.getOpenAPIDocument(documentConfig).paths ?? {})).toEqual(['/api/cards']);
  });

  it('carries the default hook across', async () => {
    const app = new StandardOpenAPIHono({
      defaultHook: (result, c) => (result.success ? undefined : c.text('rejected by the default hook', 418)),
    });

    app.basePath('/api').openapi(createCardByIdRoute(library), c => c.body(null, 200));

    const response = await app.request('/api/cards/not-a-uuid');

    expect(response.status).toBe(418);
    expect(await response.text()).toBe('rejected by the default hook');
  });

  it('validates a request that reaches a prefixed route', async () => {
    const api = new StandardOpenAPIHono().basePath('/api');

    api.openapi(createCardByIdRoute(library), c => c.body(null, 200));

    expect((await api.request('/api/cards/3f1b8d6e-58a1-4f0b-9f4a-2a1f5c7d9e00')).status).toBe(200);
    expect((await api.request('/api/cards/not-a-uuid')).status).toBe(400);
  });
});

describe.each(schemaLibraries)('$name response keys the document allows', library => {
  it('documents a status range and a default response verbatim', () => {
    const app = new StandardOpenAPIHono();

    const ranged = createRoute({
      method: 'get',
      path: '/ranged',
      responses: {
        '2XX': { content: { [JSON_TYPE]: { schema: library.createOkSchema() } }, description: 'fine' },
        default: { content: { [JSON_TYPE]: { schema: library.createMessageSchema() } }, description: 'bad' },
      },
    });

    app.openapi(ranged, c => c.json({ ok: true }, 200));

    const operation = app.getOpenAPIDocument(documentConfig).paths?.['/ranged']?.get;

    expect(Object.keys(operation?.responses ?? {})).toEqual(['2XX', 'default']);
  });
});

describe.each(schemaLibraries)('$name route middleware', library => {
  it('runs the middleware the route brings before the handler', async () => {
    const identify = createMiddleware<{ Variables: { user: string } }>(async (c, next) => {
      c.set('user', 'Ada');

      await next();
    });

    const app = new StandardOpenAPIHono();

    const whoami = createRoute({
      method: 'get',
      middleware: [identify],
      path: '/whoami',
      responses: { 200: { content: { [JSON_TYPE]: { schema: library.createUserSchema() } }, description: 'ok' } },
    });

    app.openapi(whoami, c => c.json({ user: c.var.user }, 200));

    expect(await (await app.request('/whoami')).json()).toEqual({ user: 'Ada' });
  });
});
