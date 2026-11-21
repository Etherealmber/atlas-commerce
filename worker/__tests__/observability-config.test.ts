import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

describe('tracked Worker observability', () => {
  it('redacts query strings in Worker logs and traces, including inherited preview settings', () => {
    const result = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
    expect(result.error).toBeUndefined();
    const config = result.config;
    expect(config.observability.redact_query_string).toBe(true);
    // This repository does not override observability in its preview block.
    expect(config.previews?.observability).toBeUndefined();
  });
});
