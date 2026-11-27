import { escapeHtml } from '../lib/security';
import { generateDeliveryNoteHTML } from '../lib/printTemplates';

interface DocPreviewDeps {
  requireEmployeeAdmin: (c: any) => Promise<Response | null>;
  sessionUserFromHeader: (h: string | undefined) => { username: string; role: string };
  authFailReason: (...a: any[]) => Promise<string>;
  generateInvoiceHTML: (...a: any[]) => string;
  generateReceiptHTML: (...a: any[]) => string;
  generateEmployeeFormHTML: (...a: any[]) => string;
  reportShell: (...a: any[]) => string;
  qrToSvg: (...a: any[]) => string;
  makeSecureQrPayload: (...a: any[]) => Promise<string>;
  mintPreviewReportTicket: (c: any) => Promise<string>;
  buildReportLinkQuery: (rt: string, periodKey: string, extra?: Record<string, string>) => string;
  previewEmbed: (html: string) => string;
}

/** Preview real templates with fictional transaction data, never customer records. */
export function registerDocPreviewRoutes(app: any, deps: DocPreviewDeps): void {
  app.get('/api/settings/invoice-preview', async (c: any) => {
    const type = String(c.req.query('type') || 'invoice').toLowerCase();
    const types = ['invoice', 'quote', 'receipt', 'bill', 'credit', 'report', 'employee', 'delivery'];
    if (!types.includes(type)) return c.text('Type de document inconnu', 400);
    if (type === 'employee' || type === 'report') {
      const denied = await deps.requireEmployeeAdmin(c);
      if (denied) return denied;
    }
    const settings = await c.env.DB.prepare('SELECT * FROM company_settings WHERE id = 1').first() as any;
    const tax = Number(settings?.tax_rate ?? 20);
    const sampleItems = [
      { product_name: 'Carrelage exemple', sku: 'DEMO-01', quantity: 2, unit_price: 100, tax_rate: tax, line_total: 200 * (1 + tax / 100) },
      { product_name: 'Colle exemple', sku: 'DEMO-02', quantity: 1, unit_price: 50, tax_rate: tax, line_total: 50 * (1 + tax / 100) },
    ];
    const date = new Date().toISOString().slice(0, 10);
    const note = 'DÉMO — données fictives, document non valable.';
    const total = Math.round(250 * (1 + tax / 100) * 100) / 100;
    const doc: any = { number: 'DEMO-0001', issue_date: date, status: type === 'quote' ? 'quote' : 'draft', client_name: 'Client Démo', vendor_name: 'Fournisseur Démo', client_ice: '000000000000000', client_city: 'Casablanca', subtotal: 250, tax_amount: total - 250, total, amount_paid: 0, notes: note, preview_qr: true, preview_qr_text: 'DÉMO — document fictif, sans vérification réelle', preview_banner: note };
    if (type === 'credit') { doc.doc_kind = 'remboursement'; doc.status = 'remboursement'; }
    let html: string;
    if (type === 'delivery') {
      html = generateDeliveryNoteHTML(settings, doc, sampleItems, { number: 'FACT-DÉMO-0001' }, false);
    } else if (type === 'receipt') {
      const receipt = { ...doc, amount: total, method: 'cash', _line_items: sampleItems };
      const situation = c.req.query('qr_situation') === '1' ? 'SITUATION DÉMO — données fictives' : '';
      html = deps.generateReceiptHTML(settings, receipt, situation, 'REÇU DÉMO — données fictives', { autoPrint: false });
    } else if (type === 'employee') {
      html = deps.generateEmployeeFormHTML(settings, { first_name: 'Amina', last_name: 'Démo', name: 'Amina Démo', emp_number: 'DEMO-0001', job_title: 'Vendeuse', hire_date: '2026-01-05', pay_amount: 4500, pay_cycle_type: 'monthly', notes: note }, { autoPrint: false });
    } else if (type === 'report') {
      const company = escapeHtml(String(settings?.company_name || 'Atlas Commerce'));
      const body = '<p>Exemple de rapport avec données fictives.</p><h2>Solde et mouvements</h2><p>Entrées : 3 000 MAD · Sorties : 1 000 MAD</p><h2>Créances clients</h2><p>Client Démo : 500 MAD</p><h2>Employés</h2><p>Amina Démo — Vendeuse</p>';
      html = deps.reportShell('Rapports combinés', company, 'Aperçu démo', body, settings?.report_footer || settings?.notes);
    } else {
      const titles: Record<string, string> = { invoice: 'FACTURE', quote: 'DEVIS', bill: "FACTURE D'ACHAT", credit: 'AVOIR' };
      html = deps.generateInvoiceHTML(settings, doc, sampleItems, titles[type], false);
    }
    const banner = '<div role="note" style="padding:12px;text-align:center;background:#fff3cd;color:#422b00;font: bold 14px sans-serif;border:1px solid #b8860b">APERÇU DÉMO — données fictives, document non valable. QR d’exemple non vérifiable.</div>';
    html = html.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
    return c.html(deps.previewEmbed(html));
  });
}
