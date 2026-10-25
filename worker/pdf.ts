/**
 * Lightweight PDF generator for Cloudflare Workers (no native deps).
 * Produces valid PDF 1.4 with Helvetica — suitable for invoices / receipts.
 * For richer HTML→PDF later: Cloudflare Browser Rendering or pdf-lib.
 */

type RGB = [number, number, number];

function esc(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E\u00C0-\u024F]/g, (ch) => {
      // Keep Latin-1 range for French accents via WinAnsi-ish approximation in comments;
      // Helvetica standard encoding is limited — map common FR chars to ASCII fallbacks for reliability.
      const map: Record<string, string> = {
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'à': 'a', 'â': 'a', 'ä': 'a',
        'ù': 'u', 'û': 'u', 'ü': 'u',
        'ô': 'o', 'ö': 'o',
        'î': 'i', 'ï': 'i',
        'ç': 'c',
        'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
        'À': 'A', 'Â': 'A', 'Ä': 'A',
        'Ù': 'U', 'Û': 'U', 'Ü': 'U',
        'Ô': 'O', 'Ö': 'O',
        'Î': 'I', 'Ï': 'I',
        'Ç': 'C',
        '·': '-', '—': '-', '–': '-',
        '€': 'EUR', '°': 'o',
      };
      return map[ch] || '?';
    });
}

function fmtMoney(n: number): string {
  return Math.round(Number(n || 0)).toLocaleString("fr-FR");
}

export type PdfDocInput = {
  title: string; // FACTURE | DEVIS | RECU
  number: string;
  issueDate: string;
  dueDate?: string;
  company: {
    name: string;
    address?: string;
    city?: string;
    phone?: string;
    email?: string;
    ice?: string;
    if_number?: string;
    rc?: string;
    patente?: string;
    cnss?: string;
    legal_form?: string;
    bank_name?: string;
    bank_iban?: string;
  };
  party: {
    label: string; // Client | Fournisseur
    name: string;
    ice?: string;
    address?: string;
    city?: string;
    email?: string;
    phone?: string;
  };
  items: { name: string; qty: number; unit: number; taxRate: number; total: number; listPrice?: number; discount?: number }[];
  subtotal: number;
  /** Total promo / remise (positive number shown as negative line) */
  discountTotal?: number;
  taxAmount: number;
  total: number;
  amountPaid?: number;
  currency?: string;
  notes?: string;
  refundPolicy?: string;
  status?: string;
};

/** Build a simple single-page A4 PDF (bytes). */
export function buildInvoicePdf(input: PdfDocInput): Uint8Array {
  const cur = input.currency || 'MAD';
  const paid = Number(input.amountPaid || 0);
  const due = Math.max(0, Number(input.total || 0) - paid);
  const W = 595; // A4 points
  const H = 842;
  const margin = 40;
  const lines: string[] = [];
  let y = H - margin;

  const push = (cmd: string) => lines.push(cmd);
  const text = (str: string, x: number, yy: number, size = 10) => {
    push(`BT /F1 ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(str)}) Tj ET`);
  };
  const bold = (str: string, x: number, yy: number, size = 10) => {
    push(`BT /F2 ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(str)}) Tj ET`);
  };
  const hline = (x1: number, x2: number, yy: number) => {
    push(`${x1} ${yy} m ${x2} ${yy} l S`);
  };

  // Header company
  bold(input.company.name || 'Societe', margin, y, 14);
  y -= 14;
  const coBits = [
    input.company.address,
    input.company.city,
    input.company.phone,
    input.company.email,
  ].filter(Boolean).join(' | ');
  if (coBits) { text(coBits, margin, y, 8); y -= 11; }
  const idBits = [
    input.company.ice ? `ICE: ${input.company.ice}` : '',
    input.company.if_number ? `IF: ${input.company.if_number}` : '',
    input.company.rc ? `RC: ${input.company.rc}` : '',
    input.company.patente ? `TP: ${input.company.patente}` : '',
    input.company.cnss ? `CNSS: ${input.company.cnss}` : '',
  ].filter(Boolean).join('  ');
  if (idBits) { text(idBits, margin, y, 8); y -= 12; }
  if (input.company.legal_form) { text(input.company.legal_form, margin, y, 8); y -= 12; }

  // Document title right
  bold(input.title, W - margin - 120, H - margin, 16);
  text(`N ${input.number}`, W - margin - 120, H - margin - 16, 10);
  text(`Date: ${input.issueDate}`, W - margin - 120, H - margin - 28, 9);
  if (input.dueDate) text(`Echeance: ${input.dueDate}`, W - margin - 120, H - margin - 40, 9);

  y -= 8;
  hline(margin, W - margin, y);
  y -= 18;

  // Party box
  bold(input.party.label, margin, y, 9);
  y -= 12;
  bold(input.party.name, margin, y, 11);
  y -= 12;
  if (input.party.ice) { text(`ICE client: ${input.party.ice}`, margin, y, 9); y -= 11; }
  if (input.party.address) { text(input.party.address, margin, y, 9); y -= 11; }
  if (input.party.city) { text(input.party.city, margin, y, 9); y -= 11; }
  if (input.party.email || input.party.phone) {
    text([input.party.email, input.party.phone].filter(Boolean).join(' | '), margin, y, 9);
    y -= 11;
  }

  // Bank
  if (input.company.bank_name || input.company.bank_iban) {
    y -= 4;
    text(
      `Banque: ${input.company.bank_name || '-'}  RIB: ${input.company.bank_iban || '-'}`,
      margin,
      y,
      8,
    );
    y -= 14;
  }

  // Status line
  if (input.title === 'FACTURE') {
    const statusLine =
      due <= 0.001
        ? `STATUT: SOLDEE (payee integralement) — Paye ${fmtMoney(paid)} ${cur}`
        : `STATUT: A REGLER — Reste du ${fmtMoney(due)} ${cur} (paye ${fmtMoney(paid)})`;
    bold(statusLine, margin, y, 9);
    y -= 16;
  } else if (input.title === 'DEVIS') {
    bold('DOCUMENT ESTIMATIF — non facture, stock non engage', margin, y, 9);
    y -= 16;
  }

  // Table header
  hline(margin, W - margin, y);
  y -= 12;
  bold('Designation', margin, y, 9);
  bold('Qte', margin + 280, y, 9);
  bold('P.U. HT', margin + 320, y, 9);
  bold('Total', margin + 440, y, 9);
  y -= 6;
  hline(margin, W - margin, y);
  y -= 14;

  for (const it of input.items || []) {
    if (y < 120) break; // keep footer space (single page simplification)
    const name = String(it.name || '').slice(0, 48);
    text(name, margin, y, 9);
    text(String(it.qty), margin + 280, y, 9);
    text(fmtMoney(it.unit), margin + 320, y, 9);
    text(fmtMoney(it.total), margin + 440, y, 9);
    y -= 13;
  }

  y -= 4;
  hline(margin, W - margin, y);
  y -= 16;

  // Totals
  const tx = W - margin - 160;
  {
    const disc = Number(input.discountTotal || 0);
    const sous = disc > 0.001 ? Number(input.subtotal || 0) + disc : Number(input.subtotal || 0);
    text(`Sous-total`, tx, y, 9); text(`${fmtMoney(sous)} ${cur}`, tx + 90, y, 9); y -= 12;
    if (disc > 0.001) {
      text(`Promo / remise`, tx, y, 9); text(`−${fmtMoney(disc)} ${cur}`, tx + 90, y, 9); y -= 12;
    }
  }
  if (Number(input.taxAmount || 0) > 0.001) { text(`TVA`, tx, y, 9); text(`${fmtMoney(input.taxAmount)} ${cur}`, tx + 90, y, 9); y -= 12; }
  bold(`Total`, tx, y, 11); bold(`${fmtMoney(input.total)} ${cur}`, tx + 90, y, 11); y -= 18;

  if (input.notes) {
    text(`Notes: ${String(input.notes).slice(0, 120)}`, margin, y, 8);
    y -= 12;
  }
  if (input.refundPolicy && input.title !== 'DEVIS' && !String(input.title).includes('ACHAT')) {
    bold('Politique de remboursement', margin, y, 8);
    y -= 11;
    const pol = String(input.refundPolicy);
    for (let i = 0; i < Math.min(pol.length, 360); i += 90) {
      text(pol.slice(i, i + 90), margin, y, 7);
      y -= 9;
    }
  }


  const contentStream = lines.join('\n');
  const contentLen = new TextEncoder().encode(contentStream).length;

  // Assemble PDF objects
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n`,
  );
  objects.push(`4 0 obj\n<< /Length ${contentLen} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += obj;
  }
  const xrefPos = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

/* ─── v254 — Monthly finance report (owner/admin only, generated on demand) ─── */

export type FinanceReportDocLine = {
  number: string;
  party: string;
  due_date: string;
  remaining: number;
  state: string;
};

export type FinanceReportInput = {
  companyName: string;
  currency: string;
  period: string;
  generatedAt: string;
  openingBalance: number;
  closingBalance: number;
  salesReceived: number;
  expenses: number;
  refunds: number;
  payrollPaid: number;
  supplierPaid: number;
  receivablesTotal: number;
  receivablesOverdue: number;
  payablesTotal: number;
  payablesOverdue: number;
  payrollDue: number;
  payrollCount: number;
  receivableDocs: FinanceReportDocLine[];
  receivableDocsTotal: number;
  payableDocs: FinanceReportDocLine[];
  payableDocsTotal: number;
};

function fmt2(n: number): string {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Single-page A4 finance report — same raw-PDF pipeline as invoices. */
export function buildFinanceReportPdf(input: FinanceReportInput): Uint8Array {
  const cur = input.currency || 'MAD';
  const W = 595;
  const H = 842;
  const margin = 40;
  const lines: string[] = [];
  let y = H - margin;

  const push = (cmd: string) => lines.push(cmd);
  const text = (str: string, x: number, yy: number, size = 10) => {
    push(`BT /F1 ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(str)}) Tj ET`);
  };
  const bold = (str: string, x: number, yy: number, size = 10) => {
    push(`BT /F2 ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(str)}) Tj ET`);
  };
  const hline = (x1: number, x2: number, yy: number) => {
    push(`${x1} ${yy} m ${x2} ${yy} l S`);
  };
  const row = (label: string, amount: number, isBold = false) => {
    if (isBold) { bold(label, margin, y, 10); bold(`${fmt2(amount)} ${cur}`, margin + 300, y, 10); }
    else { text(label, margin, y, 9); text(`${fmt2(amount)} ${cur}`, margin + 300, y, 9); }
    y -= 13;
  };

  bold(input.companyName || 'Atlas Commerce', margin, y, 14);
  y -= 14;
  bold('RAPPORT MENSUEL — TRESORERIE', W - margin - 220, H - margin, 14);
  text(`Periode: ${input.period}`, W - margin - 220, H - margin - 16, 10);
  text(`Devise: ${cur}`, W - margin - 220, H - margin - 28, 9);
  text(`Genere le: ${String(input.generatedAt).replace('T', ' ').slice(0, 19)} UTC`, W - margin - 220, H - margin - 40, 8);
  y -= 4;
  hline(margin, W - margin, y);
  y -= 16;

  bold('Flux de tresorerie', margin, y, 11);
  y -= 14;
  row('Solde ouverture', input.openingBalance);
  row('Ventes encaissees (reglements clients)', input.salesReceived);
  row('Depenses (Solde, y c. remboursements)', input.expenses);
  row('   dont remboursements clients', input.refunds);
  row('Paie reglee (salaires + acomptes)', input.payrollPaid);
  row('Factures fournisseurs reglees', input.supplierPaid);
  row('Solde cloture', input.closingBalance, true);
  y -= 6;
  hline(margin, W - margin, y);
  y -= 16;

  bold('Creances clients (reste a encaisser)', margin, y, 11);
  y -= 13;
  text(`Total du: ${fmt2(input.receivablesTotal)} ${cur}   —   dont en retard: ${fmt2(input.receivablesOverdue)} ${cur}`, margin, y, 9);
  y -= 12;
  const docTable = (docs: FinanceReportDocLine[], total: number) => {
    if (!docs.length) { text('Aucun document impaye.', margin, y, 9); y -= 13; return; }
    hline(margin, W - margin, y);
    y -= 11;
    bold('Numero', margin, y, 8);
    bold('Tiers', margin + 90, y, 8);
    bold('Echeance', margin + 260, y, 8);
    bold('Reste', margin + 340, y, 8);
    bold('Etat', margin + 440, y, 8);
    y -= 6;
    hline(margin, W - margin, y);
    y -= 12;
    for (const d of docs) {
      if (y < 90) break;
      text(String(d.number || '-').slice(0, 18), margin, y, 8);
      text(String(d.party || '-').slice(0, 30), margin + 90, y, 8);
      text(String(d.due_date || '-').slice(0, 10), margin + 260, y, 8);
      text(`${fmt2(d.remaining)} ${cur}`, margin + 340, y, 8);
      text(String(d.state || '-'), margin + 440, y, 8);
      y -= 11;
    }
    if (total > docs.length) { text(`... et ${total - docs.length} autre(s) document(s) — detail dans Balance.`, margin, y, 8); y -= 12; }
  };
  docTable(input.receivableDocs, input.receivableDocsTotal);
  y -= 4;

  if (y > 210) {
    bold('Dettes fournisseurs (reste a payer)', margin, y, 11);
    y -= 13;
    text(`Total du: ${fmt2(input.payablesTotal)} ${cur}   —   dont en retard: ${fmt2(input.payablesOverdue)} ${cur}`, margin, y, 9);
    y -= 12;
    docTable(input.payableDocs, input.payableDocsTotal);
  }

  if (y > 120) {
    y -= 4;
    hline(margin, W - margin, y);
    y -= 14;
    bold('Paie a regler (obligations echues, acomptes deduits)', margin, y, 10);
    y -= 13;
    text(`${fmt2(input.payrollDue)} ${cur} pour ${input.payrollCount} employe(s) actif(s)`, margin, y, 9);
    y -= 18;
  }

  text('Document confidentiel — reserve au proprietaire et aux administrateurs.', margin, 52, 7);
  text('Calcul serveur depuis le journal persiste (reglements, depenses, paie) — ne modifiez jamais les totaux a la main.', margin, 42, 7);
  text(`Source reconciliation: d1-live — ${String(input.generatedAt).slice(0, 19)} UTC`, margin, 32, 7);

  const contentStream = lines.join('\n');
  const contentLen = new TextEncoder().encode(contentStream).length;

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n`,
  );
  objects.push(`4 0 obj\n<< /Length ${contentLen} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += obj;
  }
  const xrefPos = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
