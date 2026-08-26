import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';

import { standardSchema } from './helpers.ts';
import { ComponentNameConflictError, UnsupportedSchemaError } from '../src/errors.ts';
import { OpenAPIGenerator } from '../src/generator.ts';
import { OpenAPIRegistry } from '../src/registry.ts';
import type { StandardSchema } from '../src/standard-schema.ts';
import type { RouteConfigBase, SchemaOrReference } from '../src/types.ts';

const JSON_TYPE = 'application/json';

/** The generated document, read as plain JSON so assertions can reach into it freely. */
type Document = Record<string, ReturnType<typeof JSON.parse>>;

const DOC_CONFIG = { info: { title: 'Test', version: '1.0.0' }, openapi: '3.1.1' };

function documentFor(...routes: RouteConfigBase[]): Document {
  const registry = new OpenAPIRegistry();
  for (const route of routes) registry.registerPath(route);

  return new OpenAPIGenerator(registry).generateDocument(DOC_CONFIG);
}

function jsonResponseRoute(schema: SchemaOrReference, path = '/things'): RouteConfigBase {
  return {
    method: 'get',
    path,
    responses: { 200: { content: { [JSON_TYPE]: { schema } }, description: 'ok' } },
  };
}

describe('component naming', () => {
  it('hoists a schema that names itself through $id', () => {
    const Thing = standardSchema({
      output: {
        $id: 'Thing',
        properties: { name: { type: 'string' } },
        required: ['name'],
        title: 'Thing',
        type: 'object',
      },
    });

    const document = documentFor(jsonResponseRoute(Thing));

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Thing',
    });
    expect(document.components?.schemas?.Thing).toEqual({
      properties: { name: { type: 'string' } },
      required: ['name'],
      title: 'Thing',
      type: 'object',
    });
  });

  it('keeps a schema inline when it does not name itself', () => {
    const document = documentFor(
      jsonResponseRoute(
        standardSchema({ output: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' } }),
      ),
    );

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      properties: { name: { type: 'string' } },
      required: ['name'],
      type: 'object',
    });
    expect(document.components?.schemas).toEqual({});
  });

  it('names a nested schema from its definition key when it has no $id', () => {
    const Outer = standardSchema({
      output: {
        $defs: { Inner: { properties: { value: { type: 'string' } }, required: ['value'], type: 'object' } },
        $id: 'Outer',
        properties: { inner: { $ref: '#/$defs/Inner' } },
        required: ['inner'],
        type: 'object',
      },
    });

    const document = documentFor(jsonResponseRoute(Outer));

    expect(document.components?.schemas?.Outer?.properties.inner).toEqual({ $ref: '#/components/schemas/Inner' });
    expect(document.components?.schemas?.Inner).toEqual({
      properties: { value: { type: 'string' } },
      required: ['value'],
      type: 'object',
    });
  });

  it('shares one component between a nested use and a top-level use', () => {
    const Shared = standardSchema({
      output: { $id: 'Shared', properties: { value: { type: 'string' } }, required: ['value'], type: 'object' },
    });
    const Outer = standardSchema({
      output: {
        $defs: {
          Shared: { $id: 'Shared', properties: { value: { type: 'string' } }, required: ['value'], type: 'object' },
        },
        $id: 'Outer',
        properties: { shared: { $ref: '#/$defs/Shared' } },
        required: ['shared'],
        type: 'object',
      },
    });

    const document = documentFor(jsonResponseRoute(Outer, '/outer'), jsonResponseRoute(Shared, '/shared'));

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(['Outer', 'Shared']);
    expect(document.paths?.['/shared']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Shared',
    });
  });

  it('names a schema registered on the registry even though it has no $id', () => {
    const Thing = standardSchema({
      output: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
    });
    const registry = new OpenAPIRegistry();
    registry.register('Thing', Thing);
    registry.registerPath(jsonResponseRoute(Thing));

    const document: Document = new OpenAPIGenerator(registry).generateDocument(DOC_CONFIG);

    expect(document.components?.schemas?.Thing).toBeDefined();
  });

  it('rejects two different schemas claiming the same name', () => {
    const first = standardSchema({
      output: { $id: 'Same', properties: { a: { type: 'string' } }, required: ['a'], type: 'object' },
    });
    const second = standardSchema({
      output: { $id: 'Same', properties: { b: { type: 'string' } }, required: ['b'], type: 'object' },
    });

    expect(() => documentFor(jsonResponseRoute(first, '/first'), jsonResponseRoute(second, '/second'))).toThrow(
      ComponentNameConflictError,
    );
  });

  it('rejects a schema that cannot describe itself as JSON Schema', () => {
    const opaque: StandardSchemaV1 = {
      '~standard': { validate: () => ({ value: null }), vendor: 'nothing', version: 1 },
    };

    expect(() => documentFor(jsonResponseRoute(opaque))).toThrow(UnsupportedSchemaError);
  });
});

describe('normalization', () => {
  it('drops the strictness marker but keeps a permissive additionalProperties', () => {
    const Strict = standardSchema({
      output: {
        $id: 'Strict',
        additionalProperties: false,
        properties: { a: { type: 'string' } },
        required: ['a'],
        type: 'object',
      },
    });
    const Loose = standardSchema({
      output: {
        $id: 'Loose',
        additionalProperties: {},
        properties: { a: { type: 'string' } },
        required: ['a'],
        type: 'object',
      },
    });

    const document = documentFor(jsonResponseRoute(Strict, '/strict'), jsonResponseRoute(Loose, '/loose'));

    expect(document.components?.schemas?.Strict).not.toHaveProperty('additionalProperties');
    expect(document.components?.schemas?.Loose?.additionalProperties).toEqual({});
  });

  it('drops a pattern implied by a format but keeps an explicit one', () => {
    const Thing = standardSchema({
      output: {
        $id: 'Thing',
        properties: {
          id: { format: 'uuid', pattern: 'uuid-pattern', type: 'string' },
          slug: { pattern: '^[a-z]+$', type: 'string' },
        },
        required: ['id', 'slug'],
        type: 'object',
      },
    });

    const properties = documentFor(jsonResponseRoute(Thing)).components?.schemas?.Thing?.properties;

    expect(properties.id).toEqual({ format: 'uuid', type: 'string' });
    expect(properties.slug.pattern).toBe('^[a-z]+$');
  });

  it('collapses a nullable union into a nullable type', () => {
    const Thing = standardSchema({
      output: {
        $id: 'Thing',
        properties: { notes: { anyOf: [{ maxLength: 10, type: 'string' }, { type: 'null' }] } },
        required: ['notes'],
        type: 'object',
      },
    });

    const properties = documentFor(jsonResponseRoute(Thing)).components?.schemas?.Thing?.properties;

    expect(properties.notes).toEqual({ maxLength: 10, type: [null, 'string'] });
  });

  it('rewrites a constant as a single-value enum', () => {
    const Thing = standardSchema({
      output: {
        $id: 'Thing',
        properties: { kind: { const: 'only', type: 'string' } },
        required: ['kind'],
        type: 'object',
      },
    });

    const properties = documentFor(jsonResponseRoute(Thing)).components?.schemas?.Thing?.properties;

    expect(properties.kind).toEqual({ enum: ['only'], type: 'string' });
  });

  it('leaves the schema library output alone when normalization is switched off', () => {
    const Thing = standardSchema({
      output: {
        $id: 'Thing',
        additionalProperties: false,
        properties: { kind: { const: 'only', type: 'string' } },
        required: ['kind'],
        type: 'object',
      },
    });
    const registry = new OpenAPIRegistry();
    registry.registerPath(jsonResponseRoute(Thing));

    const document: Document = new OpenAPIGenerator(registry, {
      normalization: { constToEnum: false, dropStrictAdditionalProperties: false },
    }).generateDocument(DOC_CONFIG);

    expect(document.components?.schemas?.Thing?.additionalProperties).toBe(false);
    expect(document.components?.schemas?.Thing?.properties.kind.const).toBe('only');
  });
});

describe('parameters', () => {
  it('describes one parameter per property, in document order', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/cards/{cardId}',
      request: {
        params: standardSchema({
          input: {
            properties: { cardId: { description: 'Card identifier', format: 'uuid', type: 'string' } },
            required: ['cardId'],
            type: 'object',
          },
        }),
        query: standardSchema({
          input: { properties: { game: { enum: ['one_piece', 'pokemon'], type: 'string' } }, type: 'object' },
        }),
      },
      responses: { 200: { description: 'ok' } },
    };

    const parameters = documentFor(route).paths?.['/cards/{cardId}']?.get.parameters;

    expect(parameters).toEqual([
      {
        description: 'Card identifier',
        in: 'path',
        name: 'cardId',
        required: true,
        schema: { description: 'Card identifier', format: 'uuid', type: 'string' },
      },
      {
        in: 'query',
        name: 'game',
        required: false,
        schema: { enum: ['one_piece', 'pokemon'], type: 'string' },
      },
    ]);
  });

  it('marks a path parameter required even when the schema allows it to be missing', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/cards/{cardId}',
      request: { params: standardSchema({ input: { properties: { cardId: { type: 'string' } }, type: 'object' } }) },
      responses: { 200: { description: 'ok' } },
    };

    expect(documentFor(route).paths?.['/cards/{cardId}']?.get.parameters[0].required).toBe(true);
  });

  it('describes response headers the same way as parameters', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: {
        200: {
          description: 'ok',
          headers: standardSchema({
            output: {
              properties: { 'set-auth-token': { description: 'Token', type: 'string' } },
              required: ['set-auth-token'],
              type: 'object',
            },
          }),
        },
      },
    };

    expect(documentFor(route).paths?.['/things']?.get.responses['200'].headers).toEqual({
      'set-auth-token': {
        description: 'Token',
        required: true,
        schema: { description: 'Token', type: 'string' },
      },
    });
  });

  it('marks optional response headers as optional', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: {
        200: {
          description: 'ok',
          headers: standardSchema({
            output: { properties: { 'x-token': { type: 'string' } }, type: 'object' },
          }),
        },
      },
    };

    expect(documentFor(route).paths?.['/things']?.get.responses['200'].headers).toEqual({
      'x-token': { required: false, schema: { type: 'string' } },
    });
  });
});

describe('document assembly', () => {
  it('carries operation metadata through untouched', () => {
    const route: RouteConfigBase = {
      description: 'Lists things',
      method: 'get',
      path: '/things',
      responses: { 200: { description: 'ok' } },
      security: [{ bearerAuth: [] }],
      summary: 'List',
      tags: ['Things'],
    };

    expect(documentFor(route).paths?.['/things']?.get).toEqual({
      description: 'Lists things',
      responses: { 200: { description: 'ok' } },
      security: [{ bearerAuth: [] }],
      summary: 'List',
      tags: ['Things'],
    });
  });

  it('merges several methods onto one path', () => {
    const document = documentFor(
      { method: 'get', path: '/things', responses: { 200: { description: 'ok' } } },
      { method: 'post', path: '/things', responses: { 201: { description: 'created' } } },
    );

    expect(Object.keys(document.paths?.['/things'] ?? {})).toEqual(['get', 'post']);
  });

  it('passes an already-written schema through without converting it', () => {
    const document = documentFor(jsonResponseRoute({ type: 'string' }));

    expect(document.paths?.['/things']?.get.responses['200'].content[JSON_TYPE].schema).toEqual({ type: 'string' });
  });

  it('describes a request body from the input side of the schema', () => {
    const Payload = standardSchema({
      input: { $id: 'Payload', properties: { notes: { type: 'string' } }, required: ['notes'], type: 'object' },
      output: { $id: 'Payload', properties: { notes: { type: 'string' } }, required: ['notes'], type: 'object' },
    });
    const route: RouteConfigBase = {
      method: 'post',
      path: '/things',
      request: { body: { content: { [JSON_TYPE]: { schema: Payload } } } },
      responses: { 201: { description: 'created' } },
    };

    const document = documentFor(route);

    expect(document.paths?.['/things']?.post.requestBody.content[JSON_TYPE].schema).toEqual({
      $ref: '#/components/schemas/Payload',
    });
    expect(document.components?.schemas?.Payload?.properties.notes).toEqual({ type: 'string' });
  });

  it('keeps components the document config declares', () => {
    const registry = new OpenAPIRegistry();
    registry.registerPath({ method: 'get', path: '/things', responses: { 200: { description: 'ok' } } });

    const document: Document = new OpenAPIGenerator(registry).generateDocument({
      ...DOC_CONFIG,
      components: { securitySchemes: { bearerAuth: { scheme: 'bearer', type: 'http' } } },
    });

    expect(document.components?.securitySchemes?.bearerAuth).toEqual({ scheme: 'bearer', type: 'http' });
  });

  it('places a schema ahead of the schemas it refers to', () => {
    const Whole = standardSchema({
      output: {
        $id: 'Whole',
        properties: {
          part: { $id: 'Part', properties: { value: { type: 'string' } }, required: ['value'], type: 'object' },
        },
        required: ['part'],
        type: 'object',
      },
    });

    const document = documentFor(jsonResponseRoute(Whole));

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(['Whole', 'Part']);
  });

  it('orders components the way a reader first meets them', () => {
    const Top = standardSchema({
      output: {
        $id: 'Top',
        properties: {
          middle: {
            $id: 'Middle',
            properties: {
              deep: { $id: 'Deep', properties: { value: { type: 'string' } }, required: ['value'], type: 'object' },
            },
            required: ['deep'],
            type: 'object',
          },
        },
        required: ['middle'],
        type: 'object',
      },
    });

    const registry = new OpenAPIRegistry();
    registry.registerPath(jsonResponseRoute(Top));
    const document: Document = new OpenAPIGenerator(registry, {
      componentOrder: 'first-referenced',
    }).generateDocument(DOC_CONFIG);

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(['Top', 'Middle', 'Deep']);
  });

  it('accepts definition arrays and alphabetizes generated schemas', () => {
    const Alpha = standardSchema({ output: { $id: 'Alpha', type: 'string' } });
    const Zulu = standardSchema({ output: { $id: 'Zulu', type: 'string' } });
    const definitions = [
      { name: 'Zulu', schema: Zulu, type: 'schema' as const },
      { name: 'Alpha', schema: Alpha, type: 'schema' as const },
    ];

    const document = new OpenAPIGenerator(definitions, { componentOrder: 'alphabetical' }).generateDocument(DOC_CONFIG);

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(['Alpha', 'Zulu']);
  });

  it('generates webhooks and merges registered components with configured ones', () => {
    const registry = new OpenAPIRegistry();
    registry.registerComponent('examples', 'registered', { value: 'registered' });
    registry.registerWebhook({
      method: 'post',
      path: '/events',
      responses: { 204: { description: 'received', links: { next: { operationId: 'next' } } } },
    });

    const document = new OpenAPIGenerator(registry).generateDocument({
      ...DOC_CONFIG,
      components: { examples: { configured: { value: 'configured' } } },
    });

    expect(document.webhooks).toEqual({
      '/events': {
        post: {
          responses: {
            204: { description: 'received', links: { next: { operationId: 'next' } } },
          },
        },
      },
    });
    expect(document.components?.examples).toEqual({
      registered: { value: 'registered' },
    });
  });

  it('preserves response references and media-type metadata without a schema', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: {
        200: { $ref: '#/components/responses/Things' },
        204: { content: { [JSON_TYPE]: { example: null } }, description: 'empty' },
      },
    };

    expect(documentFor(route).paths?.['/things']?.get.responses).toEqual({
      200: { $ref: '#/components/responses/Things' },
      204: { content: { [JSON_TYPE]: { example: null } }, description: 'empty' },
    });
  });

  it('passes written response headers through unchanged', () => {
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: { 200: { description: 'ok', headers: { 'x-limit': { schema: { type: 'integer' } } } } },
    };

    expect(documentFor(route).paths?.['/things']?.get.responses['200'].headers).toEqual({
      'x-limit': { schema: { type: 'integer' } },
    });
  });

  it('rejects Standard Schemas without JSON Schema support in content and headers', () => {
    const opaque = { '~standard': { validate: () => ({ value: null }), vendor: 'opaque', version: 1 as const } };
    const contentRoute = jsonResponseRoute(opaque, '/content');
    const headerRoute: RouteConfigBase = {
      method: 'get',
      path: '/headers',
      responses: { 200: { description: 'ok', headers: opaque } },
    };

    expect(() => documentFor(contentRoute)).toThrow('Schema from "opaque"');
    expect(() => documentFor(headerRoute)).toThrow('Schema from "opaque"');
  });

  it('rejects non-object parameter and response-header schemas', () => {
    const scalar = standardSchema({ input: { type: 'string' }, output: { type: 'string' } });
    const parameterRoute: RouteConfigBase = {
      method: 'get',
      path: '/parameter',
      request: { query: scalar },
      responses: { 200: { description: 'ok' } },
    };
    const headerRoute: RouteConfigBase = {
      method: 'get',
      path: '/headers',
      responses: { 200: { description: 'ok', headers: scalar } },
    };

    expect(() => documentFor(parameterRoute)).toThrow('schema for "query" must describe an object');
    expect(() => documentFor(headerRoute)).toThrow('schema for "headers" must describe an object');
  });

  it('uses the OpenAPI 3.0 schema target when requested', () => {
    const targets: string[] = [];
    const schema: StandardSchema = {
      '~standard': {
        jsonSchema: {
          input: () => ({ type: 'string' }),
          output: options => {
            targets.push(options.target);

            return { type: 'string' };
          },
        },
        validate: value => ({ value }),
        vendor: 'test',
        version: 1,
      },
    };
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: { 200: { content: { [JSON_TYPE]: { schema } }, description: 'ok' } },
    };

    new OpenAPIGenerator([{ route, type: 'route' }], { version: '3.0' }).generateDocument(DOC_CONFIG);

    expect(targets).toEqual(['openapi-3.0']);
  });

  it('does not revisit duplicate, missing, or external schema references', () => {
    const Shared = standardSchema({ output: { $id: 'Shared', type: 'string' } });
    const route: RouteConfigBase = {
      method: 'get',
      path: '/things',
      responses: {
        200: {
          content: {
            [JSON_TYPE]: {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/Shared' },
                  { $ref: '#/components/schemas/Shared' },
                  { $ref: '#/components/schemas/Missing' },
                  { $ref: 'https://example.com/schema' },
                ],
              },
            },
          },
          description: 'ok',
        },
      },
    };
    const registry = new OpenAPIRegistry();
    registry.register('Shared', Shared);
    registry.registerPath(route);

    const document = new OpenAPIGenerator(registry, { componentOrder: 'first-referenced' }).generateDocument(
      DOC_CONFIG,
    );

    expect(Object.keys(document.components?.schemas ?? {})).toEqual(['Shared']);
  });
});
