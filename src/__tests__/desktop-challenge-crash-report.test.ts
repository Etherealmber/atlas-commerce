// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../auth', () => ({ isLoggedIn: () => true }));
import { reportCrash } from '../lib/crashReporter';

afterEach(() => vi.unstubAllGlobals());

it('never sends challenge-page errors even in a logged-in system browser', () => {
  (window as any).happyDOM.setURL('https://store.example:8443/login/desktop-challenge');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  reportCrash(new Error('fictional-sensitive-provider-detail'));
  expect(fetch).not.toHaveBeenCalled();
});
