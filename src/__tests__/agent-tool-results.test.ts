// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { AgentToolResults } from '../components/agent/AgentToolResults';

it('renders bounded allowlisted real results, empty results and no failed or unknown data', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AgentToolResults, { tools: [
    { name: 'search_products', ok: true, data: [{ name: 'Clavier', sku: 'A', stock_quantity: 3, secret: 'hidden' }] },
    { name: 'search_clients', ok: true, data: { items: [] } },
    { name: 'list_unpaid_invoices', ok: false, data: [{ number: 'failed' }] },
    { name: 'unknown', ok: true, data: [{ name: 'unknown' }] },
    { name: 'list_open_quotes', data: [{ number: 'historical' }] },
  ] }))));
  expect(host.textContent).toContain('Clavier');
  expect(host.textContent).toContain('Aucun résultat');
  expect(host.querySelectorAll('details')).toHaveLength(2);
  expect(host.textContent).not.toContain('hidden');
  expect(host.textContent).not.toContain('failed');
  expect(host.textContent).not.toContain('historical');
  await act(async () => root.unmount());
});
