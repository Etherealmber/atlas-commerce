/**
 * i18n entry: registers the English / Arabic dictionaries and boots the
 * native bridge + DOM translator. Import once from main.tsx.
 */
import { installLanguageBridge, registerDict, type Dict } from './core';
import { installDomTranslator } from './dom';
import { MESSAGES } from './messages';

export * from './core';
export { retranslateAll } from './dom';

export function buildDicts() {
  const en: Dict = {};
  const ar: Dict = {};
  for (const [fr, e, a] of MESSAGES) {
    const key = fr.replace(/\s+/g, ' ').trim();
    if (e) en[key] = e;
    if (a) ar[key] = a;
  }
  return { en, ar };
}

let booted = false;
export function installI18n() {
  if (booted) return;
  booted = true;
  const { en, ar } = buildDicts();
  registerDict('en', en);
  registerDict('ar', ar);
  installLanguageBridge();
  installDomTranslator();
}
