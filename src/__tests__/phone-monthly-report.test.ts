// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneMonthlyReport from '../mobile/PhoneMonthlyReport';

vi.mock('../auth', () => ({ getToken: () => 'private-test-token' }));
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'test-fingerprint' }));
const pdf = vi.hoisted(() => ({ destroy: vi.fn(), getPage: vi.fn(), getDocument: vi.fn(), options: { workerSrc: '' } }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: pdf.options }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('fetches PDF with headers, renders pages and destroys the in-memory document on close', async () => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  pdf.getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render });
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: pdf.getPage }), destroy: pdf.destroy });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any);
  vi.stubGlobal('IntersectionObserver', class { callback: IntersectionObserverCallback; constructor(callback: IntersectionObserverCallback) { this.callback = callback; } observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} });
  const fetchMock = vi.fn(async () => new Response(new Blob(['%PDF-test'], { type: 'application/pdf' }), { headers: { 'Content-Type': 'application/pdf' } }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => { root.render(createElement(PhoneMonthlyReport, { period: '2026-10', onClose: () => {} })); });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, options] = fetchMock.mock.calls[0] as any;
  expect(url).toContain('period=2026-10'); expect(url).not.toContain('private-test-token');
  expect(options.headers.Authorization).toBe('Bearer private-test-token'); expect(options.redirect).toBe('error');
  expect(document.body.textContent).toContain('Page 1');
  expect(document.body.textContent).toContain('Page 2');
  expect(document.querySelectorAll('.ph-pdf-page')).toHaveLength(2);
  expect(render).toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Agrandir le PDF"]')!.click());
  expect(document.body.textContent).toContain('125%');
  await act(async () => root.unmount());
  expect(pdf.destroy).toHaveBeenCalled();
  root = createRoot(host);
});
it('rejects a non-PDF response without displaying its body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private response', { status: 403 })));
  await act(async () => root.render(createElement(PhoneMonthlyReport, { period: '2026-10', onClose: () => {} })));
  expect(document.body.textContent).toContain('Rapport PDF indisponible');
  expect(document.body.textContent).not.toContain('private response');
  expect(pdf.getDocument).not.toHaveBeenCalled();
});
