/**
 * Smoke: VR vs FA numbering prefixes and payload shape (no network).
 * Run: node scripts/smoke-invoice-kinds.mjs
 */
function isQuickSaleBody(body) {
  return !!(body.quick_sale === true || body.doc_kind === 'quick_sale' || body.doc_kind === 'ticket');
}
function expectedKind(body) {
  if (body.status === 'quote' || body.status === 'devis') return 'quote';
  if (isQuickSaleBody(body)) return 'quick_sale';
  return 'invoice';
}
function expectedPrefix(kind) {
  return { quote: 'DEV-', quick_sale: 'VR-', invoice: 'FA-' }[kind];
}

const cases = [
  [{ status: 'sent', items: [{ name: 'x', quantity: 1, unit_price: 10 }], client_name: 'A' }, 'invoice', 'FA-'],
  [{ status: 'sent', quick_sale: true, items: [{ name: 'x', quantity: 1, unit_price: 10 }], client_name: 'A' }, 'quick_sale', 'VR-'],
  [{ status: 'quote', items: [{ name: 'x', quantity: 1, unit_price: 10 }], client_name: 'A' }, 'quote', 'DEV-'],
  [{ doc_kind: 'ticket', status: 'sent', items: [{ name: 'x', quantity: 1, unit_price: 10 }], client_name: 'A' }, 'quick_sale', 'VR-'],
];

let failed = 0;
for (const [body, kind, prefix] of cases) {
  const k = expectedKind(body);
  const p = expectedPrefix(k);
  if (k !== kind || p !== prefix) {
    console.error('FAIL', body, 'got', k, p, 'want', kind, prefix);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('smoke-invoice-kinds: OK');
