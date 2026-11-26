import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { waitForVisualReady } from './visual-wait.mjs';

function fakePage() {
  return {
    async evaluate(fn) { fn(); },
    async waitForFunction(fn, { timeout }, stable) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (fn(stable)) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const e = new Error('timeout'); e.name = 'TimeoutError'; throw e;
    },
  };
}

test('waits for the visible skeleton to disappear and remain absent', async () => {
  const window = new Window(); globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const skeleton = document.createElement('div'); skeleton.className = 'skeleton';
  skeleton.getBoundingClientRect = () => ({ width: 100, height: 20 }); document.body.append(skeleton);
  let completed = false;
  const result = waitForVisualReady(fakePage(), { timeout: 300, stableMs: 30 }).then((ready) => { completed = true; return ready; });
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(completed, false);
  skeleton.remove();
  assert.equal(await result, true);
});

test('reports a timeout instead of claiming a loading page is ready', async () => {
  const window = new Window(); globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const busy = document.createElement('section'); busy.setAttribute('aria-busy', 'true');
  busy.getBoundingClientRect = () => ({ width: 200, height: 20 }); document.body.append(busy);
  assert.equal(await waitForVisualReady(fakePage(), { timeout: 40, stableMs: 10 }), false);
});
