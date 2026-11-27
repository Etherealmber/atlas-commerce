// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import Quotes from '../pages/Quotes';

afterEach(() => vi.restoreAllMocks());
it('shows quotes without waiting for slow client and product lookups', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: [{ id: 1, number: 'DEV-001', status: 'quote', client_name: 'Client' }] } as any);
  vi.spyOn(api, 'getClients').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'getProducts').mockReturnValue(new Promise(() => {}));
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(Quotes))));
  expect(host.textContent).toContain('DEV-001');
  await act(async () => root.unmount()); host.remove();
});
