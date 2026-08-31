# Using VineJS

VineJS v4.3.0 and later implements Standard JSON Schema. Pass a compiled VineJS validator directly
to `createRoute`; `StandardOpenAPIHono` uses it for request validation and generates the OpenAPI
schema from the same validator.

## Define schemas and a route

```ts
import vine from '@vinejs/vine';
import { createRoute, StandardOpenAPIHono } from '@kamaalio/hono-standard-openapi';

const Card = vine.create({
  id: vine.string().uuid(),
  name: vine.string(),
});

const getCard = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: vine.create({ cardId: vine.string().uuid() }) },
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

VineJS exposes compiled validators through its Standard JSON Schema `input` converter. The package
uses that same schema for response documentation because a compiled VineJS validator validates and
returns the same object shape. VineJS emits each schema inline, so the example response schema is
written directly in the OpenAPI operation rather than being automatically hoisted into
`components.schemas`.
