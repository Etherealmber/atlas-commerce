// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { AppDialogsProvider, useUi } from '../components/AppDialogs';

it('shows one toast for identical concurrent errors and keeps distinct errors', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  function Example() { const { toast } = useUi(); return createElement('button', { onClick: () => { toast('Initialisation en cours', 'error'); toast('Initialisation en cours', 'error'); toast('Autre erreur', 'error'); } }, 'Go'); }
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(createElement(AppDialogsProvider, null, createElement(Example))));
  await act(async () => host.querySelector('button')!.click());
  expect([...document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)).toEqual(['Initialisation en cours', 'Autre erreur']);
  await act(async () => root.unmount()); host.remove();
});
