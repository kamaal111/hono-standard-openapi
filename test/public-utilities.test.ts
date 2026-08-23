import { describe, expect, it } from 'vitest';

import { standardSchema } from './helpers.ts';
import { createRoute, toRoutingPath } from '../src/route.ts';
import { isStandardJSONSchema, isStandardSchema, validateWithStandardSchema } from '../src/standard-schema.ts';

describe('route utilities', () => {
  it('exposes a non-enumerable routing path', () => {
    const route = createRoute({ method: 'get', path: '/cards/{cardId}', responses: { 200: { description: 'ok' } } });

    expect(route.getRoutingPath()).toBe('/cards/:cardId');
    expect(Object.keys(route)).not.toContain('getRoutingPath');
    expect(toRoutingPath('/sets/{setId}/cards/{cardId}')).toBe('/sets/:setId/cards/:cardId');
  });
});

describe('Standard Schema utilities', () => {
  it('recognizes schemas and JSON Schema support defensively', () => {
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema({ '~standard': null })).toBe(false);
    expect(isStandardSchema({ '~standard': { version: 2 } })).toBe(false);
    expect(isStandardSchema({ '~standard': { version: 1 } })).toBe(true);
    expect(isStandardJSONSchema({ '~standard': { jsonSchema: null, version: 1 } })).toBe(false);
    expect(isStandardJSONSchema(standardSchema({}))).toBe(true);
  });

  it('delegates validation to the Standard Schema implementation', () => {
    const schema = standardSchema({});

    expect(validateWithStandardSchema(schema, 'value')).toEqual({ value: 'value' });
  });
});
