// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentMarkdown } from '../components/agent/AgentMarkdown';
import { AgentClarification, parseClarification } from '../components/agent/AgentClarification';

it('renders GFM tables, safe links and literal line-break markers without executing HTML', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(createElement(AgentMarkdown, { text: '| Nom | Détail |\n| --- | --- |\n| **Stock** | Un<br>Deux |\n\n[Factures](/invoices) [mal](javascript:alert(1))\n\n<script>alert(1)</script> ![x](https://example.com/x.png)' })));
  expect(el.querySelector('table')).not.toBeNull();
  expect(el.querySelector('strong')?.textContent).toBe('Stock');
  expect(el.textContent).toContain('Un · Deux');
  expect(el.querySelector('a')?.getAttribute('href')).toBe('/invoices');
  expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(el.querySelector('script, img')).toBeNull();
  await act(async () => root.unmount());
});

it('only shows valid opt-in questions and submits a selected answer explicitly', async () => {
  const invalid = '```atlas-clarification\n{"question":"Test","options":["Un"]}\n```';
  expect(parseClarification(invalid).text).toBe(invalid);
  expect(parseClarification(invalid).question).toBeNull();
  const parsed = parseClarification('Pour préciser :\n```atlas-clarification\n{"question":"Quelle page ?","options":["Factures","Devis"]}\n```');
  expect(parsed.text).toBe('Pour préciser :');
  const el = document.createElement('div'); const root = createRoot(el); const submit = vi.fn();
  await act(async () => root.render(createElement(AgentClarification, { question: parsed.question!, disabled: false, onSubmit: submit })));
  expect(submit).not.toHaveBeenCalled();
  await act(async () => (el.querySelector('input[type=radio]') as HTMLInputElement).click());
  await act(async () => el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submit).toHaveBeenCalledWith('Quelle page ?\nMa réponse : Factures');
  expect(submit).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
