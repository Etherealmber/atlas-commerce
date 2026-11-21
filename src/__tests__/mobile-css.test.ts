import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('mobile theme stylesheets', () => {
  it('does not hide the mobile browser Turnstile container', () => {
    const indexCss = readFileSync('src/index.css', 'utf8');
    const authCss = readFileSync('src/styles/login-auth.css', 'utf8');
    expect(indexCss).not.toMatch(/\.atlas-login--phone\s+(?:\.atlas-turnstile|#cf-turnstile)[^{]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|height:\s*0|pointer-events:\s*none)/s);
    expect(authCss).toMatch(/#cf-turnstile\s*\{[^}]*visibility:\s*visible\s*!important/s);
    expect(authCss).toMatch(/#cf-turnstile\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  });
  it.each(['src/mobile/phone.css', 'src/styles/login-auth.css', 'src/styles/dark-force.css'])('%s parses without CSS syntax warnings', async (file) => {
    const result = await transform(readFileSync(file, 'utf8'), { loader: 'css', logLevel: 'silent' });
    expect(result.warnings.map((warning) => warning.text)).toEqual([]);
  });
});
