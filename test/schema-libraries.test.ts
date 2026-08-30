import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type as arkType } from 'arktype';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as zMini from 'zod/mini';

import { OpenAPIGenerator } from '../src/generator.ts';
import type { JsonObject } from '../src/json-value.ts';
import { OpenAPIRegistry } from '../src/registry.ts';
import type { StandardSchema } from '../src/standard-schema.ts';
import type { RouteConfigBase, SchemaOrReference } from '../src/types.ts';

declare global {
  interface ArkEnv {
    meta(): { $id?: string };
  }
}

const DOC_CONFIG = { info: { title: 'Test', version: '1.0.0' }, openapi: '3.1.1' };
const JSON_TYPE = 'application/json';

/** The generated document, read as plain JSON so assertions can reach into it freely. */
type Document = Record<string, ReturnType<typeof JSON.parse>>;

type SchemaLibrary = {
  readonly expectedSchemaId: string;
  readonly name: string;
  createCard(): SchemaFixture;
  createCardWithExample(): ExampleSchemaFixture;
  createCardWithPrice(): SchemaFixture;
  createParamsWithExample(): ExampleSchemaFixture;
  createResponseSchemas(): ResponseSchemas;
};

type SchemaFixture = {
  readonly libraryOptions?: StandardJSONSchemaV1.Options['libraryOptions'];
  readonly schema: StandardSchema;
};

type ExampleSchemaFixture = SchemaFixture & {
  readonly expectedNameSchema: JsonObject;
};

type ResponseSchemas = {
  readonly card: StandardSchema;
  readonly error: StandardSchema;
  readonly libraryOptions?: StandardJSONSchemaV1.Options['libraryOptions'];
};

const EXPECTED_NESTED_PRICE = { $ref: '#/components/schemas/Price' };
const EXPECTED_PRICE_COMPONENT = {
  properties: { amount: { type: 'number' } },
  required: ['amount'],
  type: 'object',
};

const schemaLibraries: readonly SchemaLibrary[] = [
  {
    name: 'ArkType',
    createCard: () => ({
      schema: arkType({ id: 'string', name: 'string' }).configure({ $id: 'Card' }),
    }),
    createCardWithExample: () => ({
      expectedNameSchema: { examples: ['Luffy'], type: 'string' },
      schema: arkType({
        id: 'string',
        name: arkType('string').configure({ examples: ['Luffy'] }),
      }).configure({ $id: 'Card' }),
    }),
    createCardWithPrice: () => {
      const Price = arkType({ amount: 'number' }).configure({ $id: 'Price' });

      return { schema: arkType({ id: 'string', price: Price }).configure({ $id: 'Card' }) };
    },
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: arkType({
        id: arkType('string >= 3').configure({ examples: ['1212121'] }),
      }),
    }),
    createResponseSchemas: () => {
      const Price = arkType({ amount: 'number' }).configure({ $id: 'Price' });

      return {
        card: arkType({ id: 'string', price: Price }).configure({ $id: 'Card' }),
        error: arkType({ code: 'string', message: 'string' }).configure({ $id: 'ErrorResponse' }),
      };
    },
    expectedSchemaId: 'Card',
  },
  {
    name: 'Zod',
    createCard: () => ({ schema: z.object({ id: z.string(), name: z.string() }).meta({ $id: 'Card' }) }),
    createCardWithExample: () => ({
      expectedNameSchema: { examples: ['Luffy'], type: 'string' },
      schema: z.object({ id: z.string(), name: z.string().meta({ examples: ['Luffy'] }) }).meta({ $id: 'Card' }),
    }),
    createCardWithPrice: () => {
      const Price = z.object({ amount: z.number() }).meta({ $id: 'Price' });

      return { schema: z.object({ id: z.string(), price: Price }).meta({ $id: 'Card' }) };
    },
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: z.object({
        id: z
          .string()
          .min(3)
          .meta({ examples: ['1212121'] }),
      }),
    }),
    createResponseSchemas: () => {
      const Price = z.object({ amount: z.number() }).meta({ $id: 'Price' });

      return {
        card: z.object({ id: z.string(), price: Price }).meta({ $id: 'Card' }),
        error: z.object({ code: z.string(), message: z.string() }).meta({ $id: 'ErrorResponse' }),
      };
    },
    expectedSchemaId: 'Card',
  },
  {
    name: 'Zod Mini',
    createCard: () => ({
      schema: zMini.toJSONSchema(
        zMini.object({ id: zMini.string(), name: zMini.string() }).check(zMini.meta({ $id: 'Card' })),
      ),
    }),
    createCardWithExample: () => ({
      expectedNameSchema: { examples: ['Luffy'], type: 'string' },
      schema: zMini.toJSONSchema(
        zMini
          .object({
            id: zMini.string(),
            name: zMini.string().check(zMini.meta({ examples: ['Luffy'] })),
          })
          .check(zMini.meta({ $id: 'Card' })),
      ),
    }),
    createCardWithPrice: () => {
      const Price = zMini.object({ amount: zMini.number() }).check(zMini.meta({ $id: 'Price' }));

      return {
        schema: zMini.toJSONSchema(
          zMini.object({ id: zMini.string(), price: Price }).check(zMini.meta({ $id: 'Card' })),
        ),
      };
    },
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: zMini.toJSONSchema(
        zMini.object({
          id: zMini.string().check(zMini.minLength(3), zMini.meta({ examples: ['1212121'] })),
        }),
      ),
    }),
    createResponseSchemas: () => {
      const Price = zMini.object({ amount: zMini.number() }).check(zMini.meta({ $id: 'Price' }));
      const Card = zMini.object({ id: zMini.string(), price: Price }).check(zMini.meta({ $id: 'Card' }));
      const ErrorResponse = zMini
        .object({ code: zMini.string(), message: zMini.string() })
        .check(zMini.meta({ $id: 'ErrorResponse' }));

      return { card: zMini.toJSONSchema(Card), error: zMini.toJSONSchema(ErrorResponse) };
    },
    expectedSchemaId: 'Card',
  },
  {
    name: 'Valibot',
    createCard: () => {
      const Card = v.object({ id: v.string(), name: v.string() });

      return { libraryOptions: { definitions: { Card } }, schema: toStandardJsonSchema(Card) };
    },
    createCardWithExample: () => {
      const Card = v.object({ id: v.string(), name: v.pipe(v.string(), v.examples(['Luffy'])) });

      return {
        expectedNameSchema: { examples: ['Luffy'], type: 'string' },
        libraryOptions: { definitions: { Card } },
        schema: toStandardJsonSchema(Card),
      };
    },
    createCardWithPrice: () => {
      const Price = v.object({ amount: v.number() });
      const Card = v.object({ id: v.string(), price: Price });

      return {
        libraryOptions: { definitions: { Card, Price } },
        schema: toStandardJsonSchema(Card),
      };
    },
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.minLength(3), v.examples(['1212121'])) })),
    }),
    createResponseSchemas: () => {
      const Price = v.object({ amount: v.number() });
      const Card = v.object({ id: v.string(), price: Price });
      const ErrorResponse = v.object({ code: v.string(), message: v.string() });

      return {
        card: toStandardJsonSchema(Card),
        error: toStandardJsonSchema(ErrorResponse),
        libraryOptions: { definitions: { Card, ErrorResponse, Price } },
      };
    },
    expectedSchemaId: 'Card',
  },
];

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

  it('shares a named root schema across routes', () => {
    const { libraryOptions, schema: Card } = library.createCard();
    const registry = new OpenAPIRegistry();
    registry.registerPath(jsonResponseRoute(Card, '/a'));
    registry.registerPath(jsonResponseRoute(Card, '/b'));

    const document: Document = new OpenAPIGenerator(registry, { libraryOptions }).generateDocument(DOC_CONFIG);

    expect(document.paths?.['/a']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: `#/components/schemas/${library.expectedSchemaId}`,
    });
    expect(document.paths?.['/b']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: `#/components/schemas/${library.expectedSchemaId}`,
    });
    expect(document.components?.schemas?.[library.expectedSchemaId]).toEqual({
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      type: 'object',
    });
  });

  it('preserves schema examples from the library converter', () => {
    const { expectedNameSchema, libraryOptions, schema: Card } = library.createCardWithExample();
    const registry = new OpenAPIRegistry();
    registry.registerPath(jsonResponseRoute(Card));
    const document: Document = new OpenAPIGenerator(registry, { libraryOptions }).generateDocument(DOC_CONFIG);

    expect(document.components?.schemas?.Card?.properties?.name).toEqual(expectedNameSchema);
  });

  it('uses schema examples on inferred path parameters', () => {
    const { expectedNameSchema, schema } = library.createParamsWithExample();
    const route: RouteConfigBase = {
      method: 'get',
      path: '/cards/{id}',
      request: { params: schema },
      responses: { 200: { description: 'ok' } },
    };
    const registry = new OpenAPIRegistry();
    registry.registerPath(route);

    const document: Document = new OpenAPIGenerator(registry).generateDocument(DOC_CONFIG);

    expect(document.paths?.['/cards/{id}']?.get?.parameters).toEqual([
      { in: 'path', name: 'id', required: true, schema: expectedNameSchema },
    ]);
  });

  it('shares a nested schema through an OpenAPI component reference', () => {
    const { libraryOptions, schema: Card } = library.createCardWithPrice();
    const registry = new OpenAPIRegistry();
    registry.registerPath(jsonResponseRoute(Card));

    const document: Document = new OpenAPIGenerator(registry, { libraryOptions }).generateDocument(DOC_CONFIG);

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: `#/components/schemas/${library.expectedSchemaId}`,
    });
    expect(document.components?.schemas?.Card.properties.price).toEqual(EXPECTED_NESTED_PRICE);
    expect(document.components?.schemas?.Price).toEqual(EXPECTED_PRICE_COMPONENT);
  });

  it('documents successful and error responses as components', () => {
    const { card, error, libraryOptions } = library.createResponseSchemas();
    const registry = new OpenAPIRegistry();
    registry.registerPath({
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
    });

    const document: Document = new OpenAPIGenerator(registry, { libraryOptions }).generateDocument(DOC_CONFIG);

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
    expect(document.components?.schemas?.ErrorResponse).toEqual({
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
      type: 'object',
    });
  });
});
