import { describe, expect, it } from 'vitest';

import { fetchDocument } from './helpers.ts';
import { schemaLibraries } from './schema-libraries.ts';
import type { RouteConfigBase, SchemaOrReference } from '../src/types.ts';

const DOC_CONFIG = {
  info: { title: 'Test', version: '1.0.0' },
  openapi: '3.1.1',
  servers: [{ url: 'https://api.example.com' }],
};
const JSON_TYPE = 'application/json';

function cardRoute(schema: SchemaOrReference): RouteConfigBase {
  return {
    method: 'get',
    path: '/cards',
    responses: { 200: { content: { [JSON_TYPE]: { schema } }, description: 'ok' } },
  };
}

describe.each(schemaLibraries)('$name', library => {
  it('matches the fixture without refs', async () => {
    const { libraryOptions, schema } = library.createUnnamedCardWithPrice();
    const response = await fetchDocument([cardRoute(schema)], DOC_CONFIG, { libraryOptions });
    const document = JSON.parse(await response.text());

    await expect(JSON.stringify(document, null, 2)).toMatchFileSnapshot('./fixtures/card-with-price.without-refs.json');
  });

  it.skipIf(!library.supportsComponents)('matches the fixture with refs', async () => {
    const { libraryOptions, schema } = library.createCardWithPrice();
    const response = await fetchDocument([cardRoute(schema)], DOC_CONFIG, { libraryOptions });
    const document = JSON.parse(await response.text());

    await expect(JSON.stringify(document, null, 2)).toMatchFileSnapshot('./fixtures/card-with-price.with-refs.json');
  });

  it.skipIf(library.supportsComponents)('matches the fixture without refs even from the named schema', async () => {
    const { libraryOptions, schema } = library.createCardWithPrice();
    const response = await fetchDocument([cardRoute(schema)], DOC_CONFIG, { libraryOptions });
    const document = JSON.parse(await response.text());

    await expect(JSON.stringify(document, null, 2)).toMatchFileSnapshot('./fixtures/card-with-price.without-refs.json');
  });
});
