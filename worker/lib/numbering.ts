import type { Env } from '../env';

/**
 * Document numbering (FA / DEV / VR / ACH / REC / WR).
 * Optional Durable Object NUMBER_HUB for atomic sequences under concurrency.
 */
export async function nextDocumentNumber(
  db: D1Database,
  kind: 'invoice' | 'quote' | 'bill' | 'receipt' | 'credit_note' | 'quick_sale',
  settings: any,
  env?: Env,
): Promise<string> {
  const defaultPrefixes: Record<string, string> = {
    invoice: 'FA-',
    quote: 'DEV-',
    bill: 'ACH-',
    receipt: 'REC-',
    credit_note: 'WR-',
    quick_sale: 'VR-',
  };
  const prefixMap: Record<string, string> = {
    invoice: settings?.invoice_prefix || defaultPrefixes.invoice,
    quote: settings?.quote_prefix || defaultPrefixes.quote,
    bill: settings?.bill_prefix || defaultPrefixes.bill,
    receipt: settings?.receipt_prefix || defaultPrefixes.receipt,
    credit_note: settings?.credit_prefix || defaultPrefixes.credit_note,
    quick_sale: settings?.quick_sale_prefix || defaultPrefixes.quick_sale,
  };
  const counterMap: Record<string, string> = {
    invoice: 'next_invoice_number',
    quote: 'next_quote_number',
    bill: 'next_bill_number',
    receipt: 'next_receipt_number',
    credit_note: 'next_credit_number',
    quick_sale: 'next_quick_sale_number',
  };
  const tableMap: Record<string, string> = {
    invoice: 'invoices',
    quote: 'invoices',
    bill: 'bills',
    receipt: 'receipts',
    credit_note: 'invoices',
    quick_sale: 'invoices',
  };
  const style = String(settings?.numbering_style || 'prefix_year').trim();
  const year = new Date().getFullYear();
  const pad = Math.max(3, Math.min(6, Number(settings?.numbering_pad || 4)));
  let prefix = String(prefixMap[kind] || '').trim();
  // Ensure prefix ends cleanly for styles that append year
  if (prefix && !/[-\/]$/.test(prefix) && (style === 'prefix_year' || style === 'prefix_year_slash' || style === 'prefix_pad5')) {
    // keep as-is; user controls trailing dash/slash
  }
  const counterCol = counterMap[kind];
  let counter = Number(settings?.[counterCol] || 1);
  if (!counter || counter < 1) counter = 1;

  // Align with highest existing number for this series (avoids duplicates after imports)
  try {
    const table = tableMap[kind];
    const likePattern =
      style === 'year_seq' || style === 'year_slash'
        ? `${year}%`
        : prefix
          ? prefix + '%'
          : '%';
    const { results } = await db.prepare(`SELECT number FROM ${table} WHERE number LIKE ?`).bind(likePattern).all();
    let maxFound = 0;
    for (const row of (results || []) as any[]) {
      const n = String(row.number || '');
      // Extract trailing numeric sequence
      const m = n.match(/(\d+)\s*$/);
      if (!m) continue;
      // For year styles, only consider current year numbers
      if ((style === 'year_seq' || style === 'year_slash' || style === 'prefix_year' || style === 'prefix_year_slash') && !n.includes(String(year))) {
        continue;
      }
      const v = parseInt(m[1], 10);
      if (!isNaN(v) && v > maxFound) maxFound = v;
    }
    if (maxFound >= counter) counter = maxFound + 1;
  } catch { /* ignore */ }

  // Atomic sequence via Durable Object (safe under concurrent creates)
  const numberHub = env && (env as Env).NUMBER_HUB;
  if (numberHub) {
    try {
      const series = `${kind}:${year}`;
      const id = numberHub.idFromName('doc-numbers');
      const stub = numberHub.get(id);
      const res = await stub.fetch('https://number-hub/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series, floor: counter }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const n = Number(j?.data?.next);
        if (n > 0) counter = n;
      }
    } catch (e) {
      console.log('NUMBER_HUB allocate fail', e);
    }
  }

  const formatNum = (c: number) => {
    const seq = String(c).padStart(pad, '0');
    switch (style) {
      case 'year_seq':
        return `${year}-${seq}`;
      case 'year_slash':
        return `${year}/${seq}`;
      case 'prefix_year_slash':
        return `${prefix.replace(/[-\/]+$/, '')}/${year}/${seq}`;
      case 'prefix_pad5':
        return `${prefix}${String(c).padStart(5, '0')}`;
      case 'prefix_year':
      default:
        return `${prefix.replace(/[-\/]+$/, '')}-${year}-${seq}`;
    }
  };

  // Uniqueness loop (Phase 0) — never return a number already in the table
  const table = tableMap[kind];
  let number = formatNum(counter);
  for (let attempt = 0; attempt < 25; attempt++) {
    const clash = await db.prepare(`SELECT id FROM ${table} WHERE number = ? LIMIT 1`).bind(number).first();
    if (!clash) break;
    counter += 1;
    number = formatNum(counter);
  }

  // Bump counter in settings past the number we issued
  try {
    const next = counter + 1;
    if (kind === 'quote') {
      await db.prepare(`UPDATE company_settings SET next_quote_number = ? WHERE id = 1`).bind(next).run();
    } else if (kind === 'bill') {
      try {
        await db.prepare(`UPDATE company_settings SET next_bill_number = ? WHERE id = 1`).bind(next).run();
      } catch { /* */ }
    } else if (kind === 'receipt') {
      await db.prepare(`UPDATE company_settings SET next_receipt_number = ? WHERE id = 1`).bind(next).run();
    } else if (kind === 'credit_note') {
      try {
        await db.prepare(`UPDATE company_settings SET next_credit_number = ? WHERE id = 1`).bind(next).run();
      } catch { /* */ }
    } else if (kind === 'quick_sale') {
      try {
        await db.prepare(`UPDATE company_settings SET next_quick_sale_number = ? WHERE id = 1`).bind(next).run();
      } catch { /* */ }
    } else {
      await db.prepare(`UPDATE company_settings SET next_invoice_number = ? WHERE id = 1`).bind(next).run();
    }
  } catch { /* ignore */ }

  return number;
}

