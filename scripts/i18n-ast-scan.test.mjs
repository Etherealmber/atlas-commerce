import test from 'node:test';
import assert from 'node:assert/strict';
import { readKeys, scanText } from './i18n-ast-scan.mjs';
const keys = readKeys(`export const MESSAGES = [['Bonjour', 'Hello', 'مرحبا'], ['{n} produits', '{n} products', '{n} منتج'], ['En stock', 'In stock', 'في المخزون']];`);

test('AST audit finds JSX and accessible attributes, but not code or user data', () => {
  const result = scanText(`const x = <div><p>Bonjour</p><button aria-label="Fermer">{ok ? 'Annuler' : 'Continuer'}</button><span data-user-data>Nom privé</span><code>Secret</code><input className="no translation" placeholder="Rechercher" /><span>{n} produits</span></div>; toast('Erreur réseau');`, 'example.tsx', keys);
  assert.deepEqual(result.map(x => x.text), ['Fermer', 'Annuler', 'Continuer', 'Rechercher', 'produits', 'Erreur réseau']);
  assert.equal(result[0].line, 1);
});

test('SVG needs explicit translation even when its text is in the dictionary', () => {
  const result = scanText(`const x = <svg aria-label="En stock"><text>En stock</text></svg>;`, 'chart.tsx', keys);
  assert.equal(result.length, 2);
  assert.ok(result.every(x => x.kind === 'explicit-required' && x.catalogMatch));
});

test('does not claim dynamic expressions are known or scan translated calls as literals', () => {
  const result = scanText(`const x = <p>{t('Bonjour')} {unknown} {'Bonjour'}</p>;`, 'x.tsx', keys);
  assert.equal(result.length, 0);
});

test('matches French apostrophe variants used by the translation core', () => {
  const catalog = new Set(["Nom d’utilisateur"]);
  assert.equal(scanText(`<p>Nom d'utilisateur</p>`, 'x.tsx', catalog).length, 0);
});
