import type { JSONSchema, StandardSchema } from '../src/standard-schema.ts';

type SchemaDocuments = {
  readonly input?: JSONSchema;
  readonly output?: JSONSchema;
};

export function standardSchema({ input = {}, output = input }: SchemaDocuments): StandardSchema {
  return {
    '~standard': {
      jsonSchema: {
        input: () => input,
        output: () => output,
      },
      validate: value => ({ value }),
      vendor: 'test',
      version: 1,
    },
  };
}
