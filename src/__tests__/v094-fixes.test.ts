import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeAgentPolicy, quotaPercent, quotaReached } from '../lib/agentQuota';
import { normalizeLinkedDevices } from '../mobile/PhoneDeviceScan';

describe('Atlas Agent quota never shows NaN', () => {
  it('normalises missing or malformed numbers to 0', () => {
    const p = normalizeAgentPolicy({ blocked: false, isAdmin: false, dailyUsed: 'x', weeklyLimit: null });
    expect(p).toMatchObject({ dailyUsed: 0, dailyLimit: 0, weeklyUsed: 0, weeklyLimit: 0, blocked: false, isAdmin: false });
    expect(normalizeAgentPolicy(null)).toBeNull();
    expect(normalizeAgentPolicy([1, 2])).toBeNull();
  });
  it('hides the percentage when the limit is unknown, clamps otherwise', () => {
    expect(quotaPercent(10, 0)).toBeNull();
    expect(quotaPercent(Number.NaN, 100)).toBeNull();
    expect(quotaPercent(25, 100)).toBe(25);
    expect(quotaPercent(250, 100)).toBe(100);
  });
  it('an unknown limit never blocks sending', () => {
    expect(quotaReached(0, 0)).toBe(false);
    expect(quotaReached(100, 100)).toBe(true);
  });
  it('the agent panel no longer divides raw policy numbers', () => {
    const src = readFileSync('src/components/AtlasAgent.tsx', 'utf8');
    expect(src).not.toMatch(/dailyUsed \/ agentPolicy\.dailyLimit/);
    expect(src).toContain('normalizeAgentPolicy(res.data)');
  });
});

describe('mobile connected devices', () => {
  it('normalises partial server rows and drops unusable ones', () => {
    const rows = normalizeLinkedDevices([
      { full: 'a', device_label: 'Windows · Atlas Desktop', last_seen: '2026-11-24', last_ip: '1.2.3.4', city: 'Casablanca', country: 'MA', user_agent: 'AtlasDesktop', current: false },
      { full: 'b', user_agent: 'Mozilla/5.0 (Linux; Android 14)', current: true },
      { fingerprint: 'no-full' },
      null,
      'junk',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ full: 'a', label: 'Windows · Atlas Desktop', meta: '2026-11-24 · IP 1.2.3.4 · Casablanca, MA', current: false, mobile: false });
    expect(rows[1]).toMatchObject({ full: 'b', label: 'Appareil', current: true, mobile: true });
    expect(normalizeLinkedDevices({ data: [] })).toEqual([]);
  });
  it('the scan button is not mislabelled as a theme toggle', () => {
    const src = readFileSync('src/mobile/PhoneDeviceScan.tsx', 'utf8');
    expect(src).not.toContain('theme-toggle');
    expect(src).toContain('<LinkedDevices />');
  });
});

describe('mobile back buttons follow the floating bar', () => {
  const css = readFileSync('src/mobile/phone.css', 'utf8');
  const block = css.slice(css.indexOf('0.9.4 — back buttons follow the floating bar'));
  it('are transparent and borderless in both themes', () => {
    expect(block).toMatch(/\.ph-top-back[\s\S]*?background: transparent !important;[\s\S]*?border: 0 !important;/);
    expect(block).toMatch(/html\[data-theme="dark"\][^{]*\.ph-agent-dock-brand > button\) \{[\s\S]*?background: transparent !important;\s*border: 0 !important;/);
  });
});

describe('Balance reconcile head', () => {
  it('the white head rule only applies in light mode', () => {
    const app = readFileSync('src/App.css', 'utf8');
    expect(app).not.toMatch(/^html body \.balance-reconcile-head \{/m);
    expect(app).toContain('html:not([data-theme="dark"]) body .balance-reconcile-head {');
  });
});
