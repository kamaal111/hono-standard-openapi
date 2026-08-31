# Using ArkType

## Install

```sh
pnpm add hono arktype @kamaalio/hono-standard-openapi
```

## Define schemas and a route

ArkType implements Standard JSON Schema natively, so use `type()` schemas directly in a route. Give
each reusable schema a `$id` through `.configure()`; it works for schemas used directly in requests
or responses and for schemas nested inside another schema. Declare `$id` as custom ArkType metadata
once so TypeScript accepts it.

```ts
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import { type } from 'arktype';

declare global {
  interface ArkEnv {
    meta(): { $id?: string };
  }
}

const Price = type({ amount: 'number' }).configure({ $id: 'Price' });
const Card = type({
  id: 'string',
  name: type('string').configure({ examples: ['Luffy'] }),
  price: Price,
}).configure({ $id: 'Card', title: 'Card' });
const ErrorResponse = type({ code: 'string', message: 'string' }).configure({ $id: 'ErrorResponse' });

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: type({ cardId: 'string' }) },
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

Path parameter names and locations come from the route path and object key. Configure the property
schema with JSON Schema metadata for a parameter example:

```ts
request: {
  params: type({
    cardId: type('string >= 3').configure({ examples: ['1212121'] }),
  }),
},
```

For `/cards/{cardId}`, this generates a required `path` parameter named `cardId`, whose schema
includes `examples: ['1212121']`.

Use `.configure({ examples: [value] })` when the JSON Schema itself should carry examples. Use the
library-neutral `content.example` field for a concrete response example; see the
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

ArkType throws when a schema cannot be represented as JSON Schema (for example, some transforms or
custom predicates). Keep route schemas JSON-Schema-compatible, or configure ArkType's JSON Schema
fallback behavior before generating the document.

ArkType's converter also throws for the `"openapi-3.0"` JSON Schema target, so `app.doc()` and
`getOpenAPIDocument()` can only generate `version: '3.1'` documents (the default) for routes built
with ArkType schemas. Requesting `version: '3.0'` throws. See the
[schema-library support table](../README.md#schema-library-support) for how this compares to the
other supported libraries.
