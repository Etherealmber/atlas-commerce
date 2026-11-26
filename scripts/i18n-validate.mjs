#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function validateCatalogs(texts, pending = []) {
  const errors = [];
  const catalogs = {};
  for (const [lang, text] of Object.entries(texts)) {
    let obj;
    try { obj = JSON.parse(text); } catch { errors.push(`${lang}: invalid JSON`); continue; }
    if (!obj || Array.isArray(obj) || typeof obj !== 'object') { errors.push(`${lang}: expected an object`); continue; }
    catalogs[lang] = obj;
    // JSON.parse silently accepts duplicate keys, so inspect the parsed syntax too.
    const tree = ts.parseJsonText(`${lang}.json`, text);
    const root = tree.statements[0]?.expression;
    if (root && ts.isObjectLiteralExpression(root)) {
      const seen = new Set();
      for (const property of root.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        const key = property.name.text;
        if (seen.has(key)) errors.push(`${lang}: duplicate key ${JSON.stringify(key)}`);
        seen.add(key);
      }
    }
  }
  const source = catalogs.fr;
  if (!source) return errors;
  if (!Array.isArray(pending) || pending.some(key => typeof key !== 'string') || new Set(pending).size !== pending.length) return [...errors, 'pending: expected unique string keys'];
  for (const key of pending) if (!Object.hasOwn(source, key)) errors.push(`pending: unknown key ${JSON.stringify(key)}`);
  const placeholders = s => (s.match(/\{[a-z]+\}/g) || []).sort().join('|');
  for (const [key, value] of Object.entries(source)) {
    if (key !== key.replace(/\s+/g, ' ').trim() || value !== key) errors.push(`fr: source key/value mismatch ${JSON.stringify(key)}`);
    for (const lang of ['en', 'ar']) {
      if (!catalogs[lang]) continue;
      const translation = catalogs[lang][key];
      if (translation === undefined && pending.includes(key)) continue;
      if (typeof translation !== 'string' || !translation.trim()) errors.push(`${lang}: missing translation ${JSON.stringify(key)}`);
      else if (placeholders(key) !== placeholders(translation)) errors.push(`${lang}: placeholder mismatch ${JSON.stringify(key)}`);
    }
  }
  for (const lang of ['en', 'ar']) if (catalogs[lang]) {
    for (const key of Object.keys(catalogs[lang])) if (!Object.hasOwn(source, key)) errors.push(`${lang}: unknown key ${JSON.stringify(key)}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const texts = Object.fromEntries(['fr', 'en', 'ar'].map(lang => [lang, readFileSync(`src/i18n/catalogs/${lang}.json`, 'utf8')]));
  const pending = JSON.parse(readFileSync('src/i18n/catalogs/pending.json', 'utf8'));
  const errors = validateCatalogs(texts, pending);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Catalog structure valid: ${Object.keys(JSON.parse(texts.fr)).length} source entries; ${pending.length} explicitly pending source keys may lack targets. This is not UI coverage or quality.`);
}
