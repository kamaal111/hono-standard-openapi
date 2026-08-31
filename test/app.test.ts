import assert from 'node:assert/strict';

import { toStandardJsonSchema } from '@valibot/to-json-schema';
import vine from '@vinejs/vine';
import { type as arkType } from 'arktype';
import { Hono } from 'hono';
import * as S from 'sury';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as zMini from 'zod/mini';

import { standardSchema } from './helpers.ts';
import { $, StandardOpenAPIHono } from '../src/app.ts';
import type { JsonObject } from '../src/json-value.ts';
import { createRoute } from '../src/route.ts';
import type { StandardSchema } from '../src/standard-schema.ts';

const JSON_TYPE = 'application/json';

const DOC_CONFIG = { info: { title: 'Test', version: '1.0.0' }, openapi: '3.1.1' };

S.enableStandardJSONSchema();

/** Reads a response body as a JSON object. */
async function readJson(response: Response): Promise<JsonObject> {
  return JSON.parse(await response.text());
}

function issueCount(body: JsonObject): number {
  const error = body.error;
  assert(Array.isArray(error), 'Expected the response to contain validation issues.');

  return error.length;
}

type SchemaLibrary = {
  readonly name: string;
  createCardResponse(): StandardSchema;
  createCookieSchema(): StandardSchema;
  createNameSchema(): StandardSchema;
  createStringSchema(): StandardSchema;
  createTokenHeaderSchema(): StandardSchema;
  createUppercaseTokenHeaderSchema(): StandardSchema;
  createUUIDParamsSchema(): StandardSchema;
};

const schemaLibraries: readonly SchemaLibrary[] = [
  {
    name: 'ArkType',
    createCardResponse: () => arkType({ id: 'string' }),
    createCookieSchema: () => arkType({ session: 'string' }),
    createNameSchema: () => arkType({ name: 'string' }),
    createStringSchema: () => arkType('string'),
    createTokenHeaderSchema: () => arkType({ 'x-token': 'string' }),
    createUppercaseTokenHeaderSchema: () => arkType({ 'X-Token': 'string' }),
    createUUIDParamsSchema: () => arkType({ cardId: 'string.uuid' }),
  },
  {
    name: 'Zod',
    createCardResponse: () => z.object({ id: z.string() }),
    createCookieSchema: () => z.object({ session: z.string() }),
    createNameSchema: () => z.object({ name: z.string() }),
    createStringSchema: () => z.string(),
    createTokenHeaderSchema: () => z.object({ 'x-token': z.string() }),
    createUppercaseTokenHeaderSchema: () => z.object({ 'X-Token': z.string() }),
    createUUIDParamsSchema: () => z.object({ cardId: z.uuid() }),
  },
  {
    name: 'Zod Mini',
    createCardResponse: () => zMini.toJSONSchema(zMini.object({ id: zMini.string() })),
    createCookieSchema: () => zMini.toJSONSchema(zMini.object({ session: zMini.string() })),
    createNameSchema: () => zMini.toJSONSchema(zMini.object({ name: zMini.string() })),
    createStringSchema: () => zMini.toJSONSchema(zMini.string()),
    createTokenHeaderSchema: () => zMini.toJSONSchema(zMini.object({ 'x-token': zMini.string() })),
    createUppercaseTokenHeaderSchema: () => zMini.toJSONSchema(zMini.object({ 'X-Token': zMini.string() })),
    createUUIDParamsSchema: () => zMini.toJSONSchema(zMini.object({ cardId: zMini.uuid() })),
  },
  {
    name: 'Valibot',
    createCardResponse: () => toStandardJsonSchema(v.object({ id: v.string() })),
    createCookieSchema: () => toStandardJsonSchema(v.object({ session: v.string() })),
    createNameSchema: () => toStandardJsonSchema(v.object({ name: v.string() })),
    createStringSchema: () => toStandardJsonSchema(v.string()),
    createTokenHeaderSchema: () => toStandardJsonSchema(v.object({ 'x-token': v.string() })),
    createUppercaseTokenHeaderSchema: () => toStandardJsonSchema(v.object({ 'X-Token': v.string() })),
    createUUIDParamsSchema: () => toStandardJsonSchema(v.object({ cardId: v.pipe(v.string(), v.uuid()) })),
  },
  {
    name: 'Sury',
    createCardResponse: () => S.schema({ id: S.string }),
    createCookieSchema: () => S.schema({ session: S.string }),
    createNameSchema: () => S.schema({ name: S.string }),
    createStringSchema: () => S.string,
    createTokenHeaderSchema: () => S.schema({ 'x-token': S.string }),
    createUppercaseTokenHeaderSchema: () => S.schema({ 'X-Token': S.string }),
    createUUIDParamsSchema: () => S.schema({ cardId: S.uuid }),
  },
  {
    name: 'VineJS',
    createCardResponse: () => vine.create({ id: vine.string() }),
    createCookieSchema: () => vine.create({ session: vine.string() }),
    createNameSchema: () => vine.create({ name: vine.string() }),
    createStringSchema: () => vine.create(vine.string()),
    createTokenHeaderSchema: () => vine.create({ 'x-token': vine.string() }),
    createUppercaseTokenHeaderSchema: () => vine.create({ 'X-Token': vine.string() }),
    createUUIDParamsSchema: () => vine.create({ cardId: vine.string().uuid() }),
  },
];

function createCardRoute(library: SchemaLibrary) {
  return createRoute({
    method: 'get',
    path: '/cards/{cardId}',
    request: { params: library.createUUIDParamsSchema() },
    responses: {
      200: { content: { [JSON_TYPE]: { schema: library.createCardResponse() } }, description: 'ok' },
    },
  });
}

describe.each(schemaLibraries)('$name routing', library => {
  const cardRoute = createCardRoute(library);

  it('serves an OpenAPI path as a Hono path', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(cardRoute, c => c.json({ id: '550e8400-e29b-41d4-a716-446655440000' }));

    const response = await app.request('/cards/550e8400-e29b-41d4-a716-446655440000');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: '550e8400-e29b-41d4-a716-446655440000' });
  });

  it('documents the route at the path it was written with', () => {
    const app = new StandardOpenAPIHono();
    app.openapi(cardRoute, c => c.json({ id: 'x' }));

    expect(Object.keys(app.getOpenAPIDocument(DOC_CONFIG).paths ?? {})).toEqual(['/cards/{cardId}']);
  });

  it('keeps a hidden route out of the document while still serving it', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi({ ...cardRoute, hide: true }, c => c.json({ id: 'x' }));

    expect(app.getOpenAPIDocument(DOC_CONFIG).paths).toEqual({});
    expect((await app.request('/cards/550e8400-e29b-41d4-a716-446655440000')).status).toBe(200);
  });

  it('runs route middleware before the handler', async () => {
    const app = new StandardOpenAPIHono();
    const seen: string[] = [];
    app.openapi(
      {
        ...cardRoute,
        middleware: async (_c, next) => {
          seen.push('middleware');
          await next();
        },
      },
      c => {
        seen.push('handler');

        return c.json({ id: 'x' });
      },
    );

    await app.request('/cards/550e8400-e29b-41d4-a716-446655440000');

    expect(seen).toEqual(['middleware', 'handler']);
  });

  it('runs every middleware in an array', async () => {
    const app = new StandardOpenAPIHono();
    const seen: string[] = [];
    app.openapi(
      {
        ...cardRoute,
        middleware: [
          async (_c, next) => {
            seen.push('first');
            await next();
          },
          async (_c, next) => {
            seen.push('second');
            await next();
          },
        ],
      },
      c => c.json({ id: 'x' }),
    );

    await app.request('/cards/550e8400-e29b-41d4-a716-446655440000');

    expect(seen).toEqual(['first', 'second']);
  });

  it('takes a mounted app’s routes into its own document, under the mount path', () => {
    const cards = new StandardOpenAPIHono();
    cards.openapi(createRoute({ ...cardRoute, path: '/{cardId}' }), c => c.json({ id: 'x' }));
    const root = new StandardOpenAPIHono();
    root.route('/cards', cards);

    expect(Object.keys(root.getOpenAPIDocument(DOC_CONFIG).paths ?? {})).toEqual(['/cards/{cardId}']);
  });

  it('serves the document as JSON', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(cardRoute, c => c.json({ id: 'x' }));
    app.doc('/spec.json', DOC_CONFIG);

    const document = await readJson(await app.request('/spec.json'));

    expect(document.info).toEqual({ title: 'Test', version: '1.0.0' });
  });

  it('mounts a plain Hono-compatible app without trying to absorb a registry', async () => {
    const plain = new Hono().get('/health', c => c.text('ok'));
    const app = new StandardOpenAPIHono();
    app.route('/plain', plain);

    expect((await app.request('/plain/health')).status).toBe(200);
  });

  it('preserves the app type through the chaining helper', () => {
    const app = new StandardOpenAPIHono();

    expect($(app)).toBe(app);
  });

  it('rejects a plain Hono app in the chaining helper', () => {
    expect(() => $(new Hono())).toThrow('The chaining helper only accepts a StandardOpenAPIHono instance.');
  });

  it('serves routes that have no request schemas', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(createRoute({ method: 'get', path: '/health', responses: { 200: { description: 'ok' } } }), c =>
      c.text('ok'),
    );

    await expect((await app.request('/health')).text()).resolves.toBe('ok');
  });
});

describe.each(schemaLibraries)('$name validation', library => {
  const cardRoute = createCardRoute(library);

  it('answers a bad request with the issues that were found', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(cardRoute, c => c.json({ id: 'x' }));

    const response = await app.request('/cards/not-a-uuid');

    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(issueCount(body)).toBeGreaterThan(0);
  });

  it('hands failures to the hook the route was registered with', async () => {
    const app = new StandardOpenAPIHono();
    const seen: { success: boolean; target: string }[] = [];
    app.openapi(
      cardRoute,
      c => c.json({ id: 'x' }),
      (result, c) => {
        seen.push({ success: result.success, target: result.target });

        return result.success ? undefined : c.json({ from: 'hook' }, 422);
      },
    );

    const response = await app.request('/cards/not-a-uuid');

    expect(response.status).toBe(422);
    expect(seen[0]?.target).toBe('param');
    expect(seen[0]?.success).toBe(false);
  });

  it('lets a hook intercept successful validation', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(
      cardRoute,
      c => c.json({ id: 'handler' }),
      (result, c) => (result.success ? c.json({ id: 'hook' }, 202) : undefined),
    );

    const response = await app.request('/cards/550e8400-e29b-41d4-a716-446655440000');

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: 'hook' });
  });

  it('awaits an async hook before continuing validation', async () => {
    const app = new StandardOpenAPIHono();
    app.openapi(
      cardRoute,
      c => c.json({ id: 'handler' }),
      async result =>
        result.success ? new Response(JSON.stringify({ id: 'async-hook' }), { status: 202 }) : undefined,
    );

    const response = await app.request('/cards/550e8400-e29b-41d4-a716-446655440000');

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: 'async-hook' });
  });

  it('falls back to the hook of the app it is mounted under', async () => {
    const cards = new StandardOpenAPIHono();
    cards.openapi(createRoute({ ...cardRoute, path: '/{cardId}' }), c => c.json({ id: 'x' }));
    const root = new StandardOpenAPIHono({
      defaultHook: (result, c) => (result.success ? undefined : c.json({ from: 'parent' }, 418)),
    });
    root.route('/cards', cards);

    const response = await root.request('/cards/not-a-uuid');

    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toEqual({ from: 'parent' });
  });

  it('prefers the app’s own hook over the one above it', async () => {
    const cards = new StandardOpenAPIHono({
      defaultHook: (result, c) => (result.success ? undefined : c.json({ from: 'own' }, 409)),
    });
    cards.openapi(createRoute({ ...cardRoute, path: '/{cardId}' }), c => c.json({ id: 'x' }));
    const root = new StandardOpenAPIHono({
      defaultHook: (result, c) => (result.success ? undefined : c.json({ from: 'parent' }, 418)),
    });
    root.route('/cards', cards);

    expect((await root.request('/cards/not-a-uuid')).status).toBe(409);
  });

  it('walks through an intermediate app to find a default hook', async () => {
    const cards = new StandardOpenAPIHono();
    cards.openapi(createRoute({ ...cardRoute, path: '/{cardId}' }), c => c.json({ id: 'x' }));
    const middle = new StandardOpenAPIHono();
    middle.route('/cards', cards);
    const root = new StandardOpenAPIHono({
      defaultHook: (result, c) => (result.success ? undefined : c.json({ from: 'root' }, 417)),
    });
    root.route('/api', middle);

    expect((await root.request('/api/cards/not-a-uuid')).status).toBe(417);
  });

  it('stops looking for a default hook when mounted apps form a cycle', () => {
    const first = new StandardOpenAPIHono();
    const second = new StandardOpenAPIHono();
    first.route('/second', second);
    second.route('/first', first);

    expect(first.getDefaultHook()).toBeUndefined();
  });

  it('validates headers declared with lowercase schema keys', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'get',
      path: '/whoami',
      request: { headers: library.createTokenHeaderSchema() },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ token: c.req.header('x-token') }));

    const response = await app.request('/whoami', { headers: { 'X-Token': 'shouted' } });

    await expect(response.json()).resolves.toEqual({ token: 'shouted' });
  });

  it('does not recase header names for schema properties', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'get',
      path: '/uppercase-header',
      request: { headers: library.createUppercaseTokenHeaderSchema() },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.text('ok'));

    expect((await app.request('/uppercase-header', { headers: { 'x-token': 'value' } })).status).toBe(400);
  });

  it('lets a request through when an optional body is absent', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'post',
      path: '/things',
      request: { body: { content: { [JSON_TYPE]: { schema: library.createNameSchema() } } } },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ body: {} }));

    const response = await app.request('/things', { method: 'post' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ body: {} });
  });

  it('validates a body that is sent', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'post',
      path: '/things',
      request: {
        body: { content: { [JSON_TYPE]: { schema: library.createNameSchema() } }, required: true },
      },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ body: {} }));

    const response = await app.request('/things', {
      body: JSON.stringify({ name: 42 }),
      headers: { 'content-type': JSON_TYPE },
      method: 'post',
    });

    expect(response.status).toBe(400);
  });

  it('validates optional JSON bodies when their content type is present', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'post',
      path: '/things',
      request: {
        body: { content: { [`${JSON_TYPE}; charset=utf-8`]: { schema: library.createNameSchema() } } },
      },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ body: { name: 'thing' } }));

    const response = await app.request('/things', {
      body: JSON.stringify({ name: 'thing' }),
      headers: { 'content-type': `${JSON_TYPE}; charset=utf-8` },
      method: 'post',
    });

    await expect(response.json()).resolves.toEqual({ body: { name: 'thing' } });
  });

  it('validates form bodies', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'post',
      path: '/forms',
      request: {
        body: { content: { 'application/x-www-form-urlencoded': { schema: library.createNameSchema() } } },
      },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ body: { name: 'thing' } }));

    const response = await app.request('/forms', {
      body: new URLSearchParams({ name: 'thing' }),
      method: 'post',
    });

    await expect(response.json()).resolves.toEqual({ body: { name: 'thing' } });
  });

  it('ignores bodies that cannot be validated or mapped to a Hono target', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'post',
      path: '/binary',
      request: {
        body: {
          content: {
            'application/octet-stream': { schema: library.createStringSchema() },
            'text/plain': { schema: { type: 'string' } },
          },
        },
      },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.text('ok'));

    await expect((await app.request('/binary', { body: 'raw', method: 'post' })).text()).resolves.toBe('ok');
  });

  it('validates cookies and tolerates schemas whose properties cannot be inspected', async () => {
    const app = new StandardOpenAPIHono();
    const throwingSchema: StandardSchema = {
      '~standard': {
        jsonSchema: {
          input: () => {
            throw new Error('cannot describe');
          },
          output: () => ({ type: 'object' }),
        },
        validate: value => ({ value }),
        vendor: 'test',
        version: 1,
      },
    };
    const route = createRoute({
      method: 'get',
      path: '/session',
      request: { cookies: library.createCookieSchema(), headers: throwingSchema },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ session: c.req.header('cookie')?.replace('session=', '') }));

    const response = await app.request('/session', { headers: { cookie: 'session=abc' } });

    await expect(response.json()).resolves.toEqual({ session: 'abc' });
  });

  it('keeps header input unchanged when its schema has no object properties', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'get',
      path: '/headers',
      request: { headers: standardSchema({ input: { type: 'string' } }) },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json({ headers: c.req.valid('header') }));

    const response = await app.request('/headers', { headers: { 'x-token': 'value' } });

    expect(response.status).toBe(200);
  });

  it('preserves header names that the schema does not declare', async () => {
    const app = new StandardOpenAPIHono();
    const route = createRoute({
      method: 'get',
      path: '/extra-header',
      request: {
        headers: standardSchema({
          input: { properties: { Expected: { type: 'string' } }, type: 'object' },
        }),
      },
      responses: { 200: { description: 'ok' } },
    });
    app.openapi(route, c => c.json(c.req.valid('header')));

    const response = await app.request('/extra-header', { headers: { 'x-extra': 'value' } });

    await expect(response.json()).resolves.toMatchObject({ 'x-extra': 'value' });
  });
});
