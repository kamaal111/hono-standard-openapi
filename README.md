# hono-standard-openapi

Generate an OpenAPI document from a Hono app whose routes are described by
[Standard Schema](https://standardschema.dev) and
[Standard JSON Schema](https://standardschema.dev/json-schema).

The package is schema-library neutral: it consumes the validation and JSON Schema interfaces defined
by those specifications. Use your chosen implementation's normal mechanism to add JSON Schema
metadata, and the document follows.

```ts
import { StandardOpenAPIHono, createRoute, type StandardSchema } from 'hono-standard-openapi';

// Define these with any Standard Schema-compatible implementation.
declare const CardSchema: StandardSchema;
declare const CardParamsSchema: StandardSchema;

const route = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: CardParamsSchema },
  responses: {
    200: { description: 'The card', content: { 'application/json': { schema: CardSchema } } },
  },
});

const app = new StandardOpenAPIHono();
app.openapi(route, c => c.json(findCard(c.req.valid('param').cardId)));
app.doc('/spec.json', { openapi: '3.1.1', info: { title: 'Cards', version: '1.0.0' } });
```

`c.req.valid('param')` is typed from the schema, the request is validated before the handler runs,
and `/spec.json` describes the route — path parameters, response body, and a `Card` component the
response `$ref`s.

## Naming components

A schema becomes a named component by carrying `$id`. Anything without one is described inline.

`$id` is an ordinary JSON Schema keyword, so it can name a component wherever the schema appears,
including as a response root. See [docs/design.md](./docs/design.md) for the details.

Schemas that carry neither can be named from the outside:

```ts
app.openAPIRegistry.register('Card', CardSchema);
```

## Validation

Failures reach the route's hook, or the nearest `defaultHook` on the app or the app it is mounted
under, and otherwise answer `400`:

```ts
const app = new StandardOpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) throw new InvalidRequest(c, result.error.issues);
  },
});
```

`result.error.issues` is Standard Schema's issue list — `{ message, path? }` — plus whatever else the
schema library reports on each issue.

## Normalization

Converted JSON Schema is adjusted to read as an idiomatic OpenAPI document: the strictness marker
from stripping objects is dropped, a `pattern` implied by a `format` is dropped, a nullable union
becomes a nullable type, `const` becomes a single-value `enum`, and keywords are emitted in a
conventional order. Each is switchable:

```ts
app.getOpenAPIDocument(config, { normalization: { constToEnum: false } });
```
