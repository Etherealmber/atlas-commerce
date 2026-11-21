import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('mobile theme stylesheets', () => {
  it.each(['src/mobile/phone.css', 'src/styles/dark-force.css'])('%s parses without CSS syntax warnings', async (file) => {
    const result = await transform(readFileSync(file, 'utf8'), { loader: 'css', logLevel: 'silent' });
    expect(result.warnings.map((warning) => warning.text)).toEqual([]);
  });
});
