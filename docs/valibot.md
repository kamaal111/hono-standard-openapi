# Using Valibot

## Install

```sh
pnpm add hono valibot @valibot/to-json-schema @kamaalio/hono-standard-openapi
```

## Define schemas and a route

Wrap Valibot schemas with `toStandardJsonSchema()` before placing them in a route.

```ts
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

const Price = v.object({ amount: v.number() });
const Card = v.object({ id: v.string(), name: v.pipe(v.string(), v.examples(['Luffy'])), price: Price });
const ErrorResponse = v.object({ code: v.string(), message: v.string() });
const CardSchema = toStandardJsonSchema(Card);
const ErrorResponseSchema = toStandardJsonSchema(ErrorResponse);

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: toStandardJsonSchema(v.object({ cardId: v.string() })) },
  responses: {
    200: {
      description: 'A card',
      content: { 'application/json': { schema: CardSchema } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Card not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});
```

Path parameter names and locations come from the route path and object key. Use Valibot metadata
for an example:

```ts
request: {
  params: toStandardJsonSchema(
    v.object({ cardId: v.pipe(v.string(), v.minLength(3), v.examples(['1212121'])) }),
  ),
},
```

For `/cards/{cardId}`, this generates a required `path` parameter named `cardId`. Valibot emits
the JSON Schema `examples: ['1212121']` array.

Valibot emits JSON Schema's `examples` array, so use `v.examples([value])` for schema examples.
Use the library-neutral `content.example` field for a concrete response example; see the
[README](../README.md#add-response-examples).

## Create the app

Give the converter the schemas that should become components. Pass the same definitions when the
document is generated.

```ts
const app = new StandardOpenAPIHono();

app.openapi(route, c => {
  const { cardId } = c.req.valid('param');

  if (cardId === 'missing') {
    return c.json({ code: 'CARD_NOT_FOUND', message: 'Card not found' }, 404);
  }

  return c.json({ id: cardId, name: 'Luffy', price: { amount: 12 } });
});

app.doc(
  '/openapi.json',
  {
    openapi: '3.1.1',
    info: { title: 'Cards', version: '1.0.0' },
  },
  {
    libraryOptions: { definitions: { Card, ErrorResponse, Price } },
  },
);
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

If a Valibot schema transforms a value during validation (`v.transform()`), the generated response
schema still describes the value as it looked before validation, not the transformed value your
handler returns.
