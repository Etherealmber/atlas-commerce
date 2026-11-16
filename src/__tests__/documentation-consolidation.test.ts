import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const removed = [
  'docs/ai-brief.md', 'docs/android-fcm-bridge-prompt.md', 'docs/desktop-design-prompt.md',
  'docs/THEME-NO-TEAL.md', 'docs/shared-egress-staging-validation.md', 'docs/finance-6000-investigation.md',
];
describe('consolidated documentation', () => {
  it('removes outdated AI prompts and replaces references to the consolidated files', () => {
    for (const path of removed) expect(existsSync(path)).toBe(false);
    for (const file of ['README.md', 'SETUP.md', 'src/pages/WhatsNew.tsx', 'worker/lib/finance.ts', 'worker/__tests__/finance.test.ts', 'docs/api-finance.md', 'docs/login-rate-limits.md']) {
      const text = readFileSync(file, 'utf8');
      for (const path of removed) expect(text).not.toContain(path);
    }
  });
  it('retains operational safety boundaries and clearly labels historical design guidance', () => {
    const login = readFileSync('docs/login-rate-limits.md', 'utf8');
    expect(login).toContain('Live staging scenario: NOT EXECUTED');
    expect(login).toContain('Do not use a Workers preview as staging without checking its bindings');
    expect(login).toContain('Controlled sequence');
    expect(readFileSync('docs/api-finance.md', 'utf8')).toContain('## Historical double-count investigation');
    const fcm = readFileSync('docs/android-fcm-send-audit.md', 'utf8');
    expect(fcm).toContain('Configuration Firebase');
    expect(fcm).toContain('Pas de repli trompeur');
    expect(fcm).toContain('Non vérifiée en production');
    const design = readFileSync('src/components/ui/README.md', 'utf8');
    expect(design).toContain('historical reference, not a current specification');
    expect(design).toContain('Legacy teal tokens');
  });
});
