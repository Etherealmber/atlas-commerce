// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';
import { __resetMetricSeries, computeTrend, isEmptySeries, type MetricsDaily } from '../lib/metricSeries';
import { api } from '../api';

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`);
const fixture: MetricsDaily = {
  days: 7,
  dates,
  series: {
    sales: [10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 20, 20],
    low_stock: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 4],
    owner_contrib: Array(14).fill(0),
    balance: [...Array(12).fill(null), 100, 110],
  },
  kinds: { sales: 'flow', low_stock: 'level', owner_contrib: 'flow', balance: 'level' },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  __resetMetricSeries(null);
  vi.restoreAllMocks();
});

describe('metric trend maths', () => {
  it('compares flows period-over-period and day-over-day', () => {
    expect(computeTrend(fixture.series.sales, 'flow', dates)).toMatchObject({ pct: 100, direction: 'up', against: 'vs 7 jours précédents' });
    expect(computeTrend(fixture.series.sales, 'flow', dates, 'day')).toMatchObject({ pct: 0, direction: 'flat', against: 'vs hier' });
  });
  it('compares levels with the value one period earlier, falling back to the nearest snapshot', () => {
    expect(computeTrend(fixture.series.low_stock, 'level', dates)).toMatchObject({ pct: 100, direction: 'up' });
    expect(computeTrend(fixture.series.balance, 'level', dates)).toMatchObject({ pct: 10, direction: 'up', against: 'vs hier' });
  });
  it('never invents an infinite percentage and flags empty series', () => {
    expect(computeTrend([0, 0, 0, 5], 'flow', dates.slice(0, 4))).toBeNull();
    expect(isEmptySeries(fixture.series.owner_contrib, 'flow')).toBe(true);
    expect(isEmptySeries([null, null, 3], 'level')).toBe(true);
    expect(isEmptySeries(fixture.series.balance, 'level')).toBe(false);
  });
});

describe('MetricSpark / MetricTrend', () => {
  const mount = async (el: ReturnType<typeof createElement>) => {
    localStorage.setItem('stock_auth_token', 'tok');
    __resetMetricSeries(fixture);
    vi.spyOn(api, 'getMetricsDaily').mockResolvedValue({ data: fixture } as any);
    await act(async () => root.render(createElement(MemoryRouter, null, el)));
  };

  it('renders a green ↗ chip and a sparkline for a rising good metric', async () => {
    await mount(createElement('div', { className: 'ac-metric' },
      createElement('div', { className: 'as-value' }, '20', createElement(MetricTrend, { k: 'sales' })),
      createElement(MetricSpark, { k: 'sales', unit: 'money' })));
    const chip = host.querySelector('[data-metric-trend="sales"]')!;
    expect(chip.classList.contains('is-good')).toBe(true);
    expect(chip.textContent).toContain('100,0%');
    expect(chip.querySelector('svg.ms-svg')).not.toBeNull();
    const spark = host.querySelector('[data-metric-spark="sales"]')!;
    expect(spark.classList.contains('is-empty')).toBe(false);
    expect(spark.querySelector('svg.ms-svg path.ms-line')?.getAttribute('d')).toMatch(/^M/);
    expect(spark.getAttribute('aria-label')).toContain('dernière valeur');
  });

  it('colours a rising « bad » metric red when inverted', async () => {
    await mount(createElement(MetricTrend, { k: 'low_stock', invert: true }));
    expect(host.querySelector('[data-metric-trend="low_stock"]')?.classList.contains('is-bad')).toBe(true);
  });

  it('shows the « Aucune donnée » pill on a faint line and hides the chip when there is no data', async () => {
    await mount(createElement('div', null,
      createElement(MetricTrend, { k: 'owner_contrib' }),
      createElement(MetricSpark, { k: 'owner_contrib' }),
      createElement(MetricSpark, { k: 'unknown_key' })));
    expect(host.querySelector('[data-metric-trend="owner_contrib"]')).toBeNull();
    const empties = host.querySelectorAll('.ms-spark.is-empty');
    expect(empties.length).toBe(2);
    empties.forEach((e) => {
      expect(e.querySelector('.ms-empty-pill')?.textContent).toBe('Aucune donnée');
      expect(e.querySelector('svg.ms-svg path.ms-wave')).not.toBeNull();
    });
  });

  it('keeps the dark hover tilt off the sparkline and resists dark text-fill', () => {
    const dark = read('src/styles/dark-force.css');
    expect(dark).toMatch(/:is\(\.ac-metric, \.ac-profile-card\):hover svg:not\(\.ms-svg\)/);
    const css = read('src/components/metric-spark.css');
    expect(css).toMatch(/\.ms-empty-pill[^{]*\{[^}]*-webkit-text-fill-color: currentColor/);
    expect(css).toMatch(/\.ms-trend[^{]*\{[^}]*-webkit-text-fill-color: currentColor/);
  });
});

describe('page actions, home pill and Nouveautés layout', () => {
  const shell = read('src/styles/shell.css');

  it('gives docked action icons an explicit, unshrinkable size', () => {
    const rule = shell.match(/\.top-page-actions > :is\(button, a\) > svg:not\(#tpa-g\)[^{]*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/width: 16px !important/);
    expect(rule?.[1]).toMatch(/min-width: 16px !important/);
    expect(rule?.[1]).toMatch(/flex: 0 0 16px !important/);
  });

  it('widens only the hovered/focused compact button, not the whole bar', () => {
    expect(shell).toMatch(/--compact(?:, \[data-tpa-fit="icons"\]\))? \.top-page-actions > :is\(button, a\):has\(> \.tpa-label\):not\(\.tpa-keep-wide\):is\(:hover, :focus-visible\)[^{]*\{[^}]*max-width: 260px/);
    expect(shell).toMatch(/--compact(?:, \[data-tpa-fit="icons"\]\))? \.top-page-actions > :is\(button, a\):is\(:hover, :focus-visible\) > \.tpa-label[^{]*\{[^}]*opacity: 1/);
    expect(shell).not.toMatch(/desktop-catalog-actions-slot:hover[^{]*\.tpa-label/);
    const app = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const enter = app.slice(app.indexOf('id="desktop-catalog-actions"'), app.indexOf('<header ref={dockRef}'));
    expect(enter).not.toMatch(/onFocus=/);
    expect(enter).not.toMatch(/onPointerEnter=\{[\s\S]*?setActionsCompact\(false\)[\s\S]*?onPointerLeave/);
  });

  it('replaces the dock back arrow with an icon-only home pill that expands on hover', () => {
    const app = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/ac-dock-back/);
    expect(app).toMatch(/\{isFocusRoute && \(\s*<Link className=\{`ac-home-pill\$\{actionsCompact \? '' : ' is-expanded'\}`\} to="\/dashboard"/);
    expect(shell).toMatch(/a\.ac-home-pill > \.ac-home-pill-label[^{]*\{[^}]*max-width: 0/);
    expect(shell).toMatch(/a\.ac-home-pill:is\(:hover, :focus-visible, \.is-expanded\) > \.ac-home-pill-label[^{]*\{[^}]*opacity: 1/);
  });

  it('keeps the Nouveautés content still when the focus sidebar opens or collapses (Settings / About stretch)', () => {
    const focus = read('src/styles/focus-sidebar.css');
    // Authenticated layouts stretch when the rail collapses — except the centred Nouveautés page.
    expect(focus).toMatch(/\.layout \.atlas-focus-layout:not\(\.atlas-focus-layout--centered\):has\(\.atlas-focus-sidebar\.is-collapsed\)/);
    const desktop = focus.split('@media (max-width: 960px)')[0];
    expect(desktop).not.toMatch(/\.public-whats-new \.atlas-focus-layout:has\(\.atlas-focus-sidebar\.is-collapsed\)/);
    const app = read('src/App.tsx');
    expect(app).toContain('atlas-focus-layout atlas-focus-layout--centered');
    const wn = readFileSync(path.resolve(process.cwd(), 'src/pages/WhatsNew.tsx'), 'utf8');
    expect(wn).not.toMatch(/wn-crumb/);
  });
});
