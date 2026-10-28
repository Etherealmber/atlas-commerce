/**
 * v0.7.1 — Document preview routes, extracted from worker/index.ts
 * (same path /api/settings/invoice-preview, same behaviour — mechanical move,
 * deps injected). Previews never auto-print, embed <base target="_self"> so
 * every link opens inside the modal popup, and carry QR + DÉMO markings.
 */
export interface DocPreviewDeps {
  sessionUserFromHeader: (h: string | undefined) => { username: string; role: string };
  authFailReason: (...a: any[]) => Promise<string>;
  generateInvoiceHTML: (...a: any[]) => string;
  generateReceiptHTML: (...a: any[]) => string;
  generateEmployeeFormHTML: (...a: any[]) => string;
  reportShell: (...a: any[]) => string;
  qrToSvg: (...a: any[]) => string;
  makeSecureQrPayload: (...a: any[]) => Promise<string>;
  previewEmbed: (html: string) => string;
}

export function registerDocPreviewRoutes(app: any, deps: DocPreviewDeps): void {
app.get('/api/settings/invoice-preview', async (c: any) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const type = String(c.req.query('type') || 'invoice').toLowerCase();
  const pad = Math.min(8, Math.max(3, Number(settings?.numbering_pad || 4)));
  const tax = Number(settings?.tax_rate ?? 20);
  const company = settings?.company_name || 'Atlas Commerce';
  const DISCLAIMER = 'Document d’aperçu. Les montants réels proviennent de votre dernier enregistrement quand il existe. Ceci n’est pas une pièce comptable à remettre au client. Le QR reprend le résumé (type, numéro, partie, totaux) tel qu’il apparaîtra sur le PDF.';

  // v0.7.1 — données de démo réalistes (3 lignes) quand aucun document réel.
  const demoQty: [string, string, number, number][] = [
    ['Carrelage grès cérame 60×60', 'CR-6060', 12, 89],
    ['Colle à carrelage C2 (25 kg)', 'CL-C2', 4, 62],
    ['Joint hydrofuge gris (5 kg)', 'JT-G5', 2, 45],
  ];
  const sampleItems = demoQty.map(([product_name, sku, quantity, unit_price]) => ({
    product_name, sku, quantity, unit_price, tax_rate: tax,
    line_total: Math.round(quantity * unit_price * (1 + tax / 100) * 100) / 100,
  }));
  const DEMO_NOTE = 'Aperçu DÉMO — document non réel, généré avec des données d’exemple. Ne pas remettre au client.';

  async function latest(sql: string, ...binds: unknown[]) {
    try {
      return await c.env.DB.prepare(sql).bind(...binds).first() as any;
    } catch {
      return null;
    }
  }
  async function lines(sql: string, id: number) {
    try {
      const r = await c.env.DB.prepare(sql).bind(id).all();
      return (r.results || []) as any[];
    } catch {
      return [];
    }
  }

  const titles: Record<string, string> = {
    invoice: 'FACTURE', quote: 'DEVIS', receipt: 'REÇU', bill: "FACTURE D'ACHAT", credit: 'AVOIR',
  };

  if (type === 'report') {
    const cur = settings?.currency || 'MAD';
    const rptQr = deps.qrToSvg(`RAPPORT — ${company} · 30 derniers jours · généré le ${new Date().toLocaleString('fr-FR')} · APERÇU DÉMO`, 96, 2);
    const body = `<div class="watermark" aria-hidden="true">DÉMO</div>
      <h2>Rapport d'activité — 30 derniers jours</h2>
      <p class="muted">TVA configurée : ${tax}% · devise ${cur} · chiffres DÉMO quand aucune donnée réelle.</p>
      <table><thead><tr><th>Libellé</th><th>Montant</th></tr></thead><tbody>
        <tr><td>Ventes encaissées</td><td>12 500,00 ${cur}</td></tr>
        <tr><td>Sorties (achats & frais)</td><td>4 320,00 ${cur}</td></tr>
        <tr><td><strong>Résultat net</strong></td><td><strong>8 180,00 ${cur}</strong></td></tr>
      </tbody></table>
      <h2>Top articles (démo)</h2>
      <table><thead><tr><th>Article</th><th>Qté</th><th>Montant TTC</th></tr></thead><tbody>
        <tr><td>Carrelage grès cérame 60×60</td><td>12</td><td>1 281,60 ${cur}</td></tr>
        <tr><td>Colle à carrelage C2 (25 kg)</td><td>4</td><td>297,60 ${cur}</td></tr>
        <tr><td>Joint hydrofuge gris (5 kg)</td><td>2</td><td>108,00 ${cur}</td></tr>
      </tbody></table>
      <div style="margin:14px 0;padding:10px;border:1px dashed #999;text-align:center">
        <img src="${rptQr}" width="96" height="96" alt="QR résumé du rapport"/><br/>
        <span class="muted">QR résumé — aperçu DÉMO</span><br/>
        <a href="${c.req.url}">Rouvrir ce rapport dans l'aperçu</a>
      </div>
      <p style="border:1px solid #000;padding:8px;background:#fff8e8"><strong>Avertissement.</strong> ${DISCLAIMER}</p>`;
    return c.html(deps.previewEmbed(deps.reportShell('Rapport', company, 'Aperçu — 30 jours', body, settings?.report_footer || settings?.notes)));
  }

  if (type === 'employee') {
    let emp: any = null;
    try { emp = await latest(`SELECT * FROM employees ORDER BY id DESC LIMIT 1`); } catch { emp = null; }
    const demoEmp = emp || {
      first_name: 'Amina', last_name: 'Démo', name: 'Amina Démo',
      emp_number: 'EMP-0001', employee_number: 'EMP-0001',
      job_title: 'Vendeuse — showroom', hire_date: '2026-01-05',
      phone: '+212 6 00 00 00 00', email: 'amina.demo@atlas.ma',
      address: '12, rue Démo', city: 'Casablanca',
      cin: 'BE123456', cnss: '1234567',
      pay_amount: 4500, pay_cycle_type: 'monthly',
      status: 'actif', notes: 'Fiche DÉMO — aucune fiche réelle en base.',
    };
    return c.html(deps.previewEmbed(deps.generateEmployeeFormHTML(settings, demoEmp, { autoPrint: false })));
  }

  // v0.7.1 — REÇU : le VRAI format reçu (générateur dédié), pas la facture.
  if (type === 'receipt') {
    const rc = await latest(`SELECT * FROM receipts ORDER BY id DESC LIMIT 1`);
    let rItems: any[] = [];
    if (rc?.invoice_id) {
      try {
        const rr = await c.env.DB.prepare(
          `SELECT product_name, sku, quantity, unit_price, tax_rate, line_total
           FROM invoice_items WHERE invoice_id = ? ORDER BY id`,
        ).bind(rc.invoice_id).all();
        rItems = (rr.results || []) as any[];
      } catch { rItems = []; }
    }
    const tot = Math.round(sampleItems.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
    const receiptDoc: any = rc
      ? { ...rc, _line_items: rItems.length ? rItems : sampleItems }
      : {
          number: `${settings?.receipt_prefix || 'REC-'}0001`,
          issue_date: new Date().toISOString().slice(0, 10),
          amount: tot, method: 'cash', status: 'paid',
          client_name: 'Marbrerie Démo SARL',
          notes: DEMO_NOTE,
          _line_items: sampleItems,
        };
    let rVerify = '';
    if (rc?.public_token) {
      try {
        const signed = await deps.makeSecureQrPayload(c.env, 'receipt', String(rc.public_token), 0, c.env.DB);
        rVerify = `${new URL(c.req.url).origin}/api/public/verify?p=${encodeURIComponent(signed)}`;
      } catch { rVerify = ''; }
    } else {
      rVerify = `APERÇU DÉMO — REÇU ${receiptDoc.number} · ${receiptDoc.amount} ${settings?.currency || 'MAD'} · document non réel`;
    }
    return c.html(deps.previewEmbed(deps.generateReceiptHTML(settings, receiptDoc, undefined, rVerify, { autoPrint: false })));
  }

  let doc: any = null;
  let items: any[] = [];
  let real = false;
  if (type === 'bill') {
    doc = await latest(`SELECT * FROM bills ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM bill_items WHERE bill_id = ?`, doc.id); real = true; }
  } else if (type === 'quote') {
    doc = await latest(`SELECT * FROM invoices WHERE status IN ('quote','devis') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id); real = true; }
  } else if (type === 'credit') {
    doc = await latest(`SELECT * FROM invoices WHERE number LIKE 'WR%' OR status IN ('refund','credit','avoir') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) {
      items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id);
      real = true;
      doc.doc_kind = 'remboursement'; // force le vrai layout AVOIR/WR
    }
  } else {
    doc = await latest(`SELECT * FROM invoices WHERE IFNULL(status,'') NOT IN ('quote','devis') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id); real = true; }
  }

  const prefix = (type === 'quote' ? settings?.quote_prefix : type === 'bill' ? settings?.bill_prefix : type === 'receipt' ? settings?.receipt_prefix : type === 'credit' ? settings?.credit_prefix : settings?.invoice_prefix) || '';
  const title = titles[type] || titles.invoice;
  if (!doc) {
    const ht = 100;
    const taxAmt = Math.round(ht * (tax / 100) * 100) / 100;
    doc = {
      number: `${prefix || 'DEMO-'}${String(1).padStart(pad, '0')}`,
      issue_date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      client_name: 'Marbrerie Démo SARL',
      client_ice: settings?.ice || '002345678000099',
      client_city: settings?.city || 'Casablanca',
      subtotal: ht,
      tax_amount: taxAmt,
      total: ht + taxAmt,
      amount_paid: 0,
      notes: DEMO_NOTE,
    };
    items = sampleItems;
    if (type === 'credit') {
      doc.doc_kind = 'remboursement';
      doc.status = 'remboursement';
      doc.number = `${settings?.credit_prefix || 'WR-'}0001`;
    }
    if (type === 'quote') {
      doc.status = 'quote';
      doc.due_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    }
  }

  const summary = [
    'ATLAS COMMERCE',
    title,
    String(doc.number || ''),
    `Partie: ${doc.client_name || doc.vendor_name || '—'}`,
    `Total: ${Number(doc.total || 0).toFixed(2)} ${settings?.currency || 'MAD'}`,
    `Emetteur: ${company}`,
    real ? 'Source: dernier document enregistré' : 'Source: modele (aucun document)',
    'Apercu non contractuel',
  ].join('\n');

  doc.preview_qr = true;
  doc.preview_qr_text = summary;
  // v0.7 — Reçu : l'aperçu peut montrer (ou non) le QR « situation client »,
  // choisi dans l'app via ?qr_situation=1|0 (défaut = réglage de l'entreprise).
  if (type === 'receipt') {
    const qsSit = String(c.req.query('qr_situation') || '').toLowerCase();
    const sitOn = qsSit === '1' || qsSit === 'true'
      ? true
      : qsSit === '0' || qsSit === 'false'
        ? false
        : Number(settings?.qr_client_situation ?? 0) === 1;
    if (sitOn) {
      doc.preview_situation_qr = true;
      doc.preview_situation_text = [
        'ATLAS COMMERCE — SITUATION CLIENT (APERCU)',
        `Partie: ${doc.client_name || doc.vendor_name || '—'}`,
        `Total du recu: ${Number(doc.total || 0).toFixed(2)} ${settings?.currency || 'MAD'}`,
        "Exemple de QR situation tel qu'imprime sur le recu reel si l'option est activee.",
        'Apercu non contractuel',
      ].join('\n');
    }
  }
  doc.preview_banner = DISCLAIMER + (real ? ' Données : dernier document réel de ce type.' : ' Aucun document de ce type — modèle avec votre société et un article exemple.');

  return c.html(deps.previewEmbed(deps.generateInvoiceHTML(settings, doc, items.length ? items : sampleItems, title, false)));
});

/* ─── Categories & Units ─── */

const DEFAULT_CATEGORIES: { name: string; description: string; sort_order: number }[] = [
  { name: 'Général', description: 'Catégorie par défaut', sort_order: 0 },
  { name: 'Alimentation', description: 'Produits alimentaires', sort_order: 10 },
  { name: 'Boissons', description: 'Boissons et liquides', sort_order: 20 },
  { name: 'Électronique', description: 'Appareils et composants électroniques', sort_order: 30 },
  { name: 'Informatique', description: 'Matériel et accessoires informatiques', sort_order: 40 },
  { name: 'Vêtements', description: 'Textile et habillement', sort_order: 50 },
  { name: 'Cosmétiques', description: 'Beauté et soins', sort_order: 60 },
  { name: 'Quincaillerie', description: 'Outils et quincaillerie', sort_order: 70 },
  { name: 'Fournitures de bureau', description: 'Papeterie et bureau', sort_order: 80 },
  { name: 'Hygiène', description: 'Produits d\'hygiène et entretien', sort_order: 90 },
  { name: 'Emballage', description: 'Conditionnement et emballage', sort_order: 100 },
  { name: 'Matières premières', description: 'Matières premières', sort_order: 110 },
  { name: 'Pièces détachées', description: 'Pièces et rechanges', sort_order: 120 },
  { name: 'Services', description: 'Prestations de service', sort_order: 130 },
  { name: 'Autre', description: 'Divers', sort_order: 999 },
];

const DEFAULT_UNITS: { name: string; symbol: string; sort_order: number }[] = [
  { name: 'unité', symbol: 'u', sort_order: 0 },
  { name: 'pièce', symbol: 'pce', sort_order: 10 },
  { name: 'kg', symbol: 'kg', sort_order: 20 },
  { name: 'g', symbol: 'g', sort_order: 30 },
  { name: 'L', symbol: 'L', sort_order: 40 },
  { name: 'mL', symbol: 'mL', sort_order: 50 },
  { name: 'm', symbol: 'm', sort_order: 60 },
  { name: 'cm', symbol: 'cm', sort_order: 70 },
  { name: 'm²', symbol: 'm²', sort_order: 80 },
  { name: 'm³', symbol: 'm³', sort_order: 90 },
  { name: 'boîte', symbol: 'bte', sort_order: 100 },
  { name: 'carton', symbol: 'ctn', sort_order: 110 },
  { name: 'paquet', symbol: 'paq', sort_order: 120 },
  { name: 'lot', symbol: 'lot', sort_order: 130 },
  { name: 'sac', symbol: 'sac', sort_order: 140 },
  { name: 'bouteille', symbol: 'btl', sort_order: 150 },
  { name: 'pack', symbol: 'pack', sort_order: 160 },
  { name: 'douzaine', symbol: 'dz', sort_order: 170 },
  { name: 'heure', symbol: 'h', sort_order: 180 },
  { name: 'jour', symbol: 'j', sort_order: 190 },
  { name: 'forfait', symbol: 'forf', sort_order: 200 },
  { name: 'service', symbol: 'svc', sort_order: 210 },
];
}
