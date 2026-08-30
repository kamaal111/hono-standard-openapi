# Using GraphQL Standard Schema

Install GraphQL Standard Schema and generate route schemas from GraphQL fragments or operations:

```sh
pnpm add graphql @apollo/graphql-standard-schema @kamaalio/hono-standard-openapi
```

```ts
import { GraphQLStandardSchemaGenerator } from '@apollo/graphql-standard-schema';
import { createRoute } from '@kamaalio/hono-standard-openapi';
import { parse } from 'graphql';

const generator = new GraphQLStandardSchemaGenerator({
  schema: parse('type Query { card: Card } type Card { id: ID! name: String! }'),
});
const Card = generator.getFragmentSchema(parse('fragment CardDetails on Card { id name }'));

createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  responses: { 200: { content: { 'application/json': { schema: Card.serialize } }, description: 'A card' } },
});
```

Use generated variables schemas for request data. Generated fragments include `__typename` by
default. To reuse a fragment as an OpenAPI component, register it with
`app.openAPIRegistry.register('Card', Card.serialize)` because GraphQL schemas do not provide `$id`.

## Single-endpoint example

GraphQL itself is normally a single endpoint. The TypeScript snapshot test in
[`test/graphql-standard-schema.example.test.ts`](../test/graphql-standard-schema.example.test.ts)
builds a `POST /graphql` app and compares the JSON Schema generated for `GetCard` with the
reviewable [`get-card.schema.json`](../test/fixtures/graphql-standard-schema/get-card.schema.json)
fixture. The normal test suite verifies it in CI, so a specification change is a visible review
decision rather than an accidental regression.
