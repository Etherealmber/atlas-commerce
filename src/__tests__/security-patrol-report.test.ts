/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { encodePatrolJson, renderPatrolReport, safeReportText } from '../../scripts/security-patrol-report.mjs';

describe('security patrol report safety', () => {
  it('escapes untrusted markdown, HTML, mentions, control characters and long inputs', () => {
    const payload = '<img src=x onerror=alert(1)>\n@everyone [click](https://evil.test) `hi`';
    const out = renderPatrolReport({ startedAt: payload, base: payload, totalChecks: 1, passed: 0,
      waf: { blocked: 4, lastSig: payload, lastAt: payload },
      findings: [{ title: payload, severity: 'high', detail: payload, fix: payload }] });
    expect(out).not.toContain('<img');
    expect(out).not.toContain('@everyone');
    expect(out).not.toContain('\n@');
    expect(out).toContain('&lt;img');
    expect(out).toContain('\\[click\\]\\(');
    expect(safeReportText('a'.repeat(2000))).toHaveLength(800);
  });
  it('does not allow remote data to inject workflow sentinel delimiters', () => {
    const doc = { test: 'before::END-PATROL-JSON::after' };
    const encoded = encodePatrolJson(doc);
    expect(encoded).not.toContain('::');
    expect(JSON.parse(encoded)).toEqual(doc);
  });
});
