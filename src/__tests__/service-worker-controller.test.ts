import { expect, it } from 'vitest';
import { controllerChangeRequiresReload } from '../lib/serviceWorkerController';

it('does not reload on first claim but still reloads for later worker updates', () => {
  const firstInstall = controllerChangeRequiresReload(false);
  expect(firstInstall()).toBe(false);
  expect(firstInstall()).toBe(true);
  expect(controllerChangeRequiresReload(true)()).toBe(true);
});
