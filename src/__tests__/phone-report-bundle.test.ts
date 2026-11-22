// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneReportBundle, { isolateReportHtml } from '../mobile/PhoneReportBundle';
import { readReportBytes } from '../mobile/reportResponse';
vi.mock('../auth', () => ({ getToken: () => 'secret-session' }));
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'fingerprint' }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!;
it('limits a streamed report without a content length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(6)); controller.close(); } });
  await expect(readReportBytes(new Response(stream), 10)).rejects.toThrow('volumineux');
});
it('removes active content, navigations and report tickets from untrusted HTML', () => {
  const html = isolateReportHtml('<html><head><script>alert(1)</script></head><body><a href="/api/reports/balance?rt=secret" onclick="alert(1)">Balance</a><img src="https://evil.test/x"><form action="https://evil.test"><input></form><p>Safe report</p></body></html>');
  expect(html).toContain('Safe report'); expect(html).not.toContain('secret'); expect(html).not.toContain('evil.test'); expect(html).not.toContain('<script'); expect(html).not.toContain('onclick'); expect(html).toContain('Content-Security-Policy');
  const section = isolateReportHtml('<main class="report-content"><section>Balance</section><section>Stock</section></main>', 1);
  expect(section).toContain('Stock'); expect(section).not.toContain('Balance');
});
it('generates selected sections with authenticated headers in a sandbox, without URL tokens', async () => {
  const fetchMock = vi.fn(async () => new Response('<html><body><p>Rapport privé</p><a href="?rt=secret">Autre</a></body></html>', { headers: { 'Content-Type': 'text/html' } })); vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(createElement(PhoneReportBundle, { onClose: () => {} })));
  await act(async () => { button('Stock').click(); button('3 mois').click(); });
  await act(async () => button('Préparer').click());
  const [url, init] = fetchMock.mock.calls[0] as any;
  expect(url).toContain('period=3m'); expect(url).not.toContain('secret-session'); expect(new URL(url).searchParams.get('sections')?.split(',')).not.toContain('stock');
  expect(init.headers.Authorization).toBe('Bearer secret-session'); expect(init.redirect).toBe('error');
  const frame = document.querySelector('iframe')!; expect(frame.getAttribute('sandbox')).toBe(''); expect(frame.getAttribute('srcdoc')).toContain('Rapport privé'); expect(frame.getAttribute('srcdoc')).not.toContain('rt=secret');
});
it('requires at least one section and valid custom dates', async () => {
  await act(async () => root.render(createElement(PhoneReportBundle, { onClose: () => {} })));
  await act(async () => { for (const label of ['Balance', 'Stock', 'Créances clients', 'Fournisseurs', 'Employés & paie', 'Balance âgée', 'TVA']) button(label).click(); });
  expect(button('Préparer').disabled).toBe(true);
  await act(async () => { button('Balance').click(); button('Du… au…').click(); });
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type=date]');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[0], '2099-01-01'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); inputs[0].dispatchEvent(new Event('change', { bubbles: true })); });
  expect(button('Préparer').disabled).toBe(true);
});
it('allows editing after preview and keeps the selected report choices', async () => {
  const report = '<!doctype html><html><body><div class="sheet"><div class="actions"><button>Print</button></div><main class="report-content"><section>Balance details</section><section>Stock details</section></main></div></body></html>';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(report, { headers: { 'Content-Type': 'text/html' } })));
  await act(async () => root.render(createElement(PhoneReportBundle, { onClose: () => {} })));
  expect(button('Ce mois').getAttribute('aria-pressed')).toBe('true'); expect(button('3 mois').getAttribute('aria-pressed')).toBe('false');
  await act(async () => { button('3 mois').click(); button('Stock').click(); });
  await act(async () => button('Préparer').click());
  const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame.srcdoc).toContain('background:#fff'); expect(frame.srcdoc).not.toContain('<button>Print</button>');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Modifier le rapport"]')!.click());
  expect(button('3 mois').getAttribute('aria-pressed')).toBe('true'); expect(button('Stock').getAttribute('aria-pressed')).toBe('false');
});
it('displays the correct preview section after changing section order', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body><main class="report-content"><section>Stock details</section><section>Balance details</section></main></body></html>', { headers: { 'Content-Type': 'text/html' } })));
  await act(async () => root.render(createElement(PhoneReportBundle, { onClose: () => {} })));
  await act(async () => { for (const label of ['Balance', 'Créances clients', 'Fournisseurs', 'Employés & paie', 'Balance âgée', 'TVA']) button(label).click(); button('Balance').click(); });
  await act(async () => button('Préparer').click());
  await act(async () => button('Balance').click());
  const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame.srcdoc).toContain('Balance details'); expect(frame.srcdoc).not.toContain('Stock details');
  await act(async () => button('Stock').click());
  expect(frame.srcdoc).toContain('Stock details'); expect(frame.srcdoc).not.toContain('Balance details');
});
