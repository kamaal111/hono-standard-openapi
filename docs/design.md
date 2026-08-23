# Design

`hono-standard-openapi` builds an OpenAPI document from schemas written in **any** library that
implements [Standard Schema](https://standardschema.dev) and
[Standard JSON Schema](https://standardschema.dev/json-schema). It contains no code for any
particular schema library, and it never asks an app to call a method this package invented. Schemas
are annotated through the metadata mechanism their implementation already provides.

## The contract it is written against

```ts
schema['~standard'].validate(value); // StandardSchemaV1
schema['~standard'].jsonSchema.input({ target }); // StandardJSONSchemaV1
schema['~standard'].jsonSchema.output({ target });
```

`target` is `'draft-2020-12' | 'draft-07' | 'openapi-3.0'`. Draft 2020-12 _is_ the dialect OpenAPI
3.1 uses, so producing a 3.1 document needs no schema translation whatsoever — only moving `$defs`
into `components.schemas` and rewriting the pointers that reach them. That single fact is why this
package can generate documents without inspecting a schema implementation's internal types.

`input` describes what a request must send, `output` what a response contains — the distinction
matters for any schema with a transform, and the generator picks the right side per position rather
than making the app think about it.

## Component identity: `$id`

A schema becomes a named component by carrying `$id`:

```ts
// Add these JSON Schema keywords through your schema implementation's metadata mechanism.
{
  $id: 'Card', // this package: the component name, wherever the schema appears
  title: 'Card',
  description: 'An owned trading card entry',
}
```

Some schema implementations use a separate identifier for a **nested** schema, but a root schema
may be emitted anonymously. `$id` is an ordinary JSON Schema keyword, so it survives in both
positions. A rule of "any node carrying `$id` becomes a component" therefore covers roots and
nested schemas alike without this package reading implementation-specific state.

Naming rules, in order:

1. A node with `$id` is hoisted into `components.schemas[$id]` and replaced by a `$ref`.
2. A `$defs` entry without `$id` is named by its key.
3. `registry.register(name, schema)` names a schema from the outside, for schemas that carry neither.
4. Anything else is described inline.

Two different schemas claiming one name is a `ComponentNameConflictError` rather than a silent
last-one-wins.

## Normalization

Schema libraries emit correct JSON Schema that reads awkwardly as an OpenAPI document. Four
adjustments are applied by default, each switchable on its own through `normalization`:

| Rule                             | Turns                                     | Into                     |
| -------------------------------- | ----------------------------------------- | ------------------------ |
| `dropStrictAdditionalProperties` | `additionalProperties: false`             | _(removed)_              |
| `dropFormatImpliedPatterns`      | `format: 'uuid'` + `pattern`              | `format: 'uuid'`         |
| `collapseNullableUnions`         | `anyOf: [{type:'string'}, {type:'null'}]` | `type: [null, 'string']` |
| `constToEnum`                    | `const: 'X'`                              | `enum: ['X']`            |

They are deliberately narrow. `dropStrictAdditionalProperties` removes only the literal `false` a
stripping object produces, so a permissive object's `additionalProperties: {}` survives.
`dropFormatImpliedPatterns` removes `pattern` only when a `format` sits beside it, so a hand-written
`.regex()` — which has no format — is kept.

## Parameters come from the JSON Schema

`request.params`, `query`, `headers` and `cookies` are described by walking the converted object's
`properties`: each key becomes one parameter, `required` comes from the `required` array (a path
parameter is always required), and the description is repeated on the parameter because tools read
it from either place. There is no `param: { name, in }` metadata to write, and no schema
introspection — the name _is_ the property key.

Response headers are described the same way.

## Validation

`standardValidator` runs `~standard.validate` through Hono's own `validator()`. A failure reaches the
route's hook, or the nearest `defaultHook` walking up the mount chain, and otherwise answers `400`
with the issues.

The hook's failure shape is defined by Standard Schema:

```ts
{ target, success: false, data, error: { issues: readonly StandardSchemaV1.Issue[] } }
```

Header names are matched case-insensitively against the schema's own property names, which is
possible here because those names come from the JSON Schema rather than from a vendor's object shape.

## Known gaps

- `.basePath()` is not overridden, so an app built with it does not carry its registry. Mount with
  `.route()` instead.
- Webhooks are registered and emitted, but not yet covered by tests.
- Handler `Env` is not inferred from a route's `middleware`; the app's own `Env` is used.
