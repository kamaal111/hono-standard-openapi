import { describe, expect, it } from 'vitest';

import { standardSchema } from './helpers.ts';
import { OpenAPIRegistry } from '../src/registry.ts';

describe('OpenAPIRegistry', () => {
  it('inherits definitions and schema names from its parents', () => {
    const schema = standardSchema({ output: { type: 'string' } });
    const parent = new OpenAPIRegistry();
    parent.register('ParentValue', schema);
    const registry = new OpenAPIRegistry([parent]);

    expect(registry.nameOf(schema)).toBe('ParentValue');
    expect(registry.definitions).toEqual([{ name: 'ParentValue', schema, type: 'schema' }]);
  });

  it('prefers its own schema name and reports an unknown schema as unnamed', () => {
    const schema = standardSchema({});
    const registry = new OpenAPIRegistry([new OpenAPIRegistry()]);
    registry.register('LocalValue', schema);

    expect(registry.nameOf(schema)).toBe('LocalValue');
    expect(registry.nameOf(standardSchema({}))).toBeUndefined();
  });

  it('registers webhooks and reusable components', () => {
    const registry = new OpenAPIRegistry();
    const component = registry.registerComponent('securitySchemes', 'bearerAuth', {
      scheme: 'bearer',
      type: 'http',
    });
    registry.registerWebhook({ method: 'post', path: '/events', responses: { 204: { description: 'ok' } } });

    expect(component).toEqual({
      name: 'bearerAuth',
      ref: { $ref: '#/components/securitySchemes/bearerAuth' },
    });
    expect(registry.definitions).toHaveLength(2);
  });

  it('absorbs every definition type and re-roots route-like definitions', () => {
    const schema = standardSchema({});
    const source = new OpenAPIRegistry();
    source.registerComponent('examples', 'Example', { value: 1 });
    source.register('Value', schema);
    source.registerPath({ method: 'get', path: '/items', responses: { 200: { description: 'ok' } } });
    source.registerWebhook({ method: 'post', path: '/events', responses: { 204: { description: 'ok' } } });
    const target = new OpenAPIRegistry();

    target.absorb(source, path => `/prefix${path}`);

    expect(target.definitions).toEqual([
      { component: { value: 1 }, componentType: 'examples', name: 'Example', type: 'component' },
      { name: 'Value', schema, type: 'schema' },
      {
        route: { method: 'get', path: '/prefix/items', responses: { 200: { description: 'ok' } } },
        type: 'route',
      },
      {
        type: 'webhook',
        webhook: { method: 'post', path: '/prefix/events', responses: { 204: { description: 'ok' } } },
      },
    ]);
  });
});
