// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CookieConsent from '../components/CookieConsent';
import { getConsent, openConsentSettings } from '../lib/cookieConsent';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  history.replaceState(null, '', '/privacy');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(CookieConsent)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.cookie-consent button')].find(b => b.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

describe('cookie consent choices', () => {
  it('stores only necessary data when chosen', async () => {
    expect(document.querySelector('[aria-labelledby="cookie-consent-title"]')).not.toBeNull();
    await act(async () => button('Nécessaires seulement').click());
    expect(getConsent()).toMatchObject({ necessary: true, preferences: false, analytics: false, method: 'necessary_only' });
    expect(document.querySelector('.cookie-consent')).toBeNull();
  });
  it('stores all categories when accepted', async () => {
    await act(async () => button('Tout accepter').click());
    expect(getConsent()).toMatchObject({ necessary: true, preferences: true, analytics: true, method: 'accept_all' });
  });
  it('preserves custom choices and can be reopened and closed', async () => {
    await act(async () => button('Personnaliser').click());
    const boxes = document.querySelectorAll<HTMLInputElement>('.cookie-consent-row input');
    expect(boxes).toHaveLength(3);
    expect(boxes[0].disabled).toBe(true);
    await act(async () => { boxes[1].click(); boxes[2].click(); });
    await act(async () => button('Enregistrer mes choix').click());
    expect(getConsent()).toMatchObject({ necessary: true, preferences: false, analytics: true, method: 'custom' });
    await act(async () => openConsentSettings());
    expect(document.querySelector<HTMLInputElement>('.cookie-consent-row input:disabled')?.checked).toBe(true);
    const close = document.querySelector<HTMLButtonElement>('.cookie-consent-card [aria-label="Fermer"]');
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(document.querySelector('.cookie-consent')).toBeNull();
    expect(getConsent()?.method).toBe('custom');
  });
});
