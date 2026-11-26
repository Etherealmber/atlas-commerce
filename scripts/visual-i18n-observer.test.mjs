import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { findVisibleFrenchCandidates } from './visual-i18n-observer.mjs';

test('reports likely French presentation text while excluding marked user data and values', () => {
  const window = new Window();
  globalThis.document = window.document; globalThis.Node = window.Node; globalThis.NodeFilter = window.NodeFilter; globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  document.body.innerHTML = '<p>Chargement des factures</p><p data-user-data>François</p><code>Paramètres privés</code><input value="mot de passe" placeholder="Rechercher"/><button title="Réessayer">OK</button>';
  for (const el of document.querySelectorAll('*')) el.getBoundingClientRect = () => ({ width: 100, height: 20 });
  const found = findVisibleFrenchCandidates();
  assert.deepEqual(found.map(x => x.text).sort(), ['Chargement des factures', 'Rechercher', 'Réessayer']);
});
