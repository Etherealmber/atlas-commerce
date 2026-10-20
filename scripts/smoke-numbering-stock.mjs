/**
 * Offline smoke: FA/VR/DEV prefixes, EMP pad, stock movement sign.
 * Run: node scripts/smoke-numbering-stock.mjs
 */

function docKind(body) {
  if (body.status === 'quote' || body.status === 'devis') return 'quote';
  if (body.quick_sale === true || body.doc_kind === 'quick_sale' || body.doc_kind === 'ticket') return 'quick_sale';
  return 'invoice';
}
function prefix(kind) {
  return { quote: 'DEV-', quick_sale: 'VR-', invoice: 'FA-' }[kind];
}
function formatEmp(n, pad = 4, pfx = 'EMP-') {
  return `${pfx}${String(Math.max(1, n)).padStart(pad, '0')}`;
}
/** Stock delta for movement type */
function stockDelta(type, qty) {
  const q = Math.abs(Number(qty) || 0);
  if (type === 'in' || type === 'receive' || type === 'purchase') return q;
  if (type === 'out' || type === 'sale' || type === 'damage') return -q;
  if (type === 'adjust') return Number(qty) || 0;
  return 0;
}

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    failed++;
  }
}

ok(prefix(docKind({ status: 'sent' })) === 'FA-', 'FA default');
ok(prefix(docKind({ status: 'sent', quick_sale: true })) === 'VR-', 'VR quick_sale');
ok(prefix(docKind({ status: 'quote' })) === 'DEV-', 'DEV quote');
ok(formatEmp(1) === 'EMP-0001', 'EMP pad');
ok(formatEmp(42, 4) === 'EMP-0042', 'EMP 42');
ok(stockDelta('sale', 3) === -3, 'sale outbound');
ok(stockDelta('receive', 5) === 5, 'receive inbound');
ok(stockDelta('adjust', -2) === -2, 'adjust signed');

// Circuit breaker pure logic mirror
const fails = { n: 0, open: false };
function cbFail(th = 5) {
  fails.n++;
  if (fails.n >= th) fails.open = true;
}
function cbOk() {
  fails.n = 0;
  fails.open = false;
}
for (let i = 0; i < 5; i++) cbFail();
ok(fails.open === true, 'circuit opens after threshold');
cbOk();
ok(fails.open === false, 'circuit closes on success');

if (failed) {
  console.error(`smoke-numbering-stock: ${failed} failure(s)`);
  process.exit(1);
}
console.log('smoke-numbering-stock: OK');
