// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditAgentExplanation } from '../components/audit/AuditAgentExplanation';
import { api } from '../api';
import { setLang } from '../i18n/core';

afterEach(() => { vi.restoreAllMocks(); setLang('fr'); });

it('only asks for an explanation after a click and sends the chosen locale', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  setLang('en');
  const explain = vi.spyOn(api, 'explainLogLine').mockResolvedValue({ data: { summary: 'Test explanation', risk: 'normal', advice: 'Review.', source: 'rules' } });
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AuditAgentExplanation, { id: 42 })));
    expect(explain).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')!.click());
    expect(explain).toHaveBeenCalledWith('audit', 42, 'en');
    expect(host.textContent).toContain('Test explanation');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
