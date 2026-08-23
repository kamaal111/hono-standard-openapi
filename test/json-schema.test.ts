import { describe, expect, it } from 'vitest';

import { standardSchema } from './helpers.ts';
import { UnsupportedSchemaError } from '../src/errors.ts';
import { ComponentCollector, convertSchema } from '../src/json-schema.ts';

function convert(output: Record<string, unknown>, normalization = {}) {
  return convertSchema(standardSchema({ output }), {
    components: new ComponentCollector(),
    io: 'output',
    normalization,
    target: 'draft-2020-12',
  });
}

describe('ComponentCollector', () => {
  it('reports only generated components as present', () => {
    const components = new ComponentCollector();
    components.reserve('Reserved');
    components.reserve('Reserved');
    components.register('Ready', { type: 'string' });

    expect(components.has('Reserved')).toBe(false);
    expect(components.has('Ready')).toBe(true);
    expect(components.schemas).toEqual({ Ready: { type: 'string' } });
  });

  it('accepts the same component more than once', () => {
    const components = new ComponentCollector();
    components.register('Value', { type: 'string' });
    components.register('Value', { type: 'string' });

    expect(components.schemas).toEqual({ Value: { type: 'string' } });
  });
});

describe('schema conversion edge cases', () => {
  it('identifies unsupported schema vendors when possible', () => {
    expect(() =>
      convertSchema(null, { components: new ComponentCollector(), io: 'output', target: 'draft-2020-12' }),
    ).toThrow('Schema does not implement Standard JSON Schema');
    expect(() =>
      convertSchema(
        { '~standard': { vendor: 'opaque' } },
        { components: new ComponentCollector(), io: 'output', target: 'draft-2020-12' },
      ),
    ).toThrow('Schema from "opaque" does not implement Standard JSON Schema');
    expect(() =>
      convertSchema(
        { '~standard': null },
        { components: new ComponentCollector(), io: 'output', target: 'draft-2020-12' },
      ),
    ).toThrow(UnsupportedSchemaError);
  });

  it('rewrites both definition keywords and ignores non-schema definitions', () => {
    const components = new ComponentCollector();
    const converted = convertSchema(
      standardSchema({
        output: {
          $defs: { ignored: 1, one: { type: 'string' } },
          definitions: { two: { $id: 'Second', type: 'number' } },
          properties: {
            one: { $ref: '#/$defs/one' },
            two: { $ref: '#/definitions/two' },
          },
          type: 'object',
        },
      }),
      { components, io: 'output', target: 'draft-2020-12' },
    );

    expect(converted.properties).toEqual({
      one: { $ref: '#/components/schemas/one' },
      two: { $ref: '#/components/schemas/Second' },
    });
    expect(components.schemas).toEqual({ one: { type: 'string' }, Second: { type: 'number' } });
  });

  it('keeps unknown references and data-keyword values untouched', () => {
    expect(
      convert({
        default: { nested: { $id: 'Data' } },
        enum: [{ $ref: '#/not-a-schema' }],
        properties: { external: { $ref: '#/external' } },
        type: 'object',
      }),
    ).toEqual({
      type: 'object',
      properties: { external: { $ref: '#/external' } },
      enum: [{ $ref: '#/not-a-schema' }],
      default: { nested: { $id: 'Data' } },
    });
  });

  it('can disable every normalization rule', () => {
    const raw = {
      additionalProperties: false,
      anyOf: [{ type: 'string' }, { type: 'null' }],
      const: 'x',
      format: 'uuid',
      pattern: 'pattern',
    };

    expect(
      convert(raw, {
        collapseNullableUnions: false,
        constToEnum: false,
        dropFormatImpliedPatterns: false,
        dropStrictAdditionalProperties: false,
        orderKeywords: false,
      }),
    ).toEqual(raw);
  });

  it('leaves unions that cannot be safely collapsed intact', () => {
    const cases = [
      { anyOf: [{ type: 'string' }] },
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      { anyOf: [{ type: 'null' }, false] },
      { anyOf: [{ type: 'null' }, { properties: {} }] },
      { anyOf: [{ type: 'null' }, { $ref: '#/value', type: 'string' }] },
      { anyOf: [{ type: 'null' }, { $id: 'Value', type: 'string' }] },
    ];

    expect(cases.map(schema => convert(schema))).toEqual([
      cases[0],
      cases[1],
      cases[2],
      cases[3],
      cases[4],
      { anyOf: [{ type: 'null' }, { $ref: '#/components/schemas/Value' }] },
    ]);
  });
});
