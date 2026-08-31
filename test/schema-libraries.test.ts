import { describe, expect, it } from 'vitest';

import { fetchDocument, generateDocument } from './helpers.ts';
import { schemaLibraries } from './schema-libraries.ts';
import type { RouteConfigBase, SchemaOrReference } from '../src/types.ts';

const DOC_CONFIG = { info: { title: 'Test', version: '1.0.0' }, openapi: '3.1.1' };
const DOC_CONFIG_3_0 = { info: { title: 'Test', version: '1.0.0' }, openapi: '3.0.3' };
const JSON_TYPE = 'application/json';

const EXPECTED_NESTED_PRICE = { $ref: '#/components/schemas/Price' };
const EXPECTED_PRICE_COMPONENT = {
  properties: { amount: { type: 'number' } },
  required: ['amount'],
  type: 'object',
};
const EXPECTED_ERROR_RESPONSE_COMPONENT = {
  properties: { code: { type: 'string' }, message: { type: 'string' } },
  required: ['code', 'message'],
  type: 'object',
};

function jsonResponseRoute(schema: SchemaOrReference, path = '/things'): RouteConfigBase {
  return {
    method: 'get',
    path,
    responses: { 200: { content: { [JSON_TYPE]: { schema } }, description: 'ok' } },
  };
}

describe.each(schemaLibraries)('$name', library => {
  it('validates a card through the Standard Schema contract', async () => {
    const { schema: Card } = library.createCard();

    expect(await Card['~standard'].validate({ id: 'card-1', name: 'Luffy' })).toMatchObject({
      value: { id: 'card-1', name: 'Luffy' },
    });
    expect(await Card['~standard'].validate({ id: 'card-1' })).toHaveProperty('issues');
  });

  it.skipIf(!library.supportsComponents)('shares a named root schema across routes', async () => {
    const { libraryOptions, schema: Card } = library.createCard();
    const document = await generateDocument(
      [jsonResponseRoute(Card, '/a'), jsonResponseRoute(Card, '/b')],
      DOC_CONFIG,
      { libraryOptions },
    );

    expect(document.paths?.['/a']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Card',
    });
    expect(document.paths?.['/b']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Card',
    });
    expect(document.components?.schemas?.Card).toEqual({
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      type: 'object',
    });
  });

  it.skipIf(!library.supportsComponents)('preserves schema examples from the library converter', async () => {
    const { expectedNameSchema, libraryOptions, schema: Card } = library.createCardWithExample();
    const document = await generateDocument([jsonResponseRoute(Card)], DOC_CONFIG, { libraryOptions });

    expect(document.components?.schemas?.Card?.properties?.name).toEqual(expectedNameSchema);
  });

  it.skipIf(library.supportsComponents)('keeps schema examples inline instead of naming a component', async () => {
    const { expectedNameSchema, libraryOptions, schema: Card } = library.createCardWithExample();
    const document = await generateDocument([jsonResponseRoute(Card)], DOC_CONFIG, { libraryOptions });

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema.properties.name).toEqual(
      expectedNameSchema,
    );
    expect(document.components?.schemas?.Card).toBeUndefined();
  });

  it('uses schema examples on inferred path parameters', async () => {
    const { expectedNameSchema, schema } = library.createParamsWithExample();
    const route: RouteConfigBase = {
      method: 'get',
      path: '/cards/{id}',
      request: { params: schema },
      responses: { 200: { description: 'ok' } },
    };

    const document = await generateDocument([route], DOC_CONFIG);

    expect(document.paths?.['/cards/{id}']?.get?.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: expectedNameSchema },
    ]);
  });

  it.skipIf(library.supportsComponents)('emits unnamed schemas inline', async () => {
    const { schema: Card } = library.createCard();
    const document = await generateDocument([jsonResponseRoute(Card)], DOC_CONFIG);

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      type: 'object',
    });
  });

  it.skipIf(!library.supportsComponents)('shares a nested schema through an OpenAPI component reference', async () => {
    const { libraryOptions, schema: Card } = library.createCardWithPrice();
    const document = await generateDocument([jsonResponseRoute(Card)], DOC_CONFIG, { libraryOptions });

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Card',
    });
    expect(document.components?.schemas?.Card.properties.price).toEqual(EXPECTED_NESTED_PRICE);
    expect(document.components?.schemas?.Price).toEqual(EXPECTED_PRICE_COMPONENT);
  });

  it.skipIf(library.supportsComponents)('keeps a nested schema inline instead of referencing a component', async () => {
    const { libraryOptions, schema: Card } = library.createCardWithPrice();
    const document = await generateDocument([jsonResponseRoute(Card)], DOC_CONFIG, { libraryOptions });
    const schema = document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema;

    expect(schema.$ref).toBeUndefined();
    expect(schema.properties.price).toEqual(EXPECTED_PRICE_COMPONENT);
    expect(document.components?.schemas).toEqual({});
  });

  it.skipIf(!library.supportsComponents)('documents successful and error responses as components', async () => {
    const { card, error, libraryOptions } = library.createResponseSchemas();
    const document = await generateDocument(
      [
        {
          method: 'get',
          path: '/cards/{cardId}',
          responses: {
            200: {
              content: { [JSON_TYPE]: { example: { id: 'card-1', name: 'Luffy' }, schema: card } },
              description: 'A card',
            },
            400: { content: { [JSON_TYPE]: { schema: error } }, description: 'Invalid request' },
            404: { content: { [JSON_TYPE]: { schema: error } }, description: 'Card not found' },
          },
        },
      ],
      DOC_CONFIG,
      { libraryOptions },
    );

    expect(document.paths?.['/cards/{cardId}']?.get.responses).toEqual({
      200: {
        content: {
          [JSON_TYPE]: {
            example: { id: 'card-1', name: 'Luffy' },
            schema: { $ref: '#/components/schemas/Card' },
          },
        },
        description: 'A card',
      },
      400: {
        content: { [JSON_TYPE]: { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        description: 'Invalid request',
      },
      404: {
        content: { [JSON_TYPE]: { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        description: 'Card not found',
      },
    });
    expect(document.components?.schemas?.ErrorResponse).toEqual(EXPECTED_ERROR_RESPONSE_COMPONENT);
  });

  it.skipIf(library.supportsComponents)(
    'keeps successful and error responses inline instead of referencing components',
    async () => {
      const { card, error, libraryOptions } = library.createResponseSchemas();
      const document = await generateDocument(
        [
          {
            method: 'get',
            path: '/cards/{cardId}',
            responses: {
              200: {
                content: { [JSON_TYPE]: { example: { id: 'card-1', name: 'Luffy' }, schema: card } },
                description: 'A card',
              },
              400: { content: { [JSON_TYPE]: { schema: error } }, description: 'Invalid request' },
              404: { content: { [JSON_TYPE]: { schema: error } }, description: 'Card not found' },
            },
          },
        ],
        DOC_CONFIG,
        { libraryOptions },
      );
      const responses = document.paths?.['/cards/{cardId}']?.get.responses;

      expect(responses['200'].content[JSON_TYPE].schema.$ref).toBeUndefined();
      expect(responses['400'].content[JSON_TYPE].schema).toEqual(EXPECTED_ERROR_RESPONSE_COMPONENT);
      expect(responses['404'].content[JSON_TYPE].schema).toEqual(EXPECTED_ERROR_RESPONSE_COMPONENT);
      expect(document.components?.schemas).toEqual({});
    },
  );

  it.skipIf(!library.supportsOpenapi30Target)('renders a nullable field as OpenAPI 3.0 expects', async () => {
    const { schema } = library.createNullableField();
    const document = await generateDocument([jsonResponseRoute(schema)], DOC_CONFIG_3_0, { version: '3.0' });

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema.properties.name).toMatchObject({
      nullable: true,
    });
  });

  it.skipIf(library.supportsOpenapi30Target)(
    'answers the document route with a server error converting to the OpenAPI 3.0 JSON Schema target',
    async () => {
      const { schema } = library.createNullableField();
      const response = await fetchDocument([jsonResponseRoute(schema)], DOC_CONFIG_3_0, { version: '3.0' });

      expect(response.status).toBe(500);
    },
  );
});
