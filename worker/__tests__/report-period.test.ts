/**
 * v262 — report period bounds test suite (worker/lib/report-period.ts).
 *
 * Covers: strictly validated YYYY-MM months (valid + invalid), timezone
 * boundaries via the injectable localTodayYmd(now), current partial months
 * (stop at today), historical months (full, leap-year safe), future months
 * (clamped), relative/custom parity with the previous behaviour, and period
 * propagation into section links (rt ticket kept, raw input & JWT never).
 */
import { describe, it, expect } from 'vitest';

import {
  buildReportLinkQuery,
  computePeriodBounds,
  parsePeriodMonth,
} from '../lib/report-period';
import { localTodayYmd } from '../lib/finance';

const TODAY = '2026-10-26';
const bounds = (period?: string | null, extra: { from?: string; to?: string } = {}) =>
  computePeriodBounds({ period, ...extra }, { todayYmd: TODAY });

describe('strict YYYY-MM validation', () => {
  it('parses only well-formed months', () => {
    expect(parsePeriodMonth('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(parsePeriodMonth('2026-12')).toEqual({ year: 2026, month: 12 });
    expect(parsePeriodMonth(' 2026-01 ')).toEqual({ year: 2026, month: 1 });
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-05', 'abcd-ef', 'nope', '', null, undefined, '2026/10', '2026_10', '99999-01']) {
      expect(parsePeriodMonth(bad)).toBeNull();
    }
    // sane year range only
    expect(parsePeriodMonth('1969-12')).toBeNull();
    expect(parsePeriodMonth('1970-01')).toEqual({ year: 1970, month: 1 });
    expect(parsePeriodMonth('2100-12')).toEqual({ year: 2100, month: 12 });
    expect(parsePeriodMonth('2101-01')).toBeNull();
  });

  it('rejects invalid months by falling back to the current month (never crashes)', () => {
    for (const bad of ['2026-13', '2026-1', '26-10', '2026-10-05', 'abcd-ef', 'nope', '']) {
      const b = bounds(bad);
      expect(b.periodKey).toBe('month');
      expect(b.from).toBe('2026-10-01');
      expect(b.to).toBe(TODAY);
      expect(b.label).toBe('octobre 2026');
    }
  });
});

describe('absolute months', () => {
  it('historical month uses the FULL calendar month', () => {
    const b = bounds('2026-09');
    expect(b).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'septembre 2026', periodKey: '2026-09' });
  });

  it('is leap-year safe', () => {
    expect(bounds('2024-02')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(bounds('2026-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(bounds('2024-01')).toMatchObject({ to: '2024-01-31' });
    expect(bounds('2024-04')).toMatchObject({ to: '2024-04-30' });
  });

  it('current month is PARTIAL — stops at today (timezone today)', () => {
    const b = bounds('2026-10');
    expect(b).toMatchObject({ from: '2026-10-01', to: TODAY, label: 'octobre 2026', periodKey: '2026-10' });
  });

  it('future month clamps `to` at today (deterministic empty window)', () => {
    const b = bounds('2027-01');
    expect(b.from).toBe('2027-01-01');
    expect(b.to).toBe(TODAY);
    expect(b.periodKey).toBe('2027-01');
  });

  it('year boundaries: december and january', () => {
    expect(bounds('2025-12')).toMatchObject({ from: '2025-12-01', to: '2025-12-31', label: 'décembre 2025' });
    const jan = computePeriodBounds({ period: 'month' }, { todayYmd: '2026-01-15' });
    expect(jan).toMatchObject({ from: '2026-01-01', to: '2026-01-15', label: 'janvier 2026' });
  });
});

describe('relative periods (parity with previous behaviour, tz-anchored)', () => {
  it('month/3m/12m anchor on the timezone today', () => {
    expect(bounds('month')).toMatchObject({ from: '2026-10-01', to: TODAY, periodKey: 'month' });
    expect(bounds('3m')).toMatchObject({ from: '2026-08-01', to: TODAY, label: '3 derniers mois', periodKey: '3m' });
    expect(bounds('12m')).toMatchObject({ from: '2025-11-01', to: TODAY, periodKey: '12m' });
    expect(bounds()).toMatchObject(bounds('month')); // default = month
    expect(bounds(null)).toMatchObject(bounds('month'));
  });

  it('3m rolls over the year boundary', () => {
    const b = computePeriodBounds({ period: '3m' }, { todayYmd: '2026-01-15' });
    expect(b).toMatchObject({ from: '2025-11-01', to: '2026-01-15' });
  });

  it('year/ytd start january 1st of the timezone year', () => {
    expect(bounds('year')).toMatchObject({ from: '2026-01-01', to: TODAY, label: 'Année 2026', periodKey: 'year' });
    expect(bounds('ytd')).toMatchObject({ from: '2026-01-01', to: TODAY, periodKey: 'ytd' });
  });

  it('custom requires valid YYYY-MM-DD bounds and clamps `to` at today', () => {
    expect(bounds('custom', { from: '2026-09-05', to: '2026-09-20' }))
      .toMatchObject({ from: '2026-09-05', to: '2026-09-20', label: 'Du 2026-09-05 au 2026-09-20', periodKey: 'custom' });
    expect(bounds('custom', { from: '2026-09-05', to: '2027-01-01' }).to).toBe(TODAY);
    // invalid custom bounds → current-month fallback (no NaN dates like before)
    expect(bounds('custom', { from: 'nope', to: '2026-09-20' }).periodKey).toBe('month');
    expect(bounds('custom').periodKey).toBe('month');
  });
});

describe('timezone boundaries (company finance timezone, injectable now)', () => {
  it('Tokyo is already tomorrow when UTC is still today — bounds follow the timezone', () => {
    const now = new Date('2026-10-26T15:30:00Z'); // 00:30 JST on the 27th
    const tokyo = localTodayYmd('Asia/Tokyo', now);
    const utc = localTodayYmd('UTC', now);
    expect(tokyo).toBe('2026-10-27');
    expect(utc).toBe('2026-10-26');
    const bTokyo = computePeriodBounds({ period: 'month' }, { todayYmd: tokyo });
    expect(bTokyo.to).toBe('2026-10-27');
  });

  it('month rollover happens at the timezone midnight, not UTC midnight', () => {
    const now = new Date('2026-10-31T15:30:00Z'); // already Nov 1st in Tokyo
    const tokyo = localTodayYmd('Asia/Tokyo', now);
    expect(tokyo).toBe('2026-11-01');
    const b = computePeriodBounds({ period: 'month' }, { todayYmd: tokyo });
    expect(b).toMatchObject({ from: '2026-11-01', to: '2026-11-01', label: 'novembre 2026' });
    // same instant, UTC still in October
    const bUtc = computePeriodBounds({ period: 'month' }, { todayYmd: localTodayYmd('UTC', now) });
    expect(bUtc).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('uses the configured timezone today verbatim (no frozen Casablanca offset)', () => {
    // Whatever the current Africa/Casablanca offset (DST/Ramadan shifts),
    // the bound MUST equal the tz calendar day — never the raw UTC day when
    // they differ.
    for (const iso of ['2026-10-26T07:00:00Z', '2026-10-26T23:30:00Z', '2026-03-15T12:00:00Z']) {
      const now = new Date(iso);
      const casa = localTodayYmd('Africa/Casablanca', now);
      const b = computePeriodBounds({ period: 'month' }, { todayYmd: casa });
      expect(b.to).toBe(casa);
      expect(b.from).toBe(`${casa.slice(0, 7)}-01`);
    }
  });
});

describe('period propagation into section links (rt flow preserved)', () => {
  it('links carry rt + the NORMALIZED period, never raw input', () => {
    const b = bounds('2026-9'); // invalid raw input
    const q = buildReportLinkQuery('1234.abc', b.periodKey);
    expect(q).toBe('?rt=1234.abc&period=month'); // fell back + normalized

    const ok = bounds('2026-09');
    const q2 = buildReportLinkQuery('1234.abc', ok.periodKey, { employee_id: '7' });
    expect(q2).toContain('rt=1234.abc');
    expect(q2).toContain('period=2026-09');
    expect(q2).toContain('employee_id=7');
  });

  it('never emits a session JWT into a link, even if smuggled', () => {
    const q = buildReportLinkQuery('1234.abc', '2026-09', { token: 'SESSION-JWT-VALUE', rt: 'ignored-dup' });
    expect(q).not.toContain('SESSION-JWT-VALUE');
    expect(q).not.toContain('token=');
    // single rt — the ticket argument wins
    expect(q.match(/rt=/g)?.length).toBe(1);
    expect(q).toContain('rt=1234.abc');
  });

  it('degrades gracefully without rt (fallback fetch flow) and without period', () => {
    expect(buildReportLinkQuery('', '2026-09')).toBe('?period=2026-09');
    expect(buildReportLinkQuery('', '')).toBe('?');
  });
});
