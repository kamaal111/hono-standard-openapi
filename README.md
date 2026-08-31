# hono-standard-openapi

Generate OpenAPI 3.1 documents from Hono routes written with any Standard Schema-compatible
validator. Routes validate requests, infer handler types, and generate a matching OpenAPI document.

## Index

- [Installation](#installation)
- [Schema-library support](#schema-library-support)
- [Set up a route](#set-up-a-route)
- [Add middleware to a route](#add-middleware-to-a-route)
- [Add response examples](#add-response-examples)
- [Handle validation errors](#handle-validation-errors)
- [Read the OpenAPI document](#read-the-openapi-document)
- [Composing schemas](./docs/composing-schemas.md)
- [Using ArkType](./docs/arktype.md)
- [Using Zod](./docs/zod.md)
- [Using Valibot](./docs/valibot.md)
- [Using Sury](./docs/sury.md)
- [Using VineJS](./docs/vinejs.md)

## Installation

```sh
pnpm add hono @kamaalio/hono-standard-openapi
```

Install one supported schema library as well. The examples below use Zod:

```sh
pnpm add zod
```

## Schema-library support

The libraries below are supported for request validation and OpenAPI generation.

| Library                            | Request validation | OpenAPI schemas | Named components                |
| ---------------------------------- | ------------------ | --------------- | ------------------------------- |
| [ArkType](./docs/arktype.md)       | ✅                 | ✅              | ✅                              |
| [Zod](./docs/zod.md)               | ✅                 | ✅              | ✅                              |
| [Zod Mini](./docs/zod.md#zod-mini) | ✅                 | ✅              | ✅                              |
| [Valibot](./docs/valibot.md)       | ✅                 | ✅              | ✅                              |
| [Sury](./docs/sury.md)             | ✅                 | ✅              | ❌ — schemas are emitted inline |
| [VineJS](./docs/vinejs.md)         | ✅                 | ✅              | ❌ — schemas are emitted inline |

Sury requires `S.enableStandardJSONSchema()` once before routes are registered.
Its schemas do not currently emit names for reusable OpenAPI components, so
their generated OpenAPI schemas remain inline.

VineJS v4.3.0 and later exposes compiled validators through its Standard JSON
Schema input converter. Its response schemas are emitted inline.

## Set up a route

Define the request and response schemas, describe the route with `createRoute`, then register it
with `app.openapi()`. The handler receives validated values through `c.req.valid()`.

```ts
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import { z } from 'zod';

const Card = z.object({ id: z.string(), name: z.string() }).meta({ $id: 'Card' });

const getCard = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: z.object({ cardId: z.string() }) },
  responses: {
    200: {
      description: 'A card',
      content: { 'application/json': { schema: Card } },
    },
  },
});

const app = new StandardOpenAPIHono();

app.openapi(getCard, c => {
  const { cardId } = c.req.valid('param');

  return c.json({ id: cardId, name: 'Luffy' }, 200);
});
```

Use `$id` once to make a schema a reusable OpenAPI component. The generated response then refers
to `#/components/schemas/Card`. See the guides for nested components, multiple responses, errors,
ArkType metadata, and the Valibot converter setup.

## Add middleware to a route

Set `middleware` on the route to run one Hono middleware function, or an array of them, before
this route's request validation and handler. It affects serving the route only; it is not included
in the OpenAPI document.

```ts
const getCard = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  middleware: [
    async (c, next) => {
      if (c.req.header('authorization') == null) return c.json({ message: 'Unauthorized' }, 401);

      await next();
    },
  ],
  request: { params: z.object({ cardId: z.string() }) },
  responses: {
    200: { description: 'A card' },
    401: { description: 'Unauthorized' },
  },
});
```

## Add response examples

Put an OpenAPI `example` next to a response media type. This is independent of the schema library,
so it works with ArkType, Zod, Valibot, Sury, and every other supported Standard Schema library:

```ts
responses: {
  200: {
    description: 'A card',
    content: {
      'application/json': {
        schema: Card,
        example: { id: 'card-1', name: 'Luffy' },
      },
    },
  },
},
```

The generated document puts it at
`paths./cards/{cardId}.get.responses.200.content.application/json.example`.

## Handle validation errors

Requests use [`@hono/standard-validator`](https://www.npmjs.com/package/@hono/standard-validator).
Failures return its standard `400` JSON body with `success: false`, the raw `data`, and an `error`
array. Header schema property names must be lowercase because Hono normalizes request headers. Set
`defaultHook` on the app to return your own error shape consistently across routes:

```ts
const app = new StandardOpenAPIHono({
  defaultHook: (result, c) =>
    result.success ? undefined : c.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, 400),
});
```

Document that `400` response in each route when it is part of your API contract.

## Read the OpenAPI document

Add `app.doc()` after registering routes. It serves the generated OpenAPI 3.1 JSON at the path you
choose:

```ts
app.doc('/openapi.json', {
  openapi: '3.1.1',
  info: { title: 'Cards API', version: '1.0.0' },
});

export default app;
```

With the app running, retrieve the specification from `GET /openapi.json`:

```sh
curl http://localhost:3000/openapi.json
```

Use that JSON endpoint as the input to Swagger UI, Scalar, or an OpenAPI code generator. For code
that needs the document directly, call `app.getOpenAPIDocument(config)` with the same configuration.

## Guides

- [Compose schemas](./docs/composing-schemas.md): combine several schemas — possibly from different
  libraries — into one response with `allOf` and `objectSchema`.
- [Use ArkType](./docs/arktype.md): native JSON Schema, components, multiple responses, and errors.
- [Use Zod](./docs/zod.md): components, multiple responses, and validation errors.
- [Use Valibot](./docs/valibot.md): converter setup, components, multiple responses, and errors.
- [Use Sury](./docs/sury.md): native JSON Schema and request validation.
- [Use VineJS](./docs/vinejs.md): native Standard JSON Schema and request validation.
