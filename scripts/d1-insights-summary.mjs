// Read Wrangler's aggregated query insights without publishing raw SQL or values.
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(rows)) throw new Error('Unexpected D1 insights format');
const table = (query) => {
  const text = String(query || '').trim();
  const match = /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|SELECT[\s\S]*?\s+FROM)\s+[`"\[]?([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(text);
  return match ? `${text.split(/\s+/)[0].toUpperCase()} ${match[1].toLowerCase()}` : 'other';
};
console.log('operation/table\truns\trows_written\trows_read\ttotal_ms');
for (const r of rows) {
  const num = (v) => Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0;
  console.log([table(r.query), num(r.numberOfTimesRun), num(r.totalRowsWritten), num(r.totalRowsRead), num(r.totalDurationMs ?? r.totalTimeMs)].join('\t'));
}
