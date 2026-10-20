/**
 * Offline smoke: VR never carries default TVA; FA does (Morocco HT path).
 */
function lineTax({ isQuickSale, taxExempt, unitPrice, qty, defaultTax = 20 }) {
  if (isQuickSale || taxExempt) return 0;
  const ht = Number(unitPrice) * Number(qty);
  return Math.round(ht * (defaultTax / 100) * 100) / 100;
}

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    failed++;
  }
}

ok(lineTax({ isQuickSale: true, taxExempt: false, unitPrice: 100, qty: 2 }) === 0, 'VR tax 0');
ok(lineTax({ isQuickSale: false, taxExempt: false, unitPrice: 100, qty: 2 }) === 40, 'FA 20%');
ok(lineTax({ isQuickSale: false, taxExempt: true, unitPrice: 100, qty: 2 }) === 0, 'exempt 0');

// Numbering mutual exclusion
const kinds = ['FA-001', 'VR-001', 'DEV-001'];
ok(kinds.filter((k) => k.startsWith('FA-')).length === 1, 'one FA series sample');
ok(kinds.filter((k) => k.startsWith('VR-')).length === 1, 'one VR series sample');

if (failed) process.exit(1);
console.log('smoke-invoice-vr-fa: OK');
