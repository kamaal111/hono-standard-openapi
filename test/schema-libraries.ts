import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type as arkType } from 'arktype';
import * as S from 'sury';
import * as v from 'valibot';
import { z } from 'zod';
import * as zMini from 'zod/mini';

import { type LibraryRecord, listLibraries } from './library-names.ts';
import type { JsonObject } from '../src/json-value.ts';
import type { StandardSchema } from '../src/standard-schema.ts';

declare global {
  interface ArkEnv {
    meta(): { $id?: string };
  }
}

export type SchemaLibrary = {
  supportsComponents: boolean;
  supportsOpenapi30Target: boolean;
  createCard(): SchemaFixture;
  createCardWithExample(): ExampleSchemaFixture;
  createCardWithPrice(): SchemaFixture;
  createUnnamedCardWithPrice(): SchemaFixture;
  createNullableField(): SchemaFixture;
  createParamsWithExample(): ExampleSchemaFixture;
  createResponseSchemas(): ResponseSchemas;
};

export type SchemaFixture = {
  readonly libraryOptions?: StandardJSONSchemaV1.Options['libraryOptions'];
  readonly schema: StandardSchema;
};

export type ExampleSchemaFixture = SchemaFixture & {
  readonly expectedNameSchema: JsonObject;
};

export type ResponseSchemas = {
  readonly card: StandardSchema;
  readonly error: StandardSchema;
  readonly libraryOptions?: StandardJSONSchemaV1.Options['libraryOptions'];
};

S.enableStandardJSONSchema();

const schemaLibraryRecord: LibraryRecord<SchemaLibrary | null> = {
  ArkType: {
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
    createUnnamedCardWithPrice: () => ({
      schema: arkType({ id: 'string', price: arkType({ amount: 'number' }) }),
    }),
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: arkType({
        id: arkType('string >= 3').configure({ examples: ['1212121'] }),
      }),
    }),
    createNullableField: () => ({ schema: arkType({ name: 'string|null' }) }),
    createResponseSchemas: () => {
      const Price = arkType({ amount: 'number' }).configure({ $id: 'Price' });

      return {
        card: arkType({ id: 'string', price: Price }).configure({ $id: 'Card' }),
        error: arkType({ code: 'string', message: 'string' }).configure({ $id: 'ErrorResponse' }),
      };
    },
    supportsComponents: true,
    supportsOpenapi30Target: false,
  },
  Sury: {
    createCard: () => ({ schema: S.schema({ id: S.string, name: S.string }) }),
    createCardWithExample: () => ({
      expectedNameSchema: { examples: ['Luffy'], type: 'string' },
      schema: S.schema({ id: S.string, name: S.string.with(S.meta, { examples: ['Luffy'] }) }),
    }),
    createCardWithPrice: () => ({
      schema: S.schema({ id: S.string, price: S.schema({ amount: S.number }) }),
    }),
    createUnnamedCardWithPrice: () => ({
      schema: S.schema({ id: S.string, price: S.schema({ amount: S.number }) }),
    }),
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: S.schema({
        id: S.string.with(S.minLength, 3).with(S.meta, { examples: ['1212121'] }),
      }),
    }),
    createNullableField: () => ({ schema: S.schema({ name: S.nullable(S.string) }) }),
    createResponseSchemas: () => ({
      card: S.schema({ id: S.string, price: S.schema({ amount: S.number }) }),
      error: S.schema({ code: S.string, message: S.string }),
    }),
    supportsComponents: false,
    supportsOpenapi30Target: true,
  },
  Valibot: {
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
    createUnnamedCardWithPrice: () => {
      const Price = v.object({ amount: v.number() });
      const Card = v.object({ id: v.string(), price: Price });

      return { schema: toStandardJsonSchema(Card) };
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
    createNullableField: () => ({ schema: toStandardJsonSchema(v.object({ name: v.nullable(v.string()) })) }),
    supportsComponents: true,
    supportsOpenapi30Target: true,
  },
  VineJS: null,
  Zod: {
    createCard: () => ({ schema: z.object({ id: z.string(), name: z.string() }).meta({ $id: 'Card' }) }),
    createCardWithExample: () => ({
      expectedNameSchema: { examples: ['Luffy'], type: 'string' },
      schema: z.object({ id: z.string(), name: z.string().meta({ examples: ['Luffy'] }) }).meta({ $id: 'Card' }),
    }),
    createCardWithPrice: () => {
      const Price = z.object({ amount: z.number() }).meta({ $id: 'Price' });

      return { schema: z.object({ id: z.string(), price: Price }).meta({ $id: 'Card' }) };
    },
    createUnnamedCardWithPrice: () => ({
      schema: z.object({ id: z.string(), price: z.object({ amount: z.number() }) }),
    }),
    createParamsWithExample: () => ({
      expectedNameSchema: { examples: ['1212121'], minLength: 3, type: 'string' },
      schema: z.object({
        id: z
          .string()
          .min(3)
          .meta({ examples: ['1212121'] }),
      }),
    }),
    createNullableField: () => ({ schema: z.object({ name: z.string().nullable() }) }),
    createResponseSchemas: () => {
      const Price = z.object({ amount: z.number() }).meta({ $id: 'Price' });

      return {
        card: z.object({ id: z.string(), price: Price }).meta({ $id: 'Card' }),
        error: z.object({ code: z.string(), message: z.string() }).meta({ $id: 'ErrorResponse' }),
      };
    },
    supportsComponents: true,
    supportsOpenapi30Target: true,
  },
  'Zod Mini': {
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
    createUnnamedCardWithPrice: () => ({
      schema: zMini.toJSONSchema(zMini.object({ id: zMini.string(), price: zMini.object({ amount: zMini.number() }) })),
    }),
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
    createNullableField: () => ({
      schema: zMini.toJSONSchema(zMini.object({ name: zMini.nullable(zMini.string()) })),
    }),
    supportsComponents: true,
    supportsOpenapi30Target: true,
  },
};

export const schemaLibraries = listLibraries(schemaLibraryRecord);
