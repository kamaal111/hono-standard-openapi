import { StandardOpenAPIHono } from '../src/app.ts';
import type { DocumentConfig, GeneratorOptions } from '../src/generator.ts';
import type { JSONSchema, StandardSchema } from '../src/standard-schema.ts';
import type { RouteConfigBase } from '../src/types.ts';

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

export type Document = Record<string, ReturnType<typeof JSON.parse>>;

const DOC_PATH = '/openapi.json';

export async function fetchDocument(
  routes: readonly RouteConfigBase[],
  config: DocumentConfig,
  generatorConfig?: GeneratorOptions,
): Promise<Response> {
  const app = new StandardOpenAPIHono();
  for (const route of routes) {
    app.openapi(route, c => c.json({}));
  }
  app.doc(DOC_PATH, config, generatorConfig);

  return app.request(DOC_PATH);
}

export async function generateDocument(
  routes: readonly RouteConfigBase[],
  config: DocumentConfig,
  generatorConfig?: GeneratorOptions,
): Promise<Document> {
  const response = await fetchDocument(routes, config, generatorConfig);

  return JSON.parse(await response.text());
}
