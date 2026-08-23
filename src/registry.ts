import type { ReferenceObject } from 'openapi3-ts/oas31';

import type { StandardSchema } from './standard-schema.ts';
import type { RouteConfigBase } from './types.ts';

export const COMPONENT_TYPES = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

export type OpenAPIDefinition =
  | {
      readonly type: 'component';
      readonly componentType: ComponentType;
      readonly name: string;
      readonly component: object;
    }
  | { readonly type: 'schema'; readonly schema: StandardSchema; readonly name: string }
  | { readonly type: 'route'; readonly route: RouteConfigBase }
  | { readonly type: 'webhook'; readonly webhook: RouteConfigBase };

/**
 * Collects what a document is made of.
 *
 * The registry only records; nothing here inspects a schema. Generation happens later, in one pass,
 * so that a schema referenced from several routes still resolves to a single component.
 */
export class OpenAPIRegistry {
  readonly #definitions: OpenAPIDefinition[] = [];
  readonly #parents: OpenAPIRegistry[];
  /** Names given to schemas out of band, for schemas that don't name themselves through `$id`. */
  readonly #names = new WeakMap<StandardSchema, string>();

  constructor(parents: OpenAPIRegistry[] = []) {
    this.#parents = parents;
  }

  get definitions(): OpenAPIDefinition[] {
    const fromParents = this.#parents.flatMap(parent => parent.definitions);

    return [...fromParents, ...this.#definitions];
  }

  /** Names a schema so it becomes a component even when it carries no `$id`. */
  register(name: string, schema: StandardSchema): StandardSchema {
    this.#names.set(schema, name);
    this.#definitions.push({ name, schema, type: 'schema' });

    return schema;
  }

  nameOf(schema: StandardSchema): string | undefined {
    const own = this.#names.get(schema);
    if (own != null) return own;

    for (const parent of this.#parents) {
      const inherited = parent.nameOf(schema);
      if (inherited != null) return inherited;
    }

    return undefined;
  }

  registerPath(route: RouteConfigBase): void {
    this.#definitions.push({ route, type: 'route' });
  }

  registerWebhook(webhook: RouteConfigBase): void {
    this.#definitions.push({ type: 'webhook', webhook });
  }

  registerComponent<T extends ComponentType>(
    componentType: T,
    name: string,
    component: object,
  ): { name: string; ref: ReferenceObject } {
    this.#definitions.push({ component, componentType, name, type: 'component' });

    return { name, ref: { $ref: `#/components/${componentType}/${name}` } };
  }

  /** Copies another registry's definitions into this one, optionally re-rooting its routes. */
  absorb(registry: OpenAPIRegistry, mapPath: (path: string) => string): void {
    for (const definition of registry.definitions) {
      switch (definition.type) {
        case 'component':
          this.registerComponent(definition.componentType, definition.name, definition.component);
          break;
        case 'schema':
          this.register(definition.name, definition.schema);
          break;
        case 'route':
          this.registerPath({ ...definition.route, path: mapPath(definition.route.path) });
          break;
        case 'webhook':
          this.registerWebhook({ ...definition.webhook, path: mapPath(definition.webhook.path) });
          break;
      }
    }
  }
}
