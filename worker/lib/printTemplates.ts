import type { Hono } from 'hono';
import { qrToSvg } from '../qrSvg';
import { schemaOnce, addColumnIfMissing } from './schema';
import { assertSafeOutboundUrl, escapeHtml, safeImageSrc } from './security';
import { sendSms, documentSmsBody } from '../sms';

/** Inline SVG data-URI — reliable in print/PDF (no broken external img). */
export function atlasQrImg(_origin: string | undefined, data: string, size = 100): string {
  if (!data) return '';
  try {
    const svg = qrToSvg(String(data), size, 2);
    // base64 is more reliable for print / PDF / img tags than utf8 data URIs
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}

/* ─── Invoice HTML Template ─── */


export async function ensureDocAssetColumns(db: D1Database) {
  await schemaOnce('doc_asset_cols', async () => {
    for (const col of ['company_signature_url', 'company_stamp_url', 'numbering_style', 'numbering_pad', 'next_bill_number']) {
      await addColumnIfMissing(db, 'company_settings', col, 'TEXT');
    }
  });
}

export function companyStampBlock(settings: any): string {
  const parts: string[] = [];
  // Company signature / stamp only — no client signature placeholder on print/PDF
  if (settings?.company_signature_url) {
    parts.push(`<div style="text-align:center"><img src="${settings.company_signature_url}" alt="Signature" style="max-height:64px;max-width:160px"/><div style="font-size:10px;margin-top:4px">Signature société</div></div>`);
  } else {
    parts.push(`<div style="text-align:center;min-width:140px"><div style="height:64px;border-bottom:1px solid #333;margin:0 8px"></div><div style="font-size:10px;margin-top:6px">Signature société</div></div>`);
  }
  if (settings?.company_stamp_url) {
    parts.push(`<div style="text-align:center"><img src="${settings.company_stamp_url}" alt="Cachet" style="max-height:72px;max-width:120px"/><div style="font-size:10px;margin-top:4px">Cachet</div></div>`);
  } else {
    parts.push(`<div style="text-align:center;min-width:100px"><div style="height:72px;width:90px;margin:0 auto;border:1px dashed #999;border-radius:50%;width:56px;height:56px"></div><div style="font-size:9px;margin-top:4px">Cachet</div></div>`);
  }
  return `<div style="display:flex;gap:16px;justify-content:flex-end;align-items:flex-end;margin-top:8px;page-break-inside:avoid">${parts.join('')}</div>`;
}

/** REÇU — Phase 3 Jobber-style proof of payment (QR kept) */

export function generateReceiptHTMLMinimal(settings: any, r: any, clientStatusUrl?: string, verifyUrl?: string, opts?: { autoPrint?: boolean }): string {
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    return day && m && y ? `${day}/${m}/${y}` : d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const methodLabel = ({
    cash: 'Espèces', bank: 'Virement', bank_company: 'Virement', bank_owner: 'Virement',
    check: 'Chèque', check_company: 'Chèque', check_owner: 'Chèque', card: 'Carte', other: 'Autre',
  } as Record<string, string>)[r.payment_method || ''] || (r.payment_method || '—');
  const verifyQr = verifyUrl ? atlasQrImg('', verifyUrl, 88) : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Reçu ${r.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Courier New",Courier,monospace;color:#111;background:#fff;padding:16px;max-width:320px;margin:0 auto;font-size:12px;line-height:1.35}
h1{font-size:14px;text-align:center;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.center{text-align:center}
.muted{color:#444;font-size:11px}
.hr{border:0;border-top:1px dashed #333;margin:10px 0}
.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}
.big{font-size:18px;font-weight:700;text-align:center;margin:10px 0}
.no-print button{background:#111;color:#fff;border:0;padding:8px 12px;width:100%;font-weight:600;cursor:pointer;margin-bottom:10px}
@media print{.no-print{display:none!important} body{padding:0;max-width:none} @page{size:A4;margin:7mm} .qr-card{padding:6px!important;margin-top:8px!important} .sign-area{margin-top:10px!important}}
</style></head><body>
<div class="no-print"><button type="button" onclick="window.print()">Imprimer ticket minimal</button></div>
<h1>${settings?.company_name || 'Reçu'}</h1>
<p class="center muted">${settings?.city || ''}</p>
<hr class="hr"/>
<div class="row"><span>N° reçu</span><strong>${r.number || '—'}</strong></div>
<div class="row"><span>Date</span><span>${formatDate(r.issue_date || '')}</span></div>
<div class="row"><span>Client</span><span>${r.client_name || '—'}</span></div>
${r.invoice_number ? `<div class="row"><span>Facture</span><span>${r.invoice_number}</span></div>` : ''}
<div class="row"><span>Mode</span><span>${methodLabel}</span></div>
<hr class="hr"/>
<div class="big">${fmt(Number(r.amount))} ${cur}</div>
<p class="center muted">Montant reçu</p>
<hr class="hr"/>
${verifyQr ? `<p class="center"><img src="${verifyQr}" width="80" height="80" alt="QR"/><br/><span class="muted">Vérification</span></p>
<p class="muted" style="font-size:10px;margin-top:8px"><a href="/privacy">Confidentialité</a> · QR situation optionnel et limité dans le temps</p>` : ''}
<p class="center muted" style="margin-top:10px">Merci · ticket simplifié</p>
${opts?.autoPrint === false ? '' : '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>'}
</body></html>`;
}

export function generateReceiptHTML(settings: any, r: any, clientStatusUrl?: string, verifyUrl?: string, opts?: { autoPrint?: boolean }): string {
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    return day && m && y ? `${day}/${m}/${y}` : d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const logoBlock = settings?.logo_url
    ? `<img src="${settings.logo_url}" alt="logo" style="max-height:52px;max-width:160px;display:block;margin-bottom:6px" />`
    : '';
  const methodLabel = ({
    cash: 'Espèces (caisse)', bank: 'Virement', bank_company: 'Virement société', bank_owner: 'Virement propriétaire',
    check: 'Chèque', check_company: 'Chèque société', check_owner: 'Chèque propriétaire', card: 'Carte', other: 'Autre',
  } as Record<string, string>)[r.payment_method || ''] || (r.payment_method || '—');
  const sellerIds = [['ICE', settings?.ice], ['IF', settings?.if_number], ['RC', settings?.rc], ['TP', settings?.patente]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');

  const verifyQr = verifyUrl ? atlasQrImg('', verifyUrl, 100) : '';
  const statusQr = clientStatusUrl ? atlasQrImg('', clientStatusUrl, 100) : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Reçu ${r.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:6px 10px;max-width:720px;margin:0 auto;font-size:12px;line-height:1.3}
.zone{border:1px solid #000;border-radius:2px;padding:8px 10px;margin-bottom:8px}
.zone h3{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#355;margin-bottom:8px;font-weight:700}
.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:8px}
.co-name{font-size:18px;font-weight:800}
.co-meta{font-size:12px;color:#355;margin-top:4px}
.receipt-pill{background:#000;color:#fff;padding:8px 12px;border-radius:2px;min-width:160px}
.receipt-pill .t{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.9}
.receipt-pill .n{font-size:18px;font-weight:800;margin-top:4px}
.receipt-pill .d{font-size:12px;margin-top:4px;opacity:.9}
.paid{text-align:center;padding:10px;border:2px solid #000;background:#fff;margin:8px 0}
.paid .l{font-size:11px;text-transform:uppercase;letter-spacing:.1em}
.paid .v{font-size:32px;font-weight:800;margin-top:6px}
table.lines{width:100%;border-collapse:collapse;margin:4px 0 8px}
table.lines th{background:#1a1d26;color:#fff;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
table.lines td{padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:12.5px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pay-box{border:1px solid #000;padding:14px 16px;background:#fafcfb}
.pay-box h3{font-size:12px;margin-bottom:8px}
.pay-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px solid #e0ebe5}
.pay-row:last-child{border:0;font-weight:700;font-size:15px;padding-top:8px}
.thanks{font-size:11px;font-style:italic;color:#333;margin:6px 0}
.qr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.qr-card{display:flex;gap:6px;align-items:center;padding:4px 6px;border:1px solid #000;border-radius:2px;background:#fff;margin-top:4px}
.qr-card img{border:2px solid #fff;box-shadow:0 0 0 1px #1a1d26;flex-shrink:0}
.qr-card .meta{font-size:11.5px;line-height:1.4}
.footer{margin-top:8px;padding-top:6px;border-top:1px solid #000;font-size:9px;color:#333;display:flex;justify-content:space-between;gap:8px}
.watermark{position:fixed;inset:0;pointer-events:none;z-index:0;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;letter-spacing:0.12em;opacity:0.06;transform:rotate(-28deg);color:#000;text-transform:uppercase}
.sheet{position:relative;z-index:1}
.keep,.zone,.paid,.pay-box,.qr-grid,.qr-card{page-break-inside:avoid;break-inside:avoid}
table.lines thead{display:table-header-group}
table.lines tr{page-break-inside:avoid;break-inside:avoid}
@media print{
@page{size:A4;margin:6mm}
body{padding:0;max-width:none;font-size:11px;color:#000!important;background:#fff!important}
.no-print{display:none!important}
.watermark{display:none!important}
.zone,.paid,.pay-box,.qr-card{border-color:#000!important;background:#fff!important;box-shadow:none!important}
.receipt-pill,table.lines th{background:#000!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.qr-card img{width:100px!important;height:100px!important}
.sign-area{margin-top:6px!important}
.thanks{margin:4px 0!important}
}
</style></head><body>
<div class="watermark" aria-hidden="true">RECU</div>
<div class="sheet">
<!-- Structure document: 1.En-tete 2.Parties 3.Lignes 4.Totaux 5.Notes/BPA 6.Verification QR 7.Signatures -->
<div class="no-print" style="margin-bottom:12px"><button type="button" onclick="window.print()" style="background:#1a1d26;color:#fff;border:0;padding:10px 16px;cursor:pointer;font-weight:600">Imprimer / PDF</button></div>

<!-- 1. Business details -->
<div class="top">
  <div>
    ${logoBlock}
    <div class="co-name">${settings?.company_name || ''}</div>
    <div class="co-meta">${[settings?.address, settings?.city, settings?.postal_code].filter(Boolean).join(', ')}</div>
    <div class="co-meta">${[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</div>
    ${sellerIds ? `<div class="co-meta" style="margin-top:4px">${sellerIds}</div>` : ''}
  </div>
  <!-- 3. Receipt number + date -->
  <div class="receipt-pill">
    <div class="t">Reçu de paiement</div>
    <div class="n">${r.number || '—'}</div>
    <div class="d">Date : ${formatDate(r.issue_date || '')}</div>
  </div>
</div>

<!-- 2. Customer -->
<div class="zone">
  <h3>Client (destinataire)</h3>
  <strong style="font-size:15px">${r.client_name || '—'}</strong>
  ${r.client_ice ? `<div class="co-meta">ICE : ${r.client_ice}</div>` : ''}
  ${[r.client_address, r.client_city].filter(Boolean).length ? `<div class="co-meta">${[r.client_address, r.client_city].filter(Boolean).join(', ')}</div>` : ''}
  ${r.invoice_number ? `<div class="co-meta" style="margin-top:6px">Facture liée : <strong>${r.invoice_number}</strong></div>` : ''}
</div>

<!-- Amount highlight -->
<div class="paid">
  <div class="l">Montant reçu</div>
  <div class="v">${fmt(Number(r.amount))} ${cur}</div>
</div>

<!-- 4. Products / service line -->
${(() => {
  const items = Array.isArray(r._line_items) ? r._line_items : [];
  if (items.length) {
    const rows = items.map((it: any) => {
      const qty = Number(it.quantity || 0);
      const pu = Number(it.unit_price || 0);
      const lt = Number(it.line_total != null ? it.line_total : qty * pu);
      return `<tr>
        <td><strong>${it.product_name || '—'}</strong>${it.sku ? `<div class="co-meta">${it.sku}</div>` : ''}<div class="co-meta">${qty} × ${fmt(pu)} ${cur}</div></td>
        <td class="num">${fmt(lt)} ${cur}</td>
      </tr>`;
    }).join('');
    return `<table class="lines">
  <thead><tr><th>Désignation (détail facture)</th><th class="num" style="width:120px">Montant</th></tr></thead>
  <tbody>${rows}
    <tr><td><strong>Total encaissé sur ce reçu</strong>${r.invoice_number ? `<div class="co-meta">Facture ${r.invoice_number}</div>` : ''}</td>
    <td class="num"><strong>${fmt(Number(r.amount))} ${cur}</strong></td></tr>
  </tbody></table>`;
  }
  return `<table class="lines">
  <thead><tr><th>Désignation</th><th class="num" style="width:120px">Montant</th></tr></thead>
  <tbody>
    <tr>
      <td>
        <strong>Encaissement client</strong>
        ${r.invoice_number ? `<div class="co-meta">Règlement facture ${r.invoice_number}</div>` : `<div class="co-meta">Reçu de paiement</div>`}
      </td>
      <td class="num">${fmt(Number(r.amount))} ${cur}</td>
    </tr>
  </tbody>
</table>`;
})()}

<!-- 5. Thanks / notes -->
${r.notes ? `<div class="zone"><h3>Notes</h3><p>${r.notes}</p></div>` : ''}
<p class="thanks">Merci pour votre confiance.</p>

<!-- 6. Receipt for payment summary -->
<div class="pay-box">
  <h3>Récapitulatif de paiement</h3>
  <div class="pay-row"><span>Sous-total</span><span>${fmt(Number(r.amount))} ${cur}</span></div>
  <div class="pay-row"><span>Mode</span><span>${methodLabel}</span></div>
  <div class="pay-row"><span>Total reçu</span><span>${fmt(Number(r.amount))} ${cur}</span></div>
</div>

<!-- QR codes (kept) -->
<div class="qr-grid">
  ${verifyQr ? `<div class="qr-card">
    <img src="${verifyQr}" width="100" height="100" alt="QR vérification reçu" style="width:100px;height:100px;object-fit:contain"/>
    <div class="meta"><strong>Scanner — vérifier ce reçu</strong><br/>Authentifie le n° ${r.number || ''}<br/>Montant ${fmt(Number(r.amount))} ${cur}</div>
  </div>` : ''}
  ${statusQr ? `<div class="qr-card">
    <img src="${statusQr}" width="100" height="100" alt="QR situation" style="width:100px;height:100px;object-fit:contain"/>
    <div class="meta"><strong>Situation client</strong><br/>Factures payées et impayées de ce client.</div>
  </div>` : ''}
</div>

${companyStampBlock(settings)}
<div class="footer">
  <span>${sellerIds || ''}</span>
  <span>Preuve de paiement · Conservez ce reçu</span>
</div>
</div><!-- /.sheet -->
${opts?.autoPrint === false ? '' : '<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>'}
</body></html>`;
}


/**
 * Unified generator with clearly different skins:
 * - DEVIS: dashed, estimate, validity, no QR, no payment demand
 * - FACTURE: formal request for payment, due date, optional verification QR
 * - FACTURE D'ACHAT (bill): purchase from vendor, no QR
 */
/** Politique remboursement — affichée sur toute facture de vente (anciennes + nouvelles). */
export const REFUND_POLICY_HTML = `
<div class="terms keep" style="margin-top:20px">
  <h3>Politique de remboursement</h3>
  <p><strong>Un remboursement sans motif valable n’est pas accepté</strong>, quelle que soit la situation.</p>
  <p>Motifs acceptés uniquement :</p>
  <ul style="margin:6px 0 6px 18px;padding:0">
    <li>Erreur de notre part (commande / facturation)</li>
    <li>Article cassé ou défectueux à l’envoi — non causé par le client</li>
    <li>Mauvais article / non conforme envoyé</li>
    <li>Quantité manquante à la livraison</li>
    <li>Dommage constaté à la réception (transport)</li>
  </ul>
  <p>Tout retour ou avoir (document WR) exige une explication détaillée. Sans justification claire, la demande est refusée.</p>
</div>`;

export const REFUND_POLICY_TEXT =
  'Politique de remboursement : un remboursement sans motif valable n’est pas accepté. ' +
  'Motifs acceptés : erreur de notre part ; article cassé/défectueux envoyé (pas de votre fait) ; ' +
  'mauvais article / non conforme ; quantité manquante ; dommage transport. ' +
  'Une explication détaillée est obligatoire pour tout avoir WR.';


/** French amount in words (MAD) — for "Arrêté la présente facture…" */
export function amountInWordsFr(n: number, currency = 'MAD'): string {
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
  if (abs === 0) return `zéro ${currency === 'MAD' ? 'dirham' : currency}`;
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
  const unit = currency === 'MAD' ? (abs > 1 ? 'dirhams' : 'dirham') : currency;
  return `${s} ${unit}`.replace(/\s+/g, ' ').trim();
}


/** Employee hire / dossier form — same visual language as invoice print (A4 commercial doc). */
export function generateEmployeeFormHTML(settings: any, emp: any | null, opts?: { autoPrint?: boolean }): string {
  const eh = (s: any) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const filled = !!emp;
  const company = eh(settings?.company_name || 'Atlas Commerce');
  const logoSrc =
    typeof safeImageSrc === 'function' ? safeImageSrc(settings?.logo_url) : settings?.logo_url || '';
  // Small logo only — B&W print friendly (no colored chrome)
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="" class="logo" />`
    : '';
  const cell = (key: string) => {
    const val = emp?.[key];
    if (filled && val != null && String(val).trim() !== '') {
      return `<span class="f">${eh(val)}</span>`;
    }
    return '<span class="b"></span>';
  };
  const name = filled
    ? eh([emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '')
    : '';
  const pay =
    filled && emp?.pay_amount != null
      ? `${Number(emp.pay_amount).toLocaleString('fr-FR')} MAD`
      : '';
  const cycle = filled
    ? emp.pay_cycle_type === 'days'
      ? `Tous les ${emp.pay_cycle_days || 7} j`
      : 'Mensuel'
    : '';
  const autoPrint = opts?.autoPrint !== false;
  const title = filled ? 'FICHE EMPLOYÉ' : 'DOSSIER D’EMBAUCHE';
  const sub = filled
    ? 'Dossier du personnel'
    : 'À remplir avant embauche · CNSS / Code du travail';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>${title}${filled && emp?.emp_number ? ' ' + eh(emp.emp_number) : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:10mm}
html,body{height:100%}
body{
  font-family:Arial,Helvetica,sans-serif;
  color:#000;background:#fff;
  padding:0;max-width:190mm;margin:0 auto;
  font-size:8.5pt;line-height:1.25;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sheet{min-height:277mm;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;
  padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:6px}
.logo{max-height:28px;max-width:90px;display:block;margin-bottom:3px;filter:grayscale(1)}
.company{font-size:10pt;font-weight:700;letter-spacing:0.02em}
.meta{font-size:7.5pt;color:#222;margin-top:2px;line-height:1.3}
.badge{text-align:right}
.badge .t{font-size:12pt;font-weight:800;letter-spacing:0.06em}
.badge .s{font-size:7.5pt;margin-top:2px}
.band{border:1px solid #000;padding:3px 6px;font-size:7.5pt;font-weight:600;
  margin-bottom:6px;background:#fff}
h2{font-size:8pt;font-weight:700;margin:6px 0 3px;padding:2px 0;
  border-bottom:1px solid #000;text-transform:uppercase;letter-spacing:0.04em}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #000;padding:3px 5px;vertical-align:middle;font-size:8pt}
th{width:18%;text-align:left;font-weight:600;background:#fff}
td{height:16px}
.b{display:block;border-bottom:1px solid #000;min-height:12px;width:100%}
.f{font-weight:600}
.note{font-size:7pt;margin-top:6px;line-height:1.3;color:#111}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}
.sig{border:1px solid #000;height:48px;padding:4px 6px}
.sig .l{font-size:7pt;font-weight:600;text-transform:uppercase}
.foot{margin-top:auto;padding-top:6px;border-top:1px solid #000;font-size:7pt;color:#333;
  display:flex;justify-content:space-between}
.actions{position:fixed;top:8px;right:8px;z-index:20}
.actions button{font-family:inherit;font-size:12px;padding:6px 12px;border:1px solid #000;
  background:#fff;color:#000;cursor:pointer;border-radius:4px}
@media print{
  body{padding:0;max-width:none}
  .actions{display:none!important}
  .sheet{min-height:auto}
  th,td,.band,.sig,.top{border-color:#000!important;background:#fff!important}
}
</style></head>
<body>
  <div class="actions"><button type="button" onclick="window.print()">Imprimer / PDF</button></div>
  <div class="sheet">
    <div class="top">
      <div>
        ${logoBlock}
        <div class="company">${company}</div>
        <div class="meta">
          ${settings?.address ? eh(settings.address) + ' · ' : ''}${[settings?.city, settings?.country].filter(Boolean).map(eh).join(' · ')}
          ${settings?.ice ? ' · ICE ' + eh(settings.ice) : ''}${settings?.tax_id ? ' · IF ' + eh(settings.tax_id) : ''}
        </div>
      </div>
      <div class="badge">
        <div class="t">${title}</div>
        <div class="s">${filled && emp?.emp_number ? 'N° ' + eh(emp.emp_number) : 'Document RH'}</div>
        <div class="s">${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
    </div>
    <div class="band">${sub}</div>

    <h2>1. Identité</h2>
    <table>
      <tr><th>Nom</th><td>${cell('last_name')}</td><th>Prénom</th><td>${cell('first_name')}</td></tr>
      <tr><th>Nom complet</th><td colspan="3">${filled ? `<span class="f">${name}</span>` : '<span class="b"></span>'}</td></tr>
      <tr><th>Naissance</th><td>${cell('date_of_birth')}</td><th>Sexe</th><td>${cell('gender')}</td></tr>
      <tr><th>Nationalité</th><td>${cell('nationality')}</td><th>Situation fam.</th><td>${cell('marital_status')}</td></tr>
      <tr><th>CIN / ID</th><td>${cell('national_id')}</td><th>N° fiscal</th><td>${cell('tax_id')}</td></tr>
      <tr><th>Adresse</th><td colspan="3">${cell('address')}</td></tr>
      <tr><th>Ville</th><td>${cell('city')}</td><th>Tél. / E-mail</th><td>${cell('phone')}${filled && emp?.email ? ' · ' + eh(emp.email) : filled ? '' : ' / '}</td></tr>
    </table>

    <h2>2. CNSS &amp; banque</h2>
    <table>
      <tr><th>N° CNSS</th><td>${cell('cnss_number') || cell('social_insurance')}</td><th>AMO / assur.</th><td>${cell('health_insurance')}</td></tr>
      <tr><th>RIB</th><td colspan="3">${cell('rib')}</td></tr>
    </table>

    <h2>3. Emploi</h2>
    <table>
      <tr><th>Poste</th><td colspan="3">${cell('role_title')}</td></tr>
      <tr><th>Contrat</th><td>${cell('contract_type')}</td><th>Entrée</th><td>${cell('joined_date')}</td></tr>
      <tr><th>Essai (j)</th><td>${cell('trial_days')}</td><th>H / semaine</th><td>${cell('weekly_hours')}</td></tr>
      <tr><th>Salaire</th><td>${pay ? `<span class="f">${eh(pay)}</span>` : '<span class="b"></span>'}</td>
          <th>Cycle</th><td>${cycle ? `<span class="f">${eh(cycle)}</span>` : '<span class="b"></span>'}</td></tr>
      <tr><th>Fonctions</th><td colspan="3">${cell('job_description')}</td></tr>
    </table>

    <p class="note">${
      filled
        ? 'Document Atlas Commerce — dossier personnel. Vérifier CIN / RIB avant déclaration CNSS.'
        : 'Je certifie l’exactitude des informations et fournirai CIN/passeport, RIB et certificat d’aptitude pour la CNSS.'
    }</p>
    <div class="sigs">
      <div class="sig"><div class="l">Date</div></div>
      <div class="sig"><div class="l">${filled ? 'Signature salarié' : 'Signature candidat'}</div></div>
      <div class="sig"><div class="l">Employeur</div></div>
    </div>
    <div class="foot">
      <span>${company} — document interne</span>
      <span>Impression N&amp;B recommandée · 1 page A4</span>
    </div>
  </div>
  ${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print()}catch(e){}},350)});</script>' : ''}
</body></html>`;
}

export function generateInvoiceHTML(settings: any, inv: any, items: any[], title = 'FACTURE', autoPrint = true): string {
  const eh = escapeHtml;
  const pdfShow = (key: string, def = true) => {
    const v = settings?.[key];
    if (v === undefined || v === null || v === '') return def;
    return !(v === 0 || v === '0' || v === false || v === 'false');
  };
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    if ((settings?.date_format || 'DD/MM/YYYY') === 'DD/MM/YYYY' && day && m) return `${day}/${m}/${y}`;
    if (settings?.date_format === 'MM/DD/YYYY' && day && m) return `${m}/${day}/${y}`;
    return d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => {
    const v = Math.round(Number(n || 0) * 100) / 100;
    const s = v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${s} ${cur === 'MAD' ? 'MAD' : cur}`;
  };
  const isQuote = title === 'DEVIS' || inv.status === 'quote' || inv.status === 'devis';
  const isBill = title.includes('ACHAT') || !!inv.vendor_name;
  const isRefund =
    title.includes('REMBOURS') ||
    title.includes('WR') ||
    inv.status === 'remboursement' ||
    inv.doc_kind === 'remboursement';
  const isInvoice = !isQuote && !isBill;
  const partyName = inv.client_name || inv.vendor_name || '';
  const partyIce = inv.client_ice || inv.vendor_ice || '';
  const partyAddr = inv.client_address || inv.vendor_address || '';
  const partyCity = inv.client_city || '';
  const logoSrc = safeImageSrc(settings?.logo_url);
  const logoBlock = (pdfShow('pdf_show_logo', true) && logoSrc)
    ? `<img src="${logoSrc}" alt="logo" style="max-height:52px;max-width:160px;display:block;margin-bottom:8px" />`
    : '';
  const paidAmt = Number(inv.amount_paid || 0);
  const totalAmt = Number(inv.total || 0);
  const dueAmt = Math.max(0, totalAmt - paidAmt);
  const footerNote = settings?.pdf_footer_text || settings?.document_footer_note || settings?.report_footer || settings?.notes || '';

  // Theme per document type (custom accent overrides default)
  let accent = (settings?.pdf_accent_color && String(settings.pdf_accent_color).startsWith('#'))
    ? String(settings.pdf_accent_color)
    : '#1a1814';
  let docLabel = 'FACTURE';
  let bodyExtra = '';
  if (isQuote) {
    accent = '#5c4a1f';
    docLabel = 'DEVIS';
    bodyExtra = 'quote';
  } else if (isBill) {
    accent = '#1e3a5f';
    docLabel = "FACTURE D'ACHAT";
    bodyExtra = 'bill';
  } else if (isRefund) {
    accent = '#8a5520';
    docLabel = 'REMBOURSEMENT (WR)';
    bodyExtra = 'refund';
  } else if (inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR')) {
    accent = '#1a1d26';
    docLabel = 'VENTE RAPIDE';
    bodyExtra = 'quick_sale';
  } else {
    accent = '#1a1814';
    docLabel = 'FACTURE';
    bodyExtra = 'invoice';
  }
  // B&W print-friendly (laser / N&B)
  accent = '#000';

  // QR on sales invoices, or any preview that passes preview_qr_text
  let qrBlock = '';
  const qrSource = String(inv.public_url || inv.preview_qr_text || '');
  if (qrSource && (isInvoice || inv.preview_qr) && pdfShow('pdf_show_qr', true)) {
    // public_url is already set to /api/public/verify?p=v1.invoice… by print route
    const qrPayload = qrSource;
    const qrUrl = atlasQrImg('', qrPayload, 100);
    qrBlock = `
    <div class="qr-panel">
      <img src="${qrUrl}" width="96" height="96" alt="QR verification ${inv.number || ''}" class="qr-img" style="width:96px;height:96px"/>
      <div class="qr-meta">
        <strong>Scanner pour vérifier ce document</strong>
        <div>${docLabel} <strong>${inv.number || ''}</strong>${bodyExtra === 'quick_sale' ? ' · ticket caisse VR' : ''}</div>
        <div>Client : ${eh(partyName || '—')} ${partyIce ? '· ICE ' + eh(partyIce) : ''}</div>
        <div>Total ${fmt(totalAmt)} · Payé ${fmt(paidAmt)} · Reste ${fmt(dueAmt)}</div>
        <div class="qr-hint">${inv.preview_qr ? 'Scannez : le lecteur affiche le résumé (type, numéro, partie, total) tel qu’il est imprimé. Aperçu non contractuel.' : 'Page officielle de vérification (soldes à jour). Ce QR mène uniquement vers le domaine Atlas de l’émetteur — ne scannez pas d’autres codes.'}</div>
      </div>
    </div>`;
  }

  // v0.7 — second QR card: « situation client » sample on receipt previews
  let qrSitBlock = '';
  if (inv.preview_situation_qr && inv.preview_situation_text) {
    const sitUrl = atlasQrImg('', String(inv.preview_situation_text), 100);
    qrSitBlock = `
    <div class="qr-panel">
      <img src="${sitUrl}" width="96" height="96" alt="QR situation client (aperçu)" class="qr-img" style="width:96px;height:96px"/>
      <div class="qr-meta">
        <strong>Situation client</strong>
        <div>Factures payées et impayées de cette partie — tel qu'imprimé sur le reçu réel quand l'option est activée.</div>
        <div class="qr-hint">Aperçu non contractuel.</div>
      </div>
    </div>`;
  }

  const validity = isQuote && inv.due_date
    ? `<div style="margin-top:6px">Validité jusqu'au <strong>${formatDate(inv.due_date)}</strong></div>`
    : '';

  const paymentBox = isRefund
    ? `<div class="amount-banner quote" style="border-color:${accent};background:#fdf8f3">
          <span class="ab-label">Avoir / crédit</span>
          <span class="ab-value">Crédit client ${fmt(totalAmt)} ${cur}</span>
          <span class="ab-sub">Document miroir d’une facture — réduit le solde dû (ou rembourse si déjà payé). Stock rétabli pour les quantités listées.</span>
        </div>`
    : isInvoice
    ? `<div class="amount-banner ${dueAmt <= 0.001 ? 'paid' : 'due'}">
        ${dueAmt <= 0.001
          ? `<span class="ab-label">Statut</span><span class="ab-value">Payée intégralement</span>`
          : `<span class="ab-label">Reste dû</span><span class="ab-value">${fmt(dueAmt)} ${cur}</span>
             <span class="ab-sub">Payé ${fmt(paidAmt)} ${cur} sur ${fmt(totalAmt)} ${cur}</span>
             <span class="ab-sub" style="margin-top:6px"><strong>Réf. de paiement :</strong> ${inv.number || '—'} — indiquer cette référence sur le virement.</span>
             ${settings?.bank_iban ? `<span class="ab-sub"><strong>RIB / IBAN :</strong> ${settings.bank_iban}${settings?.bank_name ? ' · ' + settings.bank_name : ''}</span>` : ''}`}
      </div>`
    : isQuote
      ? `<div class="amount-banner quote">
          <span class="ab-label">Devis</span>
          <span class="ab-value">Document estimatif — non facturé</span>
          ${validity}
        </div>`
      : '';

  const partyLabel = isBill ? 'Fournisseur' : 'Client / Facturation';
  const sellerIds = [['ICE', settings?.ice], ['IF', settings?.if_number], ['RC', settings?.rc], ['TP', settings?.patente], ['CNSS', settings?.cnss]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');

  const docTax = Number(inv.tax_amount || 0);
  const isQuickDoc = bodyExtra === 'quick_sale' || inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR');
  const showTax = !isQuickDoc && (docTax > 0.001 || (!inv.tax_exempt && Number(settings?.tax_rate || 20) > 0));
  const promoDiscount = (items || []).reduce((s: number, it: any) => {
    const qty = Number(it.quantity || 0);
    const list = Number(it.list_price || 0);
    const unit = Number(it.unit_price ?? it.unit_cost ?? 0);
    const discAmt = Number(it.discount_amount || 0);
    const fromList = list > unit ? (list - unit) * qty : 0;
    return s + (discAmt > 0 ? discAmt : fromList);
  }, 0);

  const lineRows = (items || []).map((it: any) => {
    const qty = Number(it.quantity || 0);
    const unitSold = Number(it.unit_price ?? it.unit_cost ?? 0);
    const list = Number(it.list_price || 0);
    const tax = isQuickDoc ? 0 : (it.tax_rate != null ? Number(it.tax_rate) : (showTax ? (Number(settings?.tax_rate) || 20) : 0));
    // Formal docs: prices HT + TVA breakdown (Moroccan commercial norm). VR: flat amounts.
    const puHt = list > unitSold ? list : (list > 0 ? list : unitSold);
    const factor = tax > 0 ? (1 + tax / 100) : 1;
    const lineHt = qty * puHt;
    const lineTtc = Number(it.line_total) > 0 ? Number(it.line_total) : (isQuickDoc ? qty * unitSold : lineHt * factor);
    const unitLabel = it.unit ? String(it.unit) : '';
    if (isQuickDoc || !showTax) {
      return `<tr>
      <td>
        <div class="prod-name">${eh(it.product_name || '—')}</div>
        ${it.sku ? `<div class="prod-sku">SKU ${eh(it.sku)}</div>` : ''}
      </td>
      <td class="center">${qty}${unitLabel ? ` ${eh(unitLabel)}` : ''}</td>
      <td class="num">${fmt(isQuickDoc ? unitSold : puHt)}</td>
      <td class="num">${fmt(lineTtc)}</td>
    </tr>`;
    }
    return `<tr>
      <td>
        <div class="prod-name">${eh(it.product_name || '—')}</div>
        ${it.sku ? `<div class="prod-sku">SKU ${eh(it.sku)}</div>` : ''}
      </td>
      <td class="center">${qty}${unitLabel ? ` ${eh(unitLabel)}` : ''}</td>
      <td class="num">${fmt(puHt)}</td>
      <td class="num">${fmt(lineHt)}</td>
      <td class="center">${tax}%</td>
      <td class="num">${fmt(lineTtc)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${isQuickDoc || !showTax ? 4 : 6}">Aucune ligne</td></tr>`;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>${docLabel} ${inv.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:10mm 12mm;max-width:210mm;margin:0 auto;font-size:10pt;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Screen preview: mild sticky footer without forcing a full blank second page */
.sheet{
  position:relative;z-index:1;
  min-height:auto;
  display:block;
  padding:0;
  box-sizing:border-box;
}
.doc-main{display:block}
.doc-foot{display:block;margin-top:12px;padding-top:8px}
/* Default: allow natural page flow — do NOT avoid breaks on large wrappers */
.sheet,.doc-main,.doc-foot,.totals-wrap,.notes,.terms,.cgi-strip,.qr-panel,.amount-banner,.grid2,.top{
  break-inside:auto;page-break-inside:auto;
  break-before:auto;page-break-before:auto;
}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px}
.doc-title{font-size:20px;font-weight:800;letter-spacing:0.03em;color:#000;line-height:1.1}
${bodyExtra === 'quick_sale' ? `
.vr-banner{background:#000;color:#fff;padding:6px 10px;border-radius:2px;margin:0 0 8px;font-size:12px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;border:1px solid #000}
.vr-banner strong{font-size:13px;letter-spacing:.03em}
.vr-pill{display:inline-block;background:#fff;color:#000;font-weight:800;font-size:10px;padding:2px 8px;border:1px solid #000;border-radius:2px;text-transform:uppercase;letter-spacing:.04em}
table.lines th{background:#000!important}
.totals .grand{border-bottom-color:#000!important;color:#000}
` : ''}
.meta-table{font-size:12.5px;border-collapse:collapse}
.meta-table td{padding:2px 0 2px 16px;text-align:right}
.meta-table td:first-child{color:#666;font-weight:600;text-align:left;padding-left:0}
.rule{height:1px;background:#000;margin:6px 0 8px;border:0}
.seller{font-size:11px;margin-bottom:8px}
.seller .name{font-size:15px;font-weight:700}
.seller .ids{color:#555;font-size:11px;margin-top:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.box h3{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#555;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.box strong{font-size:14px}
.box div{font-size:12.5px;color:#333}
.amount-banner{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:6px 10px;margin:0 0 8px;border-radius:2px;border:1px solid #000;background:#fff}
.amount-banner.due{border-color:#000;background:#fff}
.amount-banner.paid{border-color:#000;background:#fff}
.amount-banner.quote{border-style:dashed;border-color:${accent}}
.ab-label{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#666;font-weight:600}
.ab-value{font-size:15px;font-weight:800;color:#000}
.ab-sub{font-size:12px;color:#555;width:100%}
table.lines{width:100%;border-collapse:collapse;margin-top:4px}
table.lines th{background:#000;color:#fff;text-align:left;padding:5px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
table.lines td{padding:4px 6px;border-bottom:1px solid #ccc;font-size:11px;vertical-align:top}
table.lines tr:nth-child(even) td{background:#fff}
.prod-name{font-weight:600}
.prod-sku{font-size:11px;color:#666;margin-top:2px}
.num{text-align:right;font-variant-numeric:tabular-nums}.center{text-align:center}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:6px}
.totals{width:280px}
.totals .row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #ddd}
.totals .grand{font-weight:800;font-size:13px;border-bottom:2px solid #000;padding-top:4px;margin-top:2px}
.notes{margin-top:8px;padding-top:6px;border-top:1px solid #000;font-size:11px}
.notes h3{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin-bottom:6px}
.qr-panel{display:flex;gap:8px;align-items:center;margin-top:6px;padding:4px 6px;border:1px solid #000;border-radius:2px;background:#fff}
.qr-img{border:3px solid #fff;box-shadow:0 0 0 1px #0f1b2d;flex-shrink:0}
.qr-meta{font-size:12.5px;line-height:1.5}
.qr-hint{font-size:11px;color:#666;margin-top:4px}
.amount-words{margin:14px 0 0;font-size:12px;color:#333;line-height:1.45;max-width:100%}
.cgi-strip{margin-top:10px;font-size:10.5px;color:#555;line-height:1.4}
.terms{margin-top:6px;padding-top:6px;border-top:1px solid #000;font-size:9px;color:#333;line-height:1.35}
.terms h3{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#333;margin-bottom:6px}
.bpa{margin-top:8px;padding:8px;border:1px dashed #000;border-radius:2px;background:#fff}
.bpa h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em}
.bpa-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
.bpa-l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:6px}
.bpa-line{border-bottom:1px solid #333;min-height:28px}
.bpa-line.tall{min-height:56px}
.footer{margin-top:6px;font-size:9px;color:#777;display:flex;justify-content:space-between;gap:12px}
.watermark{
  position:fixed;inset:0;pointer-events:none;z-index:0;
  display:flex;align-items:center;justify-content:center;
  font-size:40px;font-weight:800;letter-spacing:0.12em;opacity:0.06;
  transform:rotate(-28deg);color:#111;text-transform:uppercase;
  user-select:none;
}
/* Only atomic units avoid mid-split — not whole sections */
.keep-tight{page-break-inside:avoid;break-inside:avoid}
table.lines thead{display:table-header-group}
table.lines tfoot{display:table-footer-group}
table.lines tr{page-break-inside:avoid;break-inside:avoid}
/* Signature box alone may stay together; large containers flow */
.bpa{page-break-inside:avoid;break-inside:avoid}

@media print{
  .no-print{display:none!important}
  html,body{height:auto!important}
  body{padding:0;margin:0;max-width:none;font-size:10.5px;color:#000!important;background:#fff!important}
  .sheet,.doc-main,.doc-foot{
    min-height:0!important;
    height:auto!important;
    display:block!important;
    margin-top:0!important;
    padding:0!important;
    /* Fill current page; break only when content exceeds bottom margin */
    break-inside:auto!important;
    page-break-inside:auto!important;
    break-before:auto!important;
    page-break-before:auto!important;
  }
  @page{size:A4;margin:10mm 12mm 10mm 12mm}
  .watermark{display:none!important}
  a{color:inherit;text-decoration:none}
  table.lines th,.vr-banner{background:#000!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .amount-banner,.qr-panel,.bpa,.box,.notes{background:#fff!important;border-color:#000!important}
  .qr-img{width:88px!important;height:88px!important}
  .doc-title{font-size:18px!important}
  table.lines td{padding:3px 5px!important}
  /* Only the signature card stays unsplit — not the whole footer stack */
  .bpa,.keep-tight{page-break-inside:avoid;break-inside:avoid}
  table.lines tr{page-break-inside:avoid;break-inside:avoid}
}
@media(max-width:700px){.grid2,.top{grid-template-columns:1fr;flex-direction:column}.meta-table td{text-align:left!important}}
</style></head><body data-doc="${bodyExtra}">
<div class="watermark" aria-hidden="true">${docLabel}</div>
<div class="sheet">
${inv.preview_banner ? `<div style="border:1px solid #000;background:#fff8e8;color:#1a1814;padding:8px 10px;margin-bottom:10px;font-size:12px;line-height:1.45"><strong>Avertissement.</strong> ${eh(String(inv.preview_banner))}</div>` : ''}
<!-- 1. EN-TETE · 2. PARTIES · 3. LIGNES · 4. TOTAUX · 5. NOTES · 6. FOOT (conditions/BPA/QR/footer) -->
${autoPrint ? '' : `<div class="no-print" style="margin-bottom:12px"><button type="button" onclick="window.print()" style="background:${accent};color:#fff;border:0;padding:10px 18px;cursor:pointer;font-weight:600">Imprimer / PDF</button></div>`}
<div class="doc-main">
<div class="top">
  <div>
    ${logoBlock}
    <div class="doc-title">${docLabel}</div>
    ${bodyExtra === 'quick_sale' ? `<div class="vr-banner" style="margin-top:12px"><div><span class="vr-pill">Caisse · VR</span><div style="margin-top:6px;font-size:12px;opacity:.95">Ticket de vente rapide — stock déduit, encaissement immédiat.<br/>Série <strong>VR</strong> distincte des factures formalisées (FA).</div></div></div>` : ''}
    <div class="seller" style="margin-top:10px">
      <div class="name">${eh(settings?.company_name || '')}${settings?.legal_form ? ` · ${eh(settings.legal_form)}` : ''}</div>
      <div>${[settings?.address, settings?.city, settings?.postal_code].filter(Boolean).join(', ')}</div>
      <div>${[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</div>
      ${sellerIds ? `<div class="ids">${sellerIds}</div>` : ''}
    </div>
  </div>
  <div>
    <table class="meta-table">
      <tr><td>N° document</td><td><strong>${inv.number || '—'}</strong></td></tr>
      <tr><td>Date d'émission</td><td>${formatDate(inv.issue_date || '')}</td></tr>
      ${isRefund && inv.refund_of_invoice_id ? `<tr><td>Facture d’origine</td><td><strong>#${inv.refund_of_invoice_id}${inv._source_number ? ' · ' + inv._source_number : ''}</strong></td></tr>` : ''}
      ${isRefund && inv._source_number ? `<tr><td>Réf. facture</td><td><strong>${inv._source_number}</strong></td></tr>` : ''}
      ${!isQuote && !isRefund && inv.due_date ? `<tr><td>Échéance</td><td><strong>${formatDate(inv.due_date)}</strong></td></tr>` : ''}
      ${isQuote && inv.due_date ? `<tr><td>Validité</td><td>${formatDate(inv.due_date)}</td></tr>` : ''}
      <tr><td>Devise</td><td>${cur}</td></tr>
      ${isRefund ? `<tr><td>Type</td><td><strong>AVOIR / CRÉDIT (WR)</strong></td></tr>` : ''}
    </table>
  </div>
</div>
<hr class="rule"/>

<div class="grid2">
  <div class="box">
    <h3>${partyLabel}</h3>
    <strong>${eh(partyName || '—')}</strong>
    ${partyIce ? `<div>ICE : ${eh(partyIce)}</div>` : ''}
    ${partyAddr ? `<div>${eh(partyAddr)}</div>` : ''}
    ${partyCity ? `<div>${eh(partyCity)}</div>` : ''}
    ${inv.client_email ? `<div>${eh(inv.client_email)}</div>` : ''}
    ${inv.client_phone ? `<div>${eh(inv.client_phone)}</div>` : ''}
  </div>
  <div class="box">
    <h3>${isBill ? 'Référence' : 'Coordonnées de paiement'}</h3>
    ${!isBill && pdfShow('pdf_show_bank', true) && settings?.bank_name ? `<div><strong>Banque</strong> — ${settings.bank_name}</div>` : ''}
    ${!isBill && pdfShow('pdf_show_bank', true) && settings?.bank_iban ? `<div><strong>RIB / IBAN</strong> — ${settings.bank_iban}</div>` : ''}
    ${isBill ? `<div>Document d'achat fournisseur</div>` : (settings?.bank_iban ? '' : `<div>Règlement selon les conditions convenues.</div>`)}
  </div>
</div>

${paymentBox}

<table class="lines">
  <thead>
    <tr>
      <th>Désignation</th>
      <th class="center" style="width:56px">Qté</th>
      ${isQuickDoc || !showTax ? `
      <th class="num" style="width:100px">P.U.</th>
      <th class="num" style="width:110px">Total</th>` : `
      <th class="num" style="width:90px">P.U. HT</th>
      <th class="num" style="width:100px">Montant HT</th>
      <th class="center" style="width:56px">TVA</th>
      <th class="num" style="width:100px">Total TTC</th>`}
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals">
    <div class="row"><span>${showTax ? 'TOTAL HT' : 'Sous-total'}</span><span>${fmt(Number(inv.subtotal) + (promoDiscount > 0 ? promoDiscount : 0))} ${cur}</span></div>
    ${promoDiscount > 0.001 && pdfShow('pdf_show_promo', true) ? `<div class="row" style="color:#b45309"><span>Promo / remise</span><span>−${fmt(promoDiscount)} ${cur}</span></div>` : ''}
    ${showTax ? `<div class="row"><span>T.V.A ${(() => { const ht = Number(inv.subtotal)||0; const ta = Number(inv.tax_amount)||0; if (ht > 0.01) return Math.round((ta/ht)*100); return Number(settings?.tax_rate)||20; })()}%</span><span>${fmt(Number(inv.tax_amount))} ${cur}</span></div>` : ''}
    <div class="row grand"><span>${isRefund ? (showTax ? 'TOTAL T.T.C crédit' : 'Total crédit') : (showTax ? 'TOTAL T.T.C' : 'Total')}</span><span>${isRefund ? '−' : ''}${fmt(Number(inv.total))} ${cur}</span></div>
    ${isInvoice && !isRefund && paidAmt > 0 ? `<div class="row"><span>Déjà payé</span><span>${fmt(paidAmt)} ${cur}</span></div><div class="row"><span>Reste</span><span><strong>${fmt(dueAmt)} ${cur}</strong></span></div>` : ''}
  </div>
</div>
${isInvoice || isRefund ? `<p class="amount-words">Arrêté ${isRefund ? 'le présent avoir' : isQuickDoc ? 'le présent ticket de vente' : 'la présente facture'} à la somme de <strong>${amountInWordsFr(Math.abs(Number(inv.total) || 0), cur)}</strong>.</p>` : ''}

${isRefund ? `<div class="notes" style="border:1px solid #000;background:#fff;padding:6px 8px;border-radius:2px">
  <h3>Motif du crédit / remboursement</h3>
  <p>${eh(inv.refund_reason || inv.notes || '—').replace(/\n/g, '<br/>')}</p>
  <p style="margin-top:8px;font-size:11px;color:#5c3d1e">Ce crédit s’applique au solde du client ou donne lieu à un remboursement selon la situation de paiement de la facture d’origine. Les quantités listées sont réintégrées au stock.</p>
</div>` : ''}
${inv.notes && !isRefund ? `<div class="notes"><h3>Notes</h3><p>${eh(inv.notes)}</p></div>` : ''}
</div><!-- /.doc-main -->
<div class="doc-foot">
${isQuote ? `<div class="terms notes"><h3>Conditions du devis</h3>
  <p>Document <strong>estimatif</strong> — non facturé, non comptabilisé, stock non modifié tant qu'il n'est pas converti en facture.</p>
  ${validity}
  <p style="margin-top:8px">Validité commerciale : selon la date indiquée sur ce document. Les devis et factures actifs restent conservés ; seuls les documents <strong>déjà annulés</strong> peuvent être purgés après délai (politique interne).</p>
</div>
<div class="bpa keep-tight">
  <h3>Bon pour accord</h3>
  <p style="font-size:12px;color:#555;margin-bottom:14px">En signant, le client accepte le présent devis (sous réserve de conversion en facture).</p>
  <div class="bpa-grid">
    <div class="bpa-box"><div class="bpa-l">Date</div><div class="bpa-line"></div></div>
    <div class="bpa-box"><div class="bpa-l">Nom / qualité</div><div class="bpa-line"></div></div>
    <div class="bpa-box"><div class="bpa-l">Signature client</div><div class="bpa-line tall"></div></div>
    <div class="bpa-box"><div class="bpa-l">Cachet (si société)</div><div class="bpa-line tall"></div></div>
  </div>
</div>` : ''}
${/* Sales invoices + WR: always show refund policy (covers old docs when re-printed) */ ''}
${isInvoice && !isBill ? REFUND_POLICY_HTML : ''}
${(isInvoice || isQuote) && sellerIds ? `<div class="cgi-strip"><strong>Mentions légales émetteur</strong> — ${sellerIds}${settings?.address ? ' · ' + settings.address : ''}${settings?.city ? ', ' + settings.city : ''}. Document généré automatiquement — ne pas modifier.</div>` : ''}

${qrBlock}
${qrSitBlock}
${!isQuote ? companyStampBlock(settings) : ''}

<div class="footer">
  <span>${sellerIds || ''}</span>
  <span>${footerNote || (isQuote ? 'Devis' : isBill ? 'Achat' : isRefund ? 'Avoir WR' : 'Document de vente')}</span>
</div>
</div><!-- /.doc-foot -->
</div><!-- /.sheet -->
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}
</body></html>`;
}


/** Build absolute public URL for a document token */
export function publicDocUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/public/invoices/${token}`;
}

/**
 * Notify client by email (Resend) and/or return a WhatsApp deep-link when phone is present.
 * Non-blocking: failures are returned as warnings, never fail the main request.
 */
export async function notifyClientDocument(
  env: any,
  opts: {
    origin: string;
    token: string;
    number: string;
    docLabel: string; // Facture | Devis
    clientName: string;
    clientEmail?: string;
    clientPhone?: string;
    companyName: string;
    total?: number;
    currency?: string;
  },
): Promise<{ emailed: boolean; whatsapp_url?: string; error?: string }> {
  const link = publicDocUrl(opts.origin, opts.token);
  const result: { emailed: boolean; whatsapp_url?: string; error?: string } = { emailed: false };

  const phone = String(opts.clientPhone || '').replace(/[^\d+]/g, '');
  if (phone.length >= 8) {
    // Normalize Moroccan numbers to international without +
    let digits = phone.replace(/^\+/, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '212' + digits.slice(1);
    const text = encodeURIComponent(
      `Bonjour${opts.clientName ? ' ' + opts.clientName : ''},\n\nVoici votre ${opts.docLabel} ${opts.number} de ${opts.companyName}.\n\nConsultez / téléchargez le PDF ici :\n${link}\n\nMerci.`,
    );
    result.whatsapp_url = `https://wa.me/${digits}?text=${text}`;
  }

  const email = String(opts.clientEmail || '').trim();
  if (email.includes('@')) {
    const apiKey = (env as any).RESEND_API_KEY;
    if (apiKey) {
      try {
        const from = (env as any).RESEND_FROM || 'onboarding@resend.dev';
        const subject = `${opts.docLabel} ${opts.number} — ${opts.companyName}`;
        const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1814;line-height:1.5">
  <h2 style="margin:0 0 12px">${opts.docLabel} ${opts.number}</h2>
  <p>Bonjour${opts.clientName ? ' <strong>' + opts.clientName + '</strong>' : ''},</p>
  <p>Votre document est disponible en ligne. Vous pouvez le consulter et l'enregistrer en PDF depuis votre navigateur.</p>
  <p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1a1814;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Voir le document / PDF</a></p>
  <p style="font-size:13px;color:#666">Lien direct :<br/><a href="${link}">${link}</a></p>
  <p style="font-size:12px;color:#999;margin-top:10px;border-top:1px solid #eee;padding-top:12px">${opts.companyName}</p>
</div>`;
        const resendUrl = assertSafeOutboundUrl('https://api.resend.com/emails');
  const res = await fetch(resendUrl.toString(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [email], subject, html }),
        });
        if (res.ok) result.emailed = true;
        else {
          const data = await res.json().catch(() => ({})) as any;
          result.error = data.message || `Resend HTTP ${res.status}`;
        }
      } catch (e: any) {
        result.error = String(e?.message || e);
      }
    } else {
      result.error = 'RESEND_API_KEY non configuré';
    }
  }

  // SMS if phone present and gateway configured
  if (phone.length >= 8) {
    try {
      const smsBody = documentSmsBody({
        company: opts.companyName,
        docLabel: opts.docLabel,
        number: opts.number,
        link,
      });
      const sms = await sendSms(env as any, phone, smsBody);
      (result as any).sms_sent = sms.sent;
      (result as any).sms_provider = sms.provider;
      if (sms.error && !sms.sent) {
        result.error = (result.error ? result.error + ' · ' : '') + 'SMS: ' + sms.error;
      }
    } catch (e: any) {
      result.error = (result.error ? result.error + ' · ' : '') + String(e?.message || e);
    }
  }

  return result;
}

export function generateInvoiceEmailHTML(settings: any, invoice: any, items: any[], company: string): string {
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const lines = items.map((it: any) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${it.product_name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.unit_price)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.line_total)}</td></tr>`).join('');
  return `<div style="font-family:'DM Sans',system-ui,sans-serif;max-width:640px;margin:0 auto;color:#1a1814">
    <div style="border-bottom:3px solid #b87333;padding-bottom:20px;margin-bottom:10px">
      <h1 style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;color:#b87333;margin:0">Facture ${invoice.number}</h1>
      <p style="margin-top:8px"><strong>${company}</strong></p>
    </div>
    <p><strong>Facturé à :</strong> ${invoice.client_name}<br/>Date : ${invoice.issue_date}</p>
    <table width="100%" cellpadding="0" style="border-collapse:collapse;margin:16px 0">
      <thead><tr style="background:#faf8f4"><th align="left" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Désignation</th><th style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Qté</th><th align="right" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Prix unitaire</th><th align="right" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Total</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <p style="font-size:18px;margin-top:16px"><strong>Total : ${fmt(invoice.total)} ${cur}</strong></p>
    ${settings?.bank_name ? `<p style="font-size:13px;color:#7a756c;margin-top:16px">Banque : ${settings.bank_name} · RIB/IBAN : ${settings.bank_iban || '—'} · SWIFT : ${settings.bank_swift || '—'}</p>` : ''}
    <p style="color:#999;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">${settings?.company_name || ''} · ${settings?.email || ''} · ${settings?.phone || ''}</p>
  </div>`;
}
export function registerEmployeeFormPrintRoutes(
  app: Hono<any>,
  requireEmployeeAdmin: (c: any) => Promise<Response | null>,
): void {
  app.get('/api/employees/form/print', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    return c.html(generateEmployeeFormHTML(settings, null, { autoPrint: true }));
  });
  
  app.get('/api/employees/:id/form/print', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    const id = Number(c.req.param('id') || 0);
    if (!id) return c.html('<p>Employé manquant</p>', 400);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first() as any;
    if (!emp) return c.html('<p>Employé introuvable</p>', 404);
    return c.html(generateEmployeeFormHTML(settings, emp, { autoPrint: true }));
  });
}
