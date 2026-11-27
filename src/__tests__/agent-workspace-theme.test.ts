import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the expanded sidebar readable and avoids duplicated branding without hiding the conversation picker', () => {
  const css = readFileSync('src/styles/atlas-agent-workspace.css', 'utf8');
  expect(css).toContain('flex-basis: 280px');
  expect(css).toContain('html[data-theme="dark"] body aside.atlas-agent-panel');
  expect(css).toContain('--agent-ink: #f4f4f5');
  expect(css).toContain('.atlas-agent-history-trigger small { display: none; }');
  expect(css).not.toMatch(/\.atlas-agent-history-trigger\s*\{\s*display:\s*none/);
  expect(css).toContain(':not(.atlas-agent-workspace-threads) { flex-shrink: 0; }');
});
