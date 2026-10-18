import { z } from 'zod';

import { generateDocument, standardSchema } from './helpers.ts';
import { ComponentNameConflictError } from '../src/errors.ts';
import { ComponentCollector, convertSchema, type JSONSchemaTarget } from '../src/json-schema.ts';
import type { JSONSchema } from '../src/standard-schema.ts';
import type { RouteConfigBase } from '../src/types.ts';

const REF = { $ref: '#/components/schemas/Shared' };

function convert(
  schema: JSONSchema,
  components = new ComponentCollector(),
  target: JSONSchemaTarget = 'draft-2020-12',
) {
  return convertSchema(standardSchema({ input: schema }), { components, io: 'input', target });
}

describe('defaults on shared components', () => {
  it.each([null, false, 0, '', { nested: { $id: 'Data', $ref: '#/data' } }])(
    'preserves the default %j on the reference without changing the component',
    value => {
      const components = new ComponentCollector();

      expect(convert({ $id: 'Shared', type: 'string', default: value }, components)).toEqual({
        ...REF,
        default: value,
      });
      expect(convert({ $id: 'Shared', type: 'string' }, components)).toEqual(REF);
      expect(components.schemas).toEqual({ Shared: { type: 'string' } });
    },
  );

  it('keeps defaults local when a plain component is encountered first', () => {
    const components = new ComponentCollector();

    expect(convert({ $id: 'Shared', type: 'string' }, components)).toEqual(REF);
    expect(convert({ $id: 'Shared', type: 'string', default: 'EUR' }, components)).toEqual({ ...REF, default: 'EUR' });
    expect(convert({ $id: 'Shared', type: 'string', default: 'USD' }, components)).toEqual({ ...REF, default: 'USD' });
    expect(components.schemas).toEqual({ Shared: { type: 'string' } });
  });

  it.each(['$defs', 'definitions'])('preserves %s defaults and explicit reference overrides', keyword => {
    const components = new ComponentCollector();

    expect(
      convert(
        {
          [keyword]: { Named: { $id: 'Shared', type: 'string', default: 'EUR' } },
          properties: {
            inherited: { $ref: `#/${keyword}/Named` },
            overridden: { $ref: `#/${keyword}/Named`, default: null },
            direct: { $id: 'Shared', type: 'string' },
          },
          type: 'object',
        },
        components,
      ),
    ).toEqual({
      type: 'object',
      properties: { inherited: { ...REF, default: 'EUR' }, overridden: { ...REF, default: null }, direct: REF },
    });
    expect(components.schemas).toEqual({ Shared: { type: 'string' } });
  });

  it.each(['openapi-3.0', 'draft-07'] as const)('wraps defaulted references for %s', target => {
    expect(convert({ $id: 'Shared', type: 'string', default: null }, undefined, target)).toEqual({
      allOf: [REF],
      default: null,
    });
    expect(convert({ $ref: '#/components/schemas/Shared', default: 'EUR' }, undefined, target)).toEqual({
      allOf: [REF],
      default: 'EUR',
    });
    expect(convert({ $ref: '#/components/schemas/Shared' }, undefined, target)).toEqual(REF);
  });

  it('shares named reference schemas with defaults under OpenAPI 3.0', () => {
    const components = new ComponentCollector();

    expect(
      convert({ $id: 'Shared', $ref: 'https://example.com/shared', default: null }, components, 'openapi-3.0'),
    ).toEqual({
      allOf: [REF],
      default: null,
    });
    expect(convert({ $id: 'Shared', $ref: 'https://example.com/shared' }, components, 'openapi-3.0')).toEqual(REF);
    expect(components.schemas).toEqual({ Shared: { $ref: 'https://example.com/shared' } });
  });

  it('preserves explicit defaults and other siblings on external references', () => {
    expect(convert({ $ref: 'https://example.com/shared', default: false, description: 'A shared value' })).toEqual({
      $ref: 'https://example.com/shared',
      default: false,
      description: 'A shared value',
    });
  });

  it('keeps inline and unhoisted root defaults in place', () => {
    expect(convert({ type: 'string', default: 'EUR' })).toEqual({ type: 'string', default: 'EUR' });
    expect(
      convertSchema(standardSchema({ input: { $id: 'Shared', type: 'string', default: 'EUR' } }), {
        components: new ComponentCollector(),
        hoistRoot: false,
        io: 'input',
        target: 'draft-2020-12',
      }),
    ).toEqual({ type: 'string', default: 'EUR' });
  });

  it('hoists defaulted registry-named schemas without changing their default', () => {
    const components = new ComponentCollector();

    expect(
      convertSchema(standardSchema({ input: { type: 'string', default: 'EUR' } }), {
        components,
        io: 'input',
        name: 'Shared',
        target: 'draft-2020-12',
      }),
    ).toEqual({ ...REF, default: 'EUR' });
    expect(components.schemas).toEqual({ Shared: { type: 'string' } });
  });

  it('still rejects validation differences under the same component name', () => {
    const components = new ComponentCollector();
    convert({ $id: 'Shared', type: 'string', enum: ['EUR'], default: 'EUR' }, components);

    expect(() => convert({ $id: 'Shared', type: 'string', enum: ['USD'], default: 'USD' }, components)).toThrow(
      ComponentNameConflictError,
    );
  });

  it('shares Zod nullable enums between plain, optional, and defaulted fields', () => {
    const currency = z.enum(['EUR', 'USD']).nullable().meta({ $id: 'Shared' });
    const components = new ComponentCollector();

    expect(
      convertSchema(
        z.object({ plain: currency, optional: currency.optional(), imported: currency.optional().default(null) }),
        {
          components,
          io: 'input',
          normalization: { collapseNullableUnions: false },
          target: 'draft-2020-12',
        },
      ),
    ).toEqual({
      type: 'object',
      properties: { plain: REF, optional: REF, imported: { ...REF, default: null } },
      required: ['plain'],
    });
    expect(components.schemas).toEqual({
      Shared: { anyOf: [{ type: 'string', enum: ['EUR', 'USD'] }, { type: 'null' }] },
    });
  });
});

describe('shared defaults in generated documents', () => {
  it.each([
    { version: '3.1', openapi: '3.1.1', expected: { ...REF, default: 'EUR' } },
    { version: '3.0', openapi: '3.0.3', expected: { allOf: [REF], default: 'EUR' } },
  ] as const)('preserves request and response defaults in OpenAPI $version', async ({ version, openapi, expected }) => {
    const currency = z.string().meta({ $id: 'Shared' });
    const schema = z.object({ plain: currency, imported: currency.optional().default('EUR') });

    const route: RouteConfigBase = {
      method: 'post',
      path: '/purchases',
      request: { body: { content: { 'application/json': { schema } } } },
      responses: { 200: { description: 'A purchase', content: { 'application/json': { schema } } } },
    };

    const config = { info: { title: 'Shared defaults', version: '1.0.0' }, openapi };
    const document = await generateDocument([route], config, { version });

    expect(document.components.schemas).toEqual({ Shared: { type: 'string' } });
    expect(document.paths['/purchases'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: { plain: REF, imported: expected },
      required: ['plain'],
    });
    expect(document.paths['/purchases'].post.responses['200'].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { plain: REF, imported: expected },
      required: ['plain', 'imported'],
    });
    expect(await generateDocument([route], config, { version })).toEqual(document);
  });
});
