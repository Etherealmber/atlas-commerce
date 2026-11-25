/**
 * Atlas i18n core — French is the source language; English and Arabic (RTL)
 * are dictionaries keyed by the French text.
 *
 *  - `t('Enregistrer')` / `t('{n} factures', …)` for code that formats strings;
 *  - the DOM layer (./dom.ts) translates already-rendered French UI, so every
 *    page, toast and error is covered as soon as its text is in a dictionary;
 *  - `<html lang dir>` follows the language (RTL for Arabic);
 *  - native Android link: the WebView can push a language with
 *    `window.atlasSetLanguage('ar')` (or ?lang=ar / postMessage), and every
 *    change made in the web UI is reported to `window.AtlasAndroid.setLanguage(lang)`.
 */
import { useSyncExternalStore } from 'react';

export type Lang = 'fr' | 'en' | 'ar';
export const LANGS: { code: Lang; native: string; english: string; dir: 'ltr' | 'rtl'; locale: string }[] = [
  { code: 'fr', native: 'Français', english: 'French', dir: 'ltr', locale: 'fr-FR' },
  { code: 'ar', native: 'العربية', english: 'Arabic', dir: 'rtl', locale: 'ar-MA' },
  { code: 'en', native: 'English', english: 'English', dir: 'ltr', locale: 'en-GB' },
];
export const LANG_STORAGE_KEY = 'atlas_lang';
export const LANG_EVENT = 'atlas-language';

export type Dict = Record<string, string>;
const dicts: Partial<Record<Lang, Dict>> = {};
const patternCache: Partial<Record<Lang, { re: RegExp; out: string; keys: string[] }[]>> = {};

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en' || v === 'ar';
}

type NativeBridge = { setLanguage?: (lang: string) => void; getLanguage?: () => string };
function nativeBridge(): NativeBridge | null {
  try {
    const w = window as unknown as { AtlasAndroid?: NativeBridge };
    return w.AtlasAndroid && typeof w.AtlasAndroid === 'object' ? w.AtlasAndroid : null;
  } catch {
    return null;
  }
}

function initialLang(): Lang {
  if (typeof window === 'undefined') return 'fr';
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (isLang(q)) return q;
  } catch { /* */ }
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* */ }
  try {
    const native = nativeBridge()?.getLanguage?.();
    if (isLang(native)) return native;
  } catch { /* */ }
  return 'fr';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}
export function langMeta(lang: Lang = current) {
  return LANGS.find((l) => l.code === lang) || LANGS[0];
}
export function isRtl(lang: Lang = current): boolean {
  return langMeta(lang).dir === 'rtl';
}

export function applyDocumentLang(lang: Lang = current) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = langMeta(lang).dir;
  root.dataset.lang = lang;
}

export type LangSource = 'user' | 'native' | 'url' | 'storage';

/** Change the interface language (persists, flips `dir`, informs Android). */
export function setLang(lang: Lang, source: LangSource = 'user') {
  if (!isLang(lang)) return;
  const changed = lang !== current;
  current = lang;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* */ }
  applyDocumentLang(lang);
  if (source !== 'native') {
    try { nativeBridge()?.setLanguage?.(lang); } catch { /* */ }
  }
  if (changed) {
    listeners.forEach((fn) => fn());
    try { window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: { lang, source } })); } catch { /* */ }
  }
}

export function subscribeLang(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** React hook: re-renders on language change. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => 'fr' as Lang);
}

export function registerDict(lang: Lang, dict: Dict) {
  dicts[lang] = { ...dicts[lang], ...dict };
  delete patternCache[lang];
  delete memo[lang];
}

const NUM_RE = /[-+]?\d[\d\u202f\u00a0 .,]*\d%?|[-+]?\d%?/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternsFor(lang: Lang) {
  const cached = patternCache[lang];
  if (cached) return cached;
  const out: { re: RegExp; out: string; keys: string[] }[] = [];
  for (const [src, dst] of Object.entries(dicts[lang] || {})) {
    if (!/\{[a-z]+\}/.test(src) || /^\{n\}$/.test(src)) continue;
    const keys: string[] = [];
    const body = src.split(/(\{[a-z]+\})/).map((part) => {
      const m = part.match(/^\{([a-z]+)\}$/);
      if (!m) return escapeRe(part);
      keys.push(m[1]);
      return m[1] === 'n' ? '([-+]?\\d[\\d\\u202f\\u00a0 .,]*\\d%?|[-+]?\\d%?)' : '(.+?)';
    }).join('');
    out.push({ re: new RegExp(`^${body}$`), out: dst, keys });
  }
  patternCache[lang] = out;
  return out;
}

const fill = (tpl: string, vars?: Record<string, string | number>) =>
  vars ? tpl.replace(/\{([a-z]+)\}/gi, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : tpl;

/**
 * Translate a French UI string into `lang` (default: current). Returns the
 * input unchanged when no translation exists, so French always works.
 */
const memo: Partial<Record<Lang, Map<string, string>>> = {};

export function translate(text: string, lang: Lang = current): string {
  if (lang === 'fr' || !text) return text;
  const dict = dicts[lang];
  if (!dict) return text;
  const cache = (memo[lang] ||= new Map());
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const out = translateUncached(text, lang, dict);
  if (cache.size > 6000) cache.clear();
  cache.set(text, out);
  return out;
}

function translateUncached(text: string, lang: Lang, dict: Dict): string {
  const lead = text.match(/^\s*/)?.[0] || '';
  const trail = text.match(/\s*$/)?.[0] || '';
  const core = text.trim().replace(/\s+/g, ' ');
  if (!core) return text;
  const hit = dict[core] ?? dict[core.replace(/[’]/g, "'")] ?? dict[core.replace(/'/g, '’')];
  if (hit !== undefined) return lead + hit + trail;
  // Numbers → {n}: « 12 factures · 20 par page » matches « {n} factures · {n} par page ».
  const nums = core.match(NUM_RE);
  if (nums) {
    const key = core.replace(NUM_RE, '{n}');
    const tpl = dict[key];
    if (tpl !== undefined) {
      let i = 0;
      return lead + tpl.replace(/\{n\}/g, () => nums[i++] ?? '') + trail;
    }
  }
  for (const p of patternsFor(lang)) {
    const m = core.match(p.re);
    if (!m) continue;
    // Each placeholder name keeps a queue of captured values (several {n} allowed).
    const queues: Record<string, string[]> = {};
    p.keys.forEach((k, i) => {
      const v = m[i + 1];
      (queues[k] ||= []).push(k === 'n' ? v : translate(v, lang));
    });
    return lead + p.out.replace(/\{([a-z]+)\}/g, (_, k: string) => queues[k]?.shift() ?? '') + trail;
  }
  return text;
}

/** `t('Bonjour, {name}.', { name })` — French source → current language. */
export function t(fr: string, vars?: Record<string, string | number>): string {
  if (current === 'fr') return fill(fr, vars);
  const key = fr.trim();
  const dict = dicts[current];
  const tpl = dict?.[key];
  if (tpl !== undefined) return fill(tpl, vars);
  return translate(fill(fr, vars));
}

/** Locale for Intl formatting (numbers stay Latin digits in Arabic, as in Morocco). */
export function intlLocale(lang: Lang = current): string {
  return lang === 'ar' ? 'ar-MA-u-nu-latn' : langMeta(lang).locale;
}

/** Wire native/URL inputs once at boot. */
export function installLanguageBridge() {
  if (typeof window === 'undefined') return;
  applyDocumentLang(current);
  const w = window as unknown as { atlasSetLanguage?: (l: string) => void; atlasGetLanguage?: () => Lang };
  w.atlasSetLanguage = (l: string) => { if (isLang(l)) setLang(l, 'native'); };
  w.atlasGetLanguage = () => current;
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; lang?: string } | null;
    if (d && d.type === 'atlas:set-language' && isLang(d.lang)) {
      if (e.origin && e.origin !== 'null' && e.origin !== window.location.origin) return;
      setLang(d.lang, 'native');
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === LANG_STORAGE_KEY && isLang(e.newValue) && e.newValue !== current) setLang(e.newValue, 'storage');
  });
  // Tell the native shell which language the web app booted with.
  try { nativeBridge()?.setLanguage?.(current); } catch { /* */ }
}
