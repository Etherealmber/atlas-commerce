// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { buildDicts, installI18n, setLang, t, translate, getLang } from '../i18n';
import { retranslateAll } from '../i18n/dom';
import { MESSAGES } from '../i18n/messages';

installI18n();
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { setLang('fr'); document.body.innerHTML = ''; });

describe('i18n core', () => {
  it('every message row has an English and an Arabic translation, and no duplicate keys', () => {
    const keys = new Set<string>();
    for (const [fr, en, ar] of MESSAGES) {
      expect(en, fr).toBeTruthy();
      expect(ar, fr).toBeTruthy();
      expect(keys.has(fr), `duplicate « ${fr} »`).toBe(false);
      keys.add(fr);
    }
    const { en, ar } = buildDicts();
    expect(Object.keys(en).length).toBeGreaterThan(300);
    expect(Object.keys(ar).length).toBe(Object.keys(en).length);
  });

  it('translates exact strings, number templates and placeholders; French passes through', () => {
    expect(translate('Annuler', 'en')).toBe('Cancel');
    expect(translate('  Annuler ', 'ar')).toBe('  إلغاء ');
    expect(translate('12 factures · 20 par page', 'en')).toBe('12 invoices · 20 per page');
    expect(translate('3 action(s) mobile à traiter', 'ar')).toBe('3 إجراء(ات) هاتف للمعالجة');
    expect(translate('Plus d’actions pour FA-2026-0001', 'en')).toBe('More actions for FA-2026-0001');
    expect(translate('Texte inconnu', 'en')).toBe('Texte inconnu');
    expect(translate('Annuler', 'fr')).toBe('Annuler');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('Bonjour, {name}.', { name: 'Sara' })).toBe('Hello, Sara.');
  });

  it('translates the rendered DOM (text + attributes), skips opted-out nodes, and restores French', async () => {
    document.body.innerHTML = '<div><button title="Fermer">Annuler</button><input placeholder="Rechercher un client…"><span data-no-i18n>Annuler</span><code>Annuler</code></div>';
    setLang('ar');
    retranslateAll();
    await tick();
    expect(document.documentElement.dir).toBe('rtl');
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('إلغاء');
    expect(btn.getAttribute('title')).toBe('إغلاق');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('ابحث عن زبون…');
    expect(document.querySelector('span')!.textContent).toBe('Annuler');
    expect(document.querySelector('code')!.textContent).toBe('Annuler');

    // React-style update: new French text gets translated too.
    btn.firstChild!.nodeValue = 'Enregistrer';
    await tick();
    expect(btn.textContent).toBe('حفظ');

    setLang('fr');
    await tick();
    expect(btn.textContent).toBe('Enregistrer');
    expect(btn.getAttribute('title')).toBe('Fermer');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('localises currency labels in Arabic without changing user data, and restores them', async () => {
    document.body.innerHTML = '<div><span class="amount">1 260 MAD</span><span data-user-data>Model MAD 12</span><span class="dh">42 DH</span><span class="area">42 m²</span></div>';
    retranslateAll(); await tick();
    expect(document.querySelector('.amount')!.textContent).toBe('1 260 DH');
    setLang('ar'); retranslateAll(); await tick();
    expect(document.querySelector('.amount')!.textContent).toBe('\u20671 260 درهم\u2069');
    expect(document.querySelector('.dh')!.textContent).toBe('\u206742 درهم\u2069');
    expect(document.querySelector('.area')!.textContent).toBe('\u206742 م²\u2069');
    expect(document.querySelector('[data-user-data]')!.textContent).toBe('Model MAD 12');
    setLang('en'); await tick();
    expect(document.querySelector('.amount')!.textContent).toBe('1 260 MAD');
    expect(document.querySelector('.dh')!.textContent).toBe('42 MAD');
    expect(document.querySelector('.area')!.textContent).toBe('42 m²');
  });

  it('accepts a language pushed by the native Android shell', () => {
    (window as unknown as { atlasSetLanguage: (l: string) => void }).atlasSetLanguage('en');
    expect(getLang()).toBe('en');
    (window as unknown as { atlasSetLanguage: (l: string) => void }).atlasSetLanguage('xx');
    expect(getLang()).toBe('en');
  });
});
