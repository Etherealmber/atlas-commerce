#!/usr/bin/env node
/** Advisory AST audit for Atlas's French-source DOM dictionary. No coverage claims. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const attrs = new Set(['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'data-tooltip', 'label', 'helperText']);
const directAttrs = new Set(['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'data-tooltip']);
const sinks = new Set(['toast', 'flash', 'setError', 'setMsg', 'setModalError', 'alert', 'confirm', 'setSaveMsg']);
const ignoredTags = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
const normal = (s) => s.replace(/\s+/g, ' ').trim();
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[m]);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function readKeys(source) {
  const file = ts.createSourceFile('messages.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  function visit(node) {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 3 && node.elements.every(ts.isStringLiteral)) keys.add(normal(node.elements[0].text));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return keys;
}

function patterns(keys) {
  return [...keys].filter(k => /\{[a-z]+\}/.test(k)).map(k => new RegExp('^' + k.split(/(\{[a-z]+\})/).map(part => /^\{[a-z]+\}$/.test(part) ? (part === '{n}' ? '[-+−]?[\\d\\s.,%]+' : '.+?') : escape(part)).join('') + '$'));
}

export function scanText(source, filename, keys) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const results = [];
  const templates = patterns(keys);
  function add(value, node, kind, excluded, explicit) {
    const text = normal(decode(value));
    if (excluded || text.length < 2 || !/\p{L}{2}/u.test(text) || /^(?:[A-Z0-9 ._/-]+|https?:\/\/\S+)$/.test(text)) return;
    const known = keys.has(text) || keys.has(text.replaceAll('’', "'")) || keys.has(text.replaceAll("'", '’')) || templates.some(p => p.test(text));
    if (known && !explicit) return;
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
    results.push({ file: filename, line: line + 1, column: character + 1, kind: explicit ? 'explicit-required' : kind, text, catalogMatch: known });
  }
  function attributes(node) {
    const props = node.attributes?.properties || [];
    const tag = node.tagName?.getText(file)?.toLowerCase();
    let skip = ignoredTags.has(tag);
    for (const p of props) if (ts.isJsxAttribute(p)) {
      const name = p.name.getText(file);
      if (name === 'data-user-data' || name === 'data-no-i18n' || (name === 'translate' && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === 'no') || (name === 'className' && p.initializer && ts.isStringLiteral(p.initializer) && /(?:^|\s)notranslate(?:\s|$)/.test(p.initializer.text))) skip = true;
    }
    return { skip, svg: tag === 'svg', props };
  }
  function expression(node, kind, excluded, explicit) {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node, kind, excluded, explicit);
    else if (ts.isConditionalExpression(node)) { expression(node.whenTrue, kind, excluded, explicit); expression(node.whenFalse, kind, excluded, explicit); }
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) expression(node.right, kind, excluded, explicit);
    else if (ts.isParenthesizedExpression(node)) expression(node.expression, kind, excluded, explicit);
  }
  function visit(node, excluded = false, explicit = false) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const info = attributes(opening); excluded ||= info.skip; explicit ||= info.svg;
      for (const prop of info.props) if (ts.isJsxAttribute(prop) && attrs.has(prop.name.getText(file))) {
        const name = prop.name.getText(file);
        const value = prop.initializer;
        if (value && ts.isStringLiteral(value)) add(value.text, value, directAttrs.has(name) ? 'attribute' : 'component-prop', excluded, explicit);
        else if (value && ts.isJsxExpression(value)) expression(value.expression, directAttrs.has(name) ? 'attribute' : 'component-prop', excluded, explicit);
      }
      if (ts.isJsxElement(node)) for (const child of node.children) visit(child, excluded, explicit);
      return;
    }
    if (ts.isJsxText(node)) add(node.text, node, 'jsx-text', excluded, explicit);
    else if (ts.isJsxExpression(node)) {
      expression(node.expression, 'jsx-expression', excluded, explicit);
      if (node.expression) ts.forEachChild(node.expression, child => visit(child, excluded, explicit));
      return;
    } else if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
      if (sinks.has(name) && node.arguments[0]) expression(node.arguments[0], 'message-call', excluded, explicit);
    }
    ts.forEachChild(node, child => visit(child, excluded, explicit));
  }
  visit(file);
  return results;
}

function main() {
  const keys = readKeys(readFileSync('src/i18n/messages.ts', 'utf8'));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { encoding: 'utf8' }).trim().split('\n').filter(f => /\.(tsx|ts)$/.test(f) && !f.includes('__tests__') && !f.startsWith('src/i18n/'));
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const fileFilter = fileIndex < 0 ? '' : (args[fileIndex + 1] || '');
  const findings = files.filter(f => f.includes(fileFilter)).flatMap(f => scanText(readFileSync(f, 'utf8'), f, keys));
  const index = args.indexOf('--limit');
  const limit = index < 0 ? 150 : Math.max(0, Number(args[index + 1]) || 0);
  if (args.includes('--json')) console.log(JSON.stringify({ catalogKeys: keys.size, totalCandidates: findings.length, findings }, null, 2));
  else {
    console.log(`${keys.size} catalog keys · ${findings.length} AST candidates (not coverage; review each finding)`);
    console.log('explicit-required: DOM translation skips SVG; component-prop: may not render as text. Dynamic values, templates and unvisited pages require runtime review.\n');
    for (const r of findings.slice(0, limit)) console.log(`${r.file}:${r.line}:${r.column} [${r.kind}${r.catalogMatch ? ', catalog match' : ''}] ${r.text}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
