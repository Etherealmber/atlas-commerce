/**
 * DOM translation layer: translates the French UI already rendered by React
 * (text nodes + placeholder / title / aria-label / alt / data-tooltip) into the
 * current language, keeps it translated as React updates the page, and restores
 * the French originals when switching back.
 *
 * Opt-out: `translate="no"`, `.notranslate`, `[data-no-i18n]` (user data such
 * as product names can use it), and code / inputs / editable content.
 * Native `alert` / `confirm` / `prompt` messages and `document.title` are
 * translated too, so errors are covered wherever they surface.
 */
import { getLang, LANG_EVENT, translate, type Lang } from './core';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip', 'aria-description'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH']);

type TextState = { src: string; out: string };
const textState = new WeakMap<Text, TextState>();
const attrState = new WeakMap<Element, Record<string, TextState>>();

/** Spots that render user data (product / customer / employee names, document
 *  numbers). A product literally called « Stock » must stay « Stock ». */
const USER_DATA_SELECTOR = [
  '[data-user-data]', '.pc-name', '.hl-pname', '.ia-name', '.ph-employee-name', '.wn-contributor-name',
  '.ac-number-link', '.ac-dash-hello b', '.cell-product', '.cell-client', '.client-name', '.product-name',
].join(',');

let observer: MutationObserver | null = null;
let applying = false;
const pending = new Set<Node>();
let scheduled = false;

function skipped(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (SKIP_TAGS.has(n.tagName.toUpperCase())) return true;
    if (n.getAttribute('translate') === 'no' || n.hasAttribute('data-no-i18n')) return true;
    if (n.classList?.contains('notranslate')) return true;
    if (n.matches?.(USER_DATA_SELECTOR)) return true;
    if ((n as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function hasLetters(s: string) {
  return /[A-Za-zÀ-ÿ]/.test(s);
}

/** Localise currency labels in presentation text only; API values stay ISO MAD. */
function translateDisplay(src: string, lang: Lang) {
  const out = translate(src, lang).replace(/CDN1/g, 'Atlas API');
  if (lang === 'ar') {
    const units: Record<string, string> = { 'm²': 'م²', 'm³': 'م³', kg: 'كغ', g: 'غ', L: 'لتر', mL: 'مل', m: 'م', cm: 'سم', u: 'وحدة', pce: 'قطعة', bte: 'علبة', ctn: 'كرتون', paq: 'عبوة', j: 'يوم' };
    return out.replace(/\b(?:MAD|DH)\b/g, 'درهم').replace(/\bm²/g, 'م²').replace(/\bm³/g, 'م³')
      .replace(/\bWindows\b/g, 'ويندوز').replace(/\bmacOS\b/gi, 'ماك أو إس').replace(/\bLinux\b/g, 'لينكس').replace(/\bAndroid\b/g, 'أندرويد')
      .replace(/(\d)\s*(m²|m³|mL|kg|cm|pce|bte|ctn|paq|g|L|m|u|j)(?![A-Za-zÀ-ÿ0-9])/g, (_, digit: string, unit: string) => `${digit} ${units[unit]}`)
      .replace(/([-+]?\d[\d\u00a0\u202f ,.]*\d(?:[–-]\d+)?|[-+]?\d)\s*(درهم|م²|م³|كغ|غ|لتر|مل|م|سم|وحدة|قطعة|علبة|كرتون|عبوة|يوم)(?![\u0621-\u064a])/g, '\u2067$1 $2\u2069');
  }
  if (lang === 'en') return out.replace(/\bDH\b/g, 'MAD');
  return out.replace(/\bMAD\b/g, 'DH');
}

function translateText(node: Text, lang: Lang) {
  const value = node.nodeValue ?? '';
  const st = textState.get(node);
  // React (or the app) wrote new text since our last pass → it is the new source.
  const src = st && value === st.out ? st.src : value;
  if (!hasLetters(src)) return;
  if (node.parentElement && (node.parentElement.tagName === 'TEXTAREA' || skipped(node.parentElement))) return;
  const out = translateDisplay(src, lang);
  textState.set(node, { src, out });
  if (out !== value) node.nodeValue = out;
}

function translateAttrs(el: Element, lang: Lang) {
  let states = attrState.get(el);
  for (const a of ATTRS) {
    const value = el.getAttribute(a);
    if (value == null) continue;
    const st = states?.[a];
    const src = st && value === st.out ? st.src : value;
    if (!hasLetters(src)) continue;
    const out = translateDisplay(src, lang);
    if (!states) { states = {}; attrState.set(el, states); }
    states[a] = { src, out };
    if (out !== value) el.setAttribute(a, out);
  }
  // Button-like inputs show their value.
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit' || el.type === 'reset') && el.value) {
    const st = states?.value;
    const src = st && el.value === st.out ? st.src : el.value;
    const out = translateDisplay(src, lang);
    if (!states) { states = {}; attrState.set(el, states); }
    states.value = { src, out };
    if (out !== el.value) el.value = out;
  }
}

function walk(root: Node, lang: Lang) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text, lang);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (skipped(el)) return;
    translateAttrs(el, lang);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.getAttribute('translate') === 'no' || el.hasAttribute('data-no-i18n') || el.classList.contains('notranslate')) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = tw.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text, lang);
    else translateAttrs(n as Element, lang);
    n = tw.nextNode();
  }
}

function flush() {
  scheduled = false;
  const lang = getLang();
  const nodes = [...pending];
  pending.clear();
  applying = true;
  try {
    for (const n of nodes) if (n.isConnected) walk(n, lang);
    translateTitle(lang);
  } finally {
    // Drop the records produced by our own writes.
    observer?.takeRecords();
    applying = false;
  }
}

function schedule(n: Node) {
  pending.add(n);
  if (scheduled) return;
  scheduled = true;
  // Microtask: translate before the browser paints the French text.
  queueMicrotask(flush);
}

let titleSrc = '';
let titleOut = '';
function translateTitle(lang: Lang) {
  const cur = document.title;
  const src = cur === titleOut && titleSrc ? titleSrc : cur;
  titleSrc = src;
  titleOut = translateDisplay(src, lang);
  if (titleOut !== cur) document.title = titleOut;
}

function patchDialogs() {
  const w = window as unknown as { __atlasDialogsPatched?: boolean };
  if (w.__atlasDialogsPatched) return;
  w.__atlasDialogsPatched = true;
  const tr = (m: unknown) => (typeof m === 'string' && getLang() !== 'fr' ? translate(m) : m);
  const { alert, confirm, prompt } = window;
  window.alert = (m?: unknown) => alert.call(window, tr(m) as string);
  window.confirm = (m?: string) => confirm.call(window, tr(m) as string);
  window.prompt = (m?: string, d?: string) => prompt.call(window, tr(m) as string, d);
}

/** Retranslate everything now (after a language change). */
export function retranslateAll() {
  if (typeof document === 'undefined' || !document.body) return;
  schedule(document.body);
}

export function installDomTranslator() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || observer) return;
  patchDialogs();
  observer = new MutationObserver((records) => {
    if (applying) return;
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => schedule(n));
      else schedule(r.target);
    }
  });
  const start = () => {
    observer!.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS, 'value'],
    });
    retranslateAll();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener(LANG_EVENT, () => retranslateAll());
}
