import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

describe('tracked Worker observability', () => {
  it('redacts query strings in Worker logs and traces, including inherited preview settings', () => {
    const result = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
    expect(result.error).toBeUndefined();
    const config = result.config;
    expect(config.observability.redact_query_string).toBe(true);
    expect(config.observability.traces.head_sampling_rate).toBe(0.05);
    expect(config.observability.logs.head_sampling_rate).toBe(1);
    // This repository does not override observability in its preview block.
    expect(config.previews?.observability).toBeUndefined();
  });

  it('prevents previews from using production D1, KV, R2, or Email bindings', () => {
    const result = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
    expect(result.error).toBeUndefined();
    const config = result.config;
    expect(config.preview_urls).toBe(false);
    expect(config.previews).toBeDefined();
    expect(config.previews.vars?.DESKTOP_NATIVE_V3_ENABLED).toBe('false');
    const previewsJson = JSON.stringify(config.previews);
    expect(previewsJson).not.toContain('aba10fd7-bb8b-432c-a5ec-1701e43654c6');
    expect(previewsJson).not.toContain('33a5cd31362243138590c446614ffb9b');
    expect(previewsJson).not.toContain('"company-stock-images"');
    expect(previewsJson).not.toContain('admin@afmarbre.com');
    expect(config.previews.kv_namespaces).toBeUndefined();
    expect(config.previews.d1_databases).toBeUndefined();
    expect(config.previews.r2_buckets).toBeUndefined();
    expect(config.previews.send_email).toBeUndefined();
  });
});
