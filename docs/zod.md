# Using Zod

## Install

```sh
pnpm add hono zod @kamaalio/hono-standard-openapi
```

## Zod Mini

Zod Mini schemas need `z.toJSONSchema()` before they can be used in a route. The wrapper preserves
validation and adds the Standard JSON Schema conversion that generates the OpenAPI document. Use
Mini's `.check()` API to attach metadata and constraints.

```ts
import { createRoute } from '@kamaalio/hono-standard-openapi';
import * as z from 'zod/mini';

const Price = z.object({ amount: z.number() }).check(z.meta({ $id: 'Price' }));
const Card = z
  .object({
    id: z.string(),
    name: z.string().check(z.meta({ examples: ['Luffy'] })),
    price: Price,
  })
  .check(z.meta({ $id: 'Card' }));
const ErrorResponse = z.object({ code: z.string(), message: z.string() }).check(z.meta({ $id: 'ErrorResponse' }));

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: {
    params: z.toJSONSchema(
      z.object({
        cardId: z.string().check(z.minLength(3), z.meta({ examples: ['1212121'] })),
      }),
    ),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.toJSONSchema(Card) } }, description: 'A card' },
    400: { content: { 'application/json': { schema: z.toJSONSchema(ErrorResponse) } }, description: 'Invalid request' },
  },
});
```

`$id` values work the same way as full Zod: `Card`, `Price`, and `ErrorResponse` become reusable
OpenAPI components. Wrap each Mini schema passed to `request` or `responses`; the rest of this guide
uses full Zod's instance API.

## Define schemas and a route

Use Zod's normal `.meta()` API. Give every schema you want to share one `$id`. It works whether the
schema is used directly in a request or response, or nested inside another schema.

```ts
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import { z } from 'zod';

const Price = z.object({ amount: z.number() }).meta({ $id: 'Price' });
const Card = z.object({ id: z.string(), name: z.string().meta({ examples: ['Luffy'] }), price: Price }).meta({
  $id: 'Card',
  title: 'Card',
});
const ErrorResponse = z.object({ code: z.string(), message: z.string() }).meta({ $id: 'ErrorResponse' });

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: z.object({ cardId: z.string() }) },
  responses: {
    200: {
      description: 'A card',
      content: { 'application/json': { schema: Card } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'Card not found',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
```

Path parameter names and locations come from the route path and object key, so no separate Zod
extension is needed. Use normal Zod metadata for the parameter's example:

```ts
request: {
  params: z.object({
    cardId: z.string().min(3).meta({ examples: ['1212121'] }),
  }),
},
```

For `/cards/{cardId}`, this generates a required `path` parameter named `cardId`, whose schema
includes `examples: ['1212121']`.

Use `.meta({ examples: [value] })` on a Zod schema when the JSON Schema itself should carry
examples. Use the library-neutral `content.example` field for a concrete response example; see the
[README](../README.md#add-response-examples).

## Create the app

```ts
const app = new StandardOpenAPIHono();

app.openapi(route, c => {
  const { cardId } = c.req.valid('param');

  if (cardId === 'missing') {
    return c.json({ code: 'CARD_NOT_FOUND', message: 'Card not found' }, 404);
  }

  return c.json({ id: cardId, name: 'Luffy', price: { amount: 12 } });
});

app.doc('/openapi.json', {
  openapi: '3.1.1',
  info: { title: 'Cards', version: '1.0.0' },
});
```

The generated document contains `Card`, `Price`, and `ErrorResponse` in `components.schemas`:

```json
{
  "paths": {
    "/cards/{cardId}": {
      "get": {
        "responses": {
          "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Card" } } } },
          "400": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
          "404": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
        }
      }
    }
  }
}
```
