/**
 * pdf-lib multi-page invoice / devis / receipt PDF with watermark.
 * Respects printable area: new pages when line items overflow.
 */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, degrees } from 'pdf-lib';
import { qrMatrixWithLogo } from './qrSvg';

export type PdfLibDocInput = {
  title: string;
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
    label: string;
    name: string;
    ice?: string;
    address?: string;
    city?: string;
    email?: string;
    phone?: string;
  };
  items: { name: string; qty: number; unit: number; taxRate: number; total: number; listPrice?: number; discount?: number }[];
  subtotal: number;
  discountTotal?: number;
  taxAmount: number;
  total: number;
  amountPaid?: number;
  currency?: string;
  notes?: string;
  refundReason?: string;
  sourceInvoiceNumber?: string;
  /** Full refund policy text for sales invoices / WR (old + new). */
  refundPolicy?: string;
  status?: string;
  publicUrl?: string;
  watermark?: string;
  /** SHA-256 hex of canonical document fields (digital seal) */
  integrityHash?: string;
  /** Client signature data-url or short status */
  clientSignaturePresent?: boolean;
  signedAt?: string;
  signatureValid?: boolean;
  timestampAt?: string;
  timestampValid?: boolean;
};

function money(n: number) {
  const v = Math.round(Number(n || 0));
  // ASCII-only thousands separator (WinAnsi-safe). Avoid U+202F / NBSP from toLocaleString.
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function amountInWordsFr(n: number, currency = 'MAD'): string {
  const ones = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
  const tens = ['','','vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
  const under100 = (x: number): string => {
    if (x < 20) return ones[x];
    if (x < 70) {
      const t = Math.floor(x / 10), u = x % 10;
      if (u === 0) return tens[t];
      if (u === 1 && t !== 8) return tens[t] + ' et un';
      return tens[t] + '-' + ones[u];
    }
    if (x < 80) return 'soixante' + (x === 71 ? ' et onze' : '-' + ones[x - 60]);
    if (x < 100) {
      const u = x - 80;
      if (u === 0) return 'quatre-vingts';
      return 'quatre-vingt-' + ones[u];
    }
    return String(x);
  };
  const under1000 = (x: number): string => {
    if (x < 100) return under100(x);
    const h = Math.floor(x / 100), r = x % 100;
    const hs = h === 1 ? 'cent' : ones[h] + ' cent' + (r === 0 ? 's' : '');
    return r ? hs + ' ' + under100(r) : hs;
  };
  const abs = Math.round(Math.abs(Number(n) || 0));
  if (abs === 0) return 'zéro dirham';
  let s = '';
  const millions = Math.floor(abs / 1_000_000);
  const thousands = Math.floor((abs % 1_000_000) / 1000);
  const rest = abs % 1000;
  if (millions) s += (millions === 1 ? 'un million' : under1000(millions) + ' millions');
  if (thousands) {
    if (s) s += ' ';
    s += thousands === 1 ? 'mille' : under1000(thousands) + ' mille';
  }
  if (rest || !s) {
    if (s) s += ' ';
    s += under1000(rest);
  }
  const unit = abs > 1 ? 'dirhams' : 'dirham';
  return (s + ' ' + unit).replace(/\s+/g, ' ').trim();
}


/**
 * Helvetica = WinAnsi. Keep Latin-1 (é, à, ç…) so French reads correctly.
 * Map only chars outside WinAnsi (Arabic, emoji, fancy punctuation).
 */
function safe(s: string): string {
  return String(s || '')
    .normalize('NFC')
    // Narrow/thin/nbsp spaces from fr-FR locale → regular space (WinAnsi)
    .replace(/[\u00A0\u202F\u2009\u2007\u2008]/g, ' ')
    .replace(/[—–]/g, '-')
    .replace(/ - /g, '-')
    .replace(/€/g, 'EUR')
    .replace(/[‘’‚']/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    // Keep Latin-1 (includes é è à ç ù …); drop everything else
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42;
const FOOTER_H = 56;
const BOTTOM = FOOTER_H + 24;

export async function buildInvoicePdfLib(input: PdfLibDocInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.42);
  const rule = rgb(0.12, 0.14, 0.16);
  const headBg = rgb(0.12, 0.14, 0.16);
  const altRow = rgb(0.97, 0.97, 0.97);
  const cur = input.currency || 'MAD';
  const paid = Number(input.amountPaid || 0);
  const due = Math.max(0, Number(input.total || 0) - paid);
  const isInvoice = input.title === 'FACTURE';
  const isQuote = input.title === 'DEVIS';
  const wmText = safe(input.watermark || input.title || 'DOCUMENT');

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  let pageIndex = 0;

  const drawWatermark = (p: PDFPage) => {
    const text = wmText.slice(0, 24);
    const size = 54;
    const tw = bold.widthOfTextAtSize(text, size);
    p.drawText(text, {
      x: (PAGE_W - tw) / 2,
      y: PAGE_H / 2 - 20,
      size,
      font: bold,
      color: rgb(0.75, 0.75, 0.75),
      opacity: 0.12,
      rotate: degrees(-28),
    });
  };

  const drawFooter = (p: PDFPage, idx: number, totalPages: number) => {
    p.drawLine({
      start: { x: M, y: 40 },
      end: { x: PAGE_W - M, y: 40 },
      thickness: 0.8,
      color: rule,
    });
    p.drawText(
      safe(String(input.footerNote || 'Document genere automatiquement — ne pas modifier').slice(0, 100)),
      { x: M, y: 28, size: 6.5, font, color: muted },
    );
    p.drawText(
      safe(`${input.number || ''}   -   page ${idx + 1}/${totalPages}`),
      { x: M, y: 16, size: 7, font, color: muted },
    );
  };

  const drawText = (
    p: PDFPage,
    text: string,
    x: number,
    yy: number,
    size = 9,
    f: PDFFont = font,
    color = ink,
  ) => {
    p.drawText(safe(text), { x, y: yy, size, font: f, color });
  };

  const ensureSpace = (need: number): void => {
    if (y - need < BOTTOM) {
      pageIndex++;
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      drawWatermark(page);
      // continuation header
      drawText(page, `${input.title} ${input.number || ''} (suite)`, M, y, 10, bold);
      y -= 14;
      drawText(page, input.company.name || '', M, y, 8, font, muted);
      y -= 16;
      // table header again
      page.drawRectangle({ x: M, y: y - 6, width: PAGE_W - 2 * M, height: 18, color: headBg });
      const white = rgb(1, 1, 1);
      drawText(page, 'Article / service', M + 4, y - 1, 8, bold, white);
      drawText(page, 'Qte', M + 280, y - 1, 8, bold, white);
      drawText(page, 'P.U. HT', M + 320, y - 1, 8, bold, white);
      drawText(page, 'Total', M + 440, y - 1, 8, bold, white);
      y -= 20;
    }
  };

  drawWatermark(page);

  // Title + meta
  const isCredit =
    String(input.title || '').includes('WR') ||
    String(input.title || '').includes('REMBOURS') ||
    String(input.title || '').includes('AVOIR');
  drawText(page, input.title || 'FACTURE', M, y - 4, 20, bold);
  const metaX = PAGE_W - M - 160;
  drawText(page, 'N document', metaX, y, 8, font, muted);
  drawText(page, input.number || '-', metaX + 70, y, 9, bold);
  y -= 12;
  drawText(page, "Date d'emission", metaX, y, 8, font, muted);
  drawText(page, input.issueDate || '-', metaX + 70, y, 9);
  if (input.sourceInvoiceNumber) {
    y -= 12;
    drawText(page, 'Facture origine', metaX, y, 8, font, muted);
    drawText(page, String(input.sourceInvoiceNumber), metaX + 70, y, 9, bold);
  }
  if (input.dueDate && !isCredit) {
    y -= 12;
    drawText(page, isQuote ? 'Validité jusqu\'au' : 'Échéance', metaX, y, 8, font, muted);
    drawText(page, input.dueDate, metaX + 70, y, 9, bold);
  }
  y = PAGE_H - M - 36;

  drawText(page, input.company.name || 'Societe', M, y, 11, bold);
  y -= 12;
  const addr = [input.company.address, input.company.city].filter(Boolean).join(', ');
  if (addr) { drawText(page, addr, M, y, 8, font, muted); y -= 10; }
  const contact = [input.company.phone, input.company.email].filter(Boolean).join(' | ');
  if (contact) { drawText(page, contact, M, y, 8, font, muted); y -= 10; }
  const ids = [
    input.company.ice && `ICE ${input.company.ice}`,
    input.company.if_number && `IF ${input.company.if_number}`,
    input.company.rc && `RC ${input.company.rc}`,
    input.company.patente && `TP ${input.company.patente}`,
    (input.company as any).cnss && `CNSS ${(input.company as any).cnss}`,
  ].filter(Boolean).join('  ');
  if (ids) { drawText(page, ids, M, y, 7.5, font, muted); y -= 10; }

  y -= 6;
  page.drawRectangle({ x: M, y: y - 1, width: PAGE_W - 2 * M, height: 2.5, color: rule });
  y -= 18;

  const colW = (PAGE_W - 2 * M - 16) / 2;
  drawText(page, (input.party.label || 'Client').toUpperCase(), M, y, 8, bold, muted);
  drawText(page, 'PAIEMENT', M + colW + 16, y, 8, bold, muted);
  y -= 12;
  drawText(page, input.party.name || '-', M, y, 11, bold);
  if (input.company.bank_name) drawText(page, `Banque: ${input.company.bank_name}`, M + colW + 16, y, 9);
  y -= 11;
  let leftY = y;
  let rightY = y;
  if (input.party.ice) { drawText(page, `ICE: ${input.party.ice}`, M, leftY, 9); leftY -= 11; }
  if (input.party.address) { drawText(page, input.party.address, M, leftY, 8, font, muted); leftY -= 11; }
  if (input.party.city) { drawText(page, input.party.city, M, leftY, 8, font, muted); leftY -= 11; }
  if (input.company.bank_iban) {
    drawText(page, `RIB: ${input.company.bank_iban}`, M + colW + 16, rightY, 8, font, muted);
    rightY -= 11;
  }
  drawText(page, `Devise: ${cur}`, M + colW + 16, rightY, 9);
  y = Math.min(leftY, rightY) - 8;

  if (isInvoice) {
    const msg = due <= 0.001
      ? `STATUT: PAYÉE INTÉGRALEMENT — ${money(paid)} ${cur}`
      : `RESTE DÛ: ${money(due)} ${cur}   (payé ${money(paid)} / total ${money(input.total)} ${cur})`;
    page.drawRectangle({
      x: M, y: y - 8, width: PAGE_W - 2 * M, height: 24,
      borderColor: rule, borderWidth: 1, color: rgb(0.96, 0.96, 0.96),
    });
    drawText(page, msg, M + 10, y - 1, 10, bold);
    y -= 32;
  } else if (isQuote) {
    drawText(page, 'DEVIS — document estimatif (non facture)', M, y, 9, bold);
    y -= 16;
  }

  // Table header
  page.drawRectangle({ x: M, y: y - 6, width: PAGE_W - 2 * M, height: 18, color: headBg });
  const white = rgb(1, 1, 1);
  drawText(page, 'Article / service', M + 4, y - 1, 8, bold, white);
  drawText(page, 'Qte', M + 280, y - 1, 8, bold, white);
  drawText(page, 'P.U. HT', M + 320, y - 1, 8, bold, white);
  drawText(page, 'Total', M + 440, y - 1, 8, bold, white);
  y -= 20;

  let row = 0;
  for (const it of input.items || []) {
    const fullName = String(it.name || '-');
    const line1 = fullName.slice(0, 42);
    const line2 = fullName.length > 42 ? fullName.slice(42, 84) : '';
    const rowH = line2 ? 24 : 14;
    ensureSpace(rowH + 4);
    if (row % 2 === 1) {
      page.drawRectangle({ x: M, y: y - (line2 ? 14 : 4), width: PAGE_W - 2 * M, height: rowH, color: altRow });
    }
    drawText(page, line1, M + 4, y, 9);
    drawText(page, String(it.qty), M + 280, y, 9);
    drawText(page, money(it.unit), M + 320, y, 9);
    drawText(page, money(it.total), M + 440, y, 9);
    if (line2) {
      y -= 11;
      drawText(page, line2, M + 4, y, 8, font, muted);
    }
    y -= 14;
    row++;
  }

  ensureSpace(120);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.6, color: muted });
  y -= 16;

  const tx = PAGE_W - M - 175;
  {
    const discLib = Number(input.discountTotal || 0);
    const sous = discLib > 0.001 ? Number(input.subtotal || 0) + discLib : Number(input.subtotal || 0);
    drawText(page, 'Sous-total', tx, y, 9, font, muted);
    drawText(page, `${money(sous)} ${cur}`, tx + 95, y, 9);
    y -= 12;
    if (discLib > 0.001) {
      drawText(page, 'Promo / remise', tx, y, 9, font, muted);
      drawText(page, `−${money(discLib)} ${cur}`, tx + 95, y, 9);
      y -= 12;
    }
  }
  if (Number(input.taxAmount || 0) > 0.001) {
    drawText(page, 'TVA', tx, y, 9, font, muted);
    drawText(page, `${money(input.taxAmount)} ${cur}`, tx + 95, y, 9);
    y -= 14;
  }
  page.drawLine({ start: { x: tx, y: y + 8 }, end: { x: PAGE_W - M, y: y + 8 }, thickness: 1.2, color: rule });
  drawText(page, Number(input.taxAmount || 0) > 0.001 ? 'Total TTC' : 'Total', tx, y, 12, bold);
  drawText(page, `${money(input.total)} ${cur}`, tx + 95, y, 12, bold);
  y -= 16;
  if (isInvoice || isCredit) {
    ensureSpace(22);
    const words = amountInWordsFr(Math.abs(Number(input.total) || 0), cur);
    drawText(page, safe(`Arrêté ${isCredit ? 'le présent avoir' : 'la présente facture'} à la somme de ${words}.`), M, y, 8, font, muted);
    y -= 14;
  }
  if (isInvoice && paid > 0) {
    drawText(page, `Déjà payé: ${money(paid)} ${cur}   Reste: ${money(due)} ${cur}`, tx, y, 8, font, muted);
    y -= 14;
  }

  if (isCredit && input.refundReason) {
    ensureSpace(36);
    drawText(page, 'Motif du credit / remboursement', M, y, 8, bold);
    y -= 11;
    drawText(page, String(input.refundReason).slice(0, 110), M, y, 8, font, muted);
    y -= 14;
  } else if (input.notes) {
    ensureSpace(30);
    drawText(page, 'Notes', M, y, 8, bold, muted);
    y -= 11;
    drawText(page, String(input.notes).slice(0, 110), M, y, 8, font, muted);
    y -= 14;
  }

  // Refund policy on every sales invoice / WR (covers reprints of old invoices)
  if (input.refundPolicy && input.title !== 'DEVIS' && !String(input.title).includes('ACHAT')) {
    ensureSpace(48);
    drawText(page, 'Politique de remboursement', M, y, 8, bold);
    y -= 11;
    const policy = String(input.refundPolicy);
    const chunk = 95;
    for (let i = 0; i < policy.length && i < 380; i += chunk) {
      ensureSpace(12);
      drawText(page, policy.slice(i, i + chunk), M, y, 7, font, muted);
      y -= 10;
    }
    y -= 4;
  }

  if (isQuote) {
    // Stay on current page when space remains; only new page if strictly insufficient
    const need = 72;
    ensureSpace(need);
    y -= 6;
    drawText(page, 'BON POUR ACCORD', M, y, 10, bold);
    y -= 14;
    drawText(page, 'Date _______________  Nom / qualite _______________', M, y, 9, font, muted);
    y -= 16;
    drawText(page, 'Signature client ____________________  Cachet ____________________', M, y, 9, font, muted);
    y -= 14;
  }

    if (isInvoice && input.publicUrl) {
    ensureSpace(78);
    const boxH = 70;
    page.drawRectangle({
      x: M, y: y - boxH + 8, width: PAGE_W - 2 * M, height: boxH,
      borderColor: muted, borderWidth: 0.8, color: rgb(0.98, 0.98, 0.98),
    });
    try {
      const { matrix, logoFrom, logoSize } = qrMatrixWithLogo(String(input.publicUrl));
      const qs = 56;
      const qx = M + 8;
      const qy = y - boxH + 14;
      const n = matrix.length || 1;
      const cell = qs / n;
      page.drawRectangle({ x: qx, y: qy, width: qs, height: qs, color: rgb(1, 1, 1) });
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (matrix[r][c]) {
            page.drawRectangle({
              x: qx + c * cell,
              y: qy + (n - 1 - r) * cell,
              width: cell + 0.05,
              height: cell + 0.05,
              color: rgb(0.04, 0.04, 0.04),
            });
          }
        }
      }
      // Center Atlas plate
      const ls = logoSize * cell;
      const lx = qx + logoFrom * cell;
      const ly = qy + (n - logoFrom - logoSize) * cell;
      page.drawRectangle({
        x: lx, y: ly, width: ls, height: ls,
        color: rgb(0.04, 0.04, 0.04),
      });
      drawText(page, 'A', lx + ls * 0.28, ly + ls * 0.28, Math.max(8, ls * 0.55), bold, rgb(1, 1, 1));
      drawText(page, 'Scanner pour vérifier ce document', M + 72, y - 6, 9, bold);
      drawText(page, `${input.number || ''}  -  Total ${money(input.total)} ${cur}  -  Payé ${money(paid)}  -  Reste ${money(due)}`, M + 72, y - 20, 8, font, muted);
      drawText(page, 'QR officiel Atlas — ne scannez pas d\'autres codes.', M + 72, y - 32, 7, font, muted);
    } catch {
      drawText(page, 'Vérification en ligne (QR indisponible)', M + 8, y - 6, 8, bold);
      drawText(page, `Total ${money(input.total)} ${cur} | Payé ${money(paid)} | Reste ${money(due)}`, M + 8, y - 18, 8, font, muted);
    }
    y -= boxH + 8;
  }


  // Stamp + digital seal — continue from current y (no forced jump to page bottom)
  ensureSpace(56);
  const sigY = y - 10;
  page.drawLine({ start: { x: M, y: sigY }, end: { x: M + 120, y: sigY }, thickness: 0.5, color: muted });
  drawText(page, 'Signature société', M, sigY - 12, 7, font, muted);
  page.drawCircle({ x: M + 180, y: sigY + 8, size: 20, borderColor: muted, borderWidth: 0.7 });
  drawText(page, 'Cachet', M + 165, sigY - 12, 7, font, muted);

  // Digital signature / integrity seal
  const sealY = sigY - 36;
  page.drawRectangle({
    x: M + 240, y: sealY - 8, width: PAGE_W - M - 240 - M, height: 42,
    borderColor: rule, borderWidth: 0.8, color: rgb(0.97, 0.98, 0.97),
  });
  const sealTitle = input.clientSignaturePresent
    ? (input.signatureValid === false ? 'Signature client a verifier' : 'Signature client + sceau + horodatage')
    : 'Sceau numérique du document';
  drawText(page, sealTitle, M + 248, sealY + 18, 8, bold);
  if (input.integrityHash) {
    drawText(page, `Hash SHA-256: ${input.integrityHash.slice(0, 24)}...`, M + 248, sealY + 6, 7, font, muted);
  }
  if (input.signedAt) {
    drawText(page, `Signe le ${input.signedAt}`, M + 248, sealY - 4, 7, font, muted);
  } else {
    drawText(page, input.timestampAt
    ? `Horodatage: ${String(input.timestampAt).slice(0, 19)} UTC (PAdES-B-T)`
    : 'Empreinte document (intégrité SHA-256)', M + 248, sealY - 4, 7, font, muted);
  }

  // Footer on all pages
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    if (i === 0) drawWatermark(p); // already on first; continue pages got it in ensureSpace
    drawFooter(p, i, pages.length);
  });
  // Ensure watermark on every page
  for (const p of pages) {
    // watermark already drawn when page created; re-draw is ok with opacity
  }

  // PDF digital seal metadata (readable by PDF inspectors)
  const hash = input.integrityHash || '';
  pdf.setTitle(safe(`${input.title} ${input.number || ''}`));
  pdf.setSubject(safe(`Integrity ${hash.slice(0, 16)}  -  Atlas Commerce`));
  pdf.setKeywords([
    'atlas-commerce',
    input.title || 'doc',
    input.number || '',
    hash ? `hash:${hash.slice(0, 32)}` : 'unsigned',
    input.clientSignaturePresent ? 'client-signed' : 'no-client-sig',
  ].filter(Boolean).map(safe));
  pdf.setProducer('Atlas Commerce PDF');
  pdf.setCreator('Atlas Commerce');

  return pdf.save();
}
