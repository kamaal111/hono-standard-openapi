# Using Sury

## Install

```sh
pnpm add hono sury @kamaalio/hono-standard-openapi
```

## Enable JSON Schema and define a route

Sury implements Standard Schema directly. Enable its opt-in Standard JSON Schema
extension once before registering routes so the OpenAPI generator can describe
each schema.

```ts
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';
import * as S from 'sury';

S.enableStandardJSONSchema();

const Card = S.schema({ id: S.string, name: S.string });
const ErrorResponse = S.schema({ code: S.string, message: S.string });

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: S.schema({ cardId: S.uuid }) },
  responses: {
    200: {
      description: 'A card',
      content: { 'application/json': { schema: Card } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

const app = new StandardOpenAPIHono();

app.openapi(route, c => {
  const { cardId } = c.req.valid('param');

  return c.json({ id: cardId, name: 'Luffy' });
});
```

Sury schemas are used directly for request validation and OpenAPI generation.
Its converter describes the input schema, so transformed Sury schemas document
the format API clients send. Use Sury's `S.meta` to add titles, descriptions,
or schema examples.
