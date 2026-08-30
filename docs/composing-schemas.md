# Composing schemas

A route's `content.schema` — and `objectSchema`'s own properties — accept exactly one value each.
Normally that value is a single schema from a single library. `allOf` and `objectSchema` let you
combine several schemas, possibly from different libraries, into one document fragment instead.

## Why

A response document is generated from whichever _one_ schema you hand it. If your base response
comes from Zod and an app-supplied extension comes from ArkType, there is no `.merge()` or
`.extend()` that works across libraries — they don't share an internal representation. `allOf` and
`objectSchema` sidestep that: each member schema converts to JSON Schema independently, through its
own library's converter, and the results are combined as plain JSON Schema keywords (`allOf`,
`properties`) rather than merged at the schema-library level.

## `allOf`: combine whole schemas

`allOf(schemas)` presents several schemas as one `allOf`. A member that names itself through `$id`
still becomes its own component and a `$ref`, exactly as it would as a route's only schema:

```ts
import { allOf, createRoute } from '@kamaalio/hono-standard-openapi';
import { z } from 'zod';
import { type } from 'arktype';

declare global {
  interface ArkEnv {
    meta(): { $id?: string };
  }
}

const Card = z.object({ id: z.string(), name: z.string() }).meta({ $id: 'Card' });
const Pricing = type({ amount: 'number' }).configure({ $id: 'Pricing' });

const getCard = createRoute({
  method: 'get',
  path: '/cards/{cardId}',
  request: { params: z.object({ cardId: z.string() }) },
  responses: {
    200: { content: { 'application/json': { schema: allOf([Card, Pricing]) } }, description: 'A card' },
  },
});
```

The response schema in the generated document is:

```json
{
  "allOf": [{ "$ref": "#/components/schemas/Card" }, { "$ref": "#/components/schemas/Pricing" }]
}
```

## `objectSchema`: nest a schema under a property key

`allOf` combines whole schemas — it can't fold one schema under a specific _property_ of another.
`objectSchema(properties)` builds an object schema out of independently-converted properties (every
property required), which is what you compose with `allOf` to extend one field of a larger response
without touching the rest of it:

```ts
import { allOf, objectSchema } from '@kamaalio/hono-standard-openapi';

// Order already has a `customer` property with its own fields.
const withLoyaltyTier = allOf([Order, objectSchema({ customer: LoyaltyTierSchema })]);
```

The instance's `customer` value must now satisfy both `Order`'s own constraints on `customer` and
`LoyaltyTierSchema` — ordinary JSON Schema `allOf` semantics, applied independently per property, so
neither schema needs to know the other's shape.
