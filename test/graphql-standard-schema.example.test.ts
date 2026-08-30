import { readFile } from 'node:fs/promises';

import { GraphQLStandardSchemaGenerator } from '@apollo/graphql-standard-schema';
import { buildASTSchema, graphql, parse } from 'graphql';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

const graphqlSchema = parse(`
  type Query { card(id: ID!): Card! }
  type Card { id: ID! name: String! }
`);
const operation = parse(`
  query GetCard($id: ID!) {
    card(id: $id) { __typename id name }
  }
`);
const generator = new GraphQLStandardSchemaGenerator({ schema: graphqlSchema });
const dataSchema = generator.getDataSchema(operation).serialize;

function createExampleApp() {
  const app = new Hono();
  const schema = buildASTSchema(graphqlSchema);

  app.post('/graphql', async c => {
    const { query, variables } = await c.req.json<{
      query: string;
      variables: Record<string, string>;
    }>();
    const result = await graphql({
      rootValue: { card: ({ id }: { id: string }) => ({ id, name: 'Luffy' }) },
      schema,
      source: query,
      variableValues: variables,
    });

    return c.json(result);
  });

  app.get('/schemas/get-card.json', c =>
    c.json(dataSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })),
  );

  return app;
}

describe('GraphQL Standard Schema example', () => {
  it('snapshots the JSON Schema for one operation served by a single GraphQL endpoint', async () => {
    const app = createExampleApp();
    const schemaResponse = await app.request('/schemas/get-card.json');
    const graphqlResponse = await app.request('/graphql', {
      body: JSON.stringify({
        query: 'query GetCard($id: ID!) { card(id: $id) { __typename id name } }',
        variables: { id: 'card-1' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(await graphqlResponse.json()).toEqual({
      data: { card: { __typename: 'Card', id: 'card-1', name: 'Luffy' } },
    });
    const expectedSchema = JSON.parse(
      await readFile(new URL('./fixtures/graphql-standard-schema/get-card.schema.json', import.meta.url), 'utf8'),
    );

    expect(await schemaResponse.json()).toEqual(expectedSchema);
  });
});
