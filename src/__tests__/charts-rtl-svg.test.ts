// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installI18n, setLang } from '../i18n';
vi.mock('../lib/metricSeries', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/metricSeries')>(), useMetricSeries: () => ({ data: { dates: ['2026-01-01'], kinds: {}, series: { in_stock: [4], low_stock: [1], out_of_stock: [0], products: [5], money_in: [500], money_out: [100] } } }) }));
import { PhoneInOutChart, PhoneStockDonut } from '../mobile/PhoneCharts';
import { AreaChart } from '../components/DashboardCharts';
installI18n();
afterEach(() => setLang('fr'));
it('translates the phone chart SVG label and embedded stock legend without the DOM bridge', () => {
  setLang('ar');
  const stock = renderToStaticMarkup(createElement(PhoneStockDonut, {}));
  expect(stock).toContain('من المنتجات متوفرة');
  expect(stock).toContain('>متوفر</text>');
  const flow = renderToStaticMarkup(createElement(PhoneInOutChart, {}));
  expect(flow).toContain('المقبوض');
  expect(flow).toContain('المدفوع');
  expect(flow).not.toContain('derniers jours');
});
it('isolates Arabic axis digits in LTR SVG runs without changing their order', () => {
  setLang('ar');
  const html = renderToStaticMarkup(createElement(AreaChart, { series: [{ key: '2026-01', sale: 1000000 }], keys: [{ key: 'sale', label: 'Ventes', color: '#000' }] }));
  expect(html).toContain('direction="rtl"');
  expect(html).toContain('direction="ltr" style="unicode-bidi:isolate"');
  expect(html).toContain('مليون');
});
it('localizes metric sparkline accessible names and comparison titles', async () => {
  // MetricSpark consumes the same daily series; its translated labels must not rely on the DOM bridge.
  const { MetricSpark } = await import('../components/MetricSpark');
  setLang('ar');
  const html = renderToStaticMarkup(createElement(MetricSpark, { k: 'money_in', unit: 'money', currency: 'MAD' }));
  expect(html).toContain('التطور من');
  expect(html).toContain('آخر قيمة');
  expect(html).toContain('درهم');
  expect(html).not.toContain('Évolution du');
});
