/**
 * Smoke: clientRisk must not flag when no client selected.
 * Run: node scripts/smoke-client-risk.mjs
 */
function norm(s) {
  return String(s || '').toLowerCase().trim();
}
function clientRisk(invoices, clientId, clientName) {
  const hasId = clientId !== undefined && clientId !== null && clientId !== '';
  const hasName = !!(clientName && String(clientName).trim());
  if (!hasId && !hasName) {
    return { level: 'ok', message: '', unpaid: 0, overdue: 0 };
  }
  const now = Date.now();
  let unpaid = 0;
  let overdue = 0;
  for (const inv of invoices || []) {
    if (['quote', 'devis', 'cancelled', 'remboursement'].includes(String(inv.status))) continue;
    if (hasId && Number(inv.client_id) !== Number(clientId)) continue;
    if (!hasId && hasName && norm(inv.client_name || '') !== norm(clientName || '')) continue;
    const due = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
    if (due < 0.01) continue;
    unpaid += due;
    const d = inv.due_date || inv.issue_date;
    if (d && new Date(d).getTime() < now - 86400000) overdue += due;
  }
  if (overdue > 0) return { level: 'high', message: 'overdue', unpaid, overdue };
  if (unpaid > 5000) return { level: 'watch', message: 'watch', unpaid, overdue };
  return { level: 'ok', message: '', unpaid, overdue };
}

const invoices = [
  { status: 'sent', client_id: 1, client_name: 'A', total: 1400, amount_paid: 0, due_date: '2020-01-01' },
];
const empty = clientRisk(invoices, '', '');
if (empty.level !== 'ok') {
  console.error('FAIL: empty client should be ok', empty);
  process.exit(1);
}
const high = clientRisk(invoices, 1, 'A');
if (high.level !== 'high') {
  console.error('FAIL: client 1 should be high', high);
  process.exit(1);
}
console.log('smoke-client-risk: OK');
