import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE_DIRECTORY = new URL('../src', import.meta.url).pathname;

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIRECTORY)
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => join(SOURCE_DIRECTORY, entry));
}

describe('vendor neutrality', () => {
  it('names no schema library anywhere in the source', () => {
    const offenders = sourceFiles().filter(file =>
      /\b(zod|valibot|arktype|effect\/Schema)\b/i.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('depends on nothing but the specification and the OpenAPI types', () => {
    // oxlint-disable-next-line typescript/no-explicit-any
    const packageJson: Record<string, any> = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'),
    );

    expect(Object.keys(packageJson.dependencies)).toEqual(['@standard-schema/spec', 'openapi3-ts']);
  });
});
