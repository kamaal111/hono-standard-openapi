# Repository commands

Use the recipes in the `justfile` for project commands, including installation, formatting,
linting, type-checking, testing, compilation, and publishing. Do not invoke `pnpm` directly unless
there is no applicable Justfile recipe.

Before sending a final response for a completed change, run `just ready` and require it to pass.
