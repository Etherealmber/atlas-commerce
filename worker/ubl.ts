/**
 * UBL 2.1 Invoice XML export — preparation for Moroccan DGI e-invoicing (clearance).
 *
 * Status (2026): the implementing decree and national CIUS are still evolving.
 * This exporter produces a standards-based UBL 2.1 document with Moroccan identifiers
 * (ICE, IF, RC, TP) in PartyTaxScheme / PartyLegalEntity, ready to adapt when the
 * official DGI customization ID and API endpoint are published.
 *
 * Clearance workflow (target model):
 *   1. Generate UBL 2.1 (or CII) XML from the invoice
 *   2. Sign / seal with company certificate (when required)
 *   3. Submit to DGI platform (xHub / Simpl-TVA / PDP) for validation
 *   4. Receive clearance ID + sealed XML
 *   5. Deliver validated invoice to customer (PDF + embedded XML)
 *
 * This module covers step 1 only. Steps 2–4 need official specs + credentials.
 */

function xmlEsc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(n: number): string {
  return String(Math.round(Number(n || 0)));
}

function isoDate(d: string): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

export type UblInvoiceInput = {
  number: string;
  issueDate: string;
  dueDate?: string | null;
  currency?: string;
  notes?: string;
  status?: string;
  uuid?: string;
  supplier: {
    name: string;
    address?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
    email?: string;
    ice?: string;
    if_number?: string;
    rc?: string;
    patente?: string;
    cnss?: string;
    legal_form?: string;
    bank_iban?: string;
    bank_name?: string;
  };
  customer: {
    name: string;
    address?: string;
    city?: string;
    ice?: string;
    email?: string;
    phone?: string;
  };
  lines: {
    id: number | string;
    name: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    lineTotal: number; // HT or TTC depending on storage; we treat as TTC-ish if tax included
    lineHt: number;
    lineTax: number;
  }[];
  subtotal: number;
  taxAmount: number;
  total: number;
};

function partyBlock(
  role: 'supplier' | 'customer',
  p: UblInvoiceInput['supplier'] | UblInvoiceInput['customer'],
): string {
  const ice = (p as any).ice || '';
  const ifn = (p as any).if_number || '';
  const rc = (p as any).rc || '';
  const tp = (p as any).patente || '';
  const country = (p as any).country || 'MA';
  const scheme = ice ? 'MA:ICE' : 'MA:IF';
  const companyId = ice || ifn || '';

  const taxScheme = ice || ifn
    ? `<cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="${xmlEsc(scheme)}">${xmlEsc(companyId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
    : '';

  const legal = `
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEsc(p.name)}</cbc:RegistrationName>
        ${companyId ? `<cbc:CompanyID schemeID="${xmlEsc(scheme)}">${xmlEsc(companyId)}</cbc:CompanyID>` : ''}
        ${rc ? `<!-- RC: ${xmlEsc(rc)} -->` : ''}
        ${tp ? `<!-- TP/Patente: ${xmlEsc(tp)} -->` : ''}
      </cac:PartyLegalEntity>`;

  const contact =
    (p as any).email || (p as any).phone
      ? `<cac:Contact>
        ${(p as any).phone ? `<cbc:Telephone>${xmlEsc((p as any).phone)}</cbc:Telephone>` : ''}
        ${(p as any).email ? `<cbc:ElectronicMail>${xmlEsc((p as any).email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>`
      : '';

  return `<cac:Party>
      <cac:PartyName><cbc:Name>${xmlEsc(p.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${p.address ? `<cbc:StreetName>${xmlEsc(p.address)}</cbc:StreetName>` : ''}
        ${p.city ? `<cbc:CityName>${xmlEsc(p.city)}</cbc:CityName>` : ''}
        ${(p as any).postalCode ? `<cbc:PostalZone>${xmlEsc((p as any).postalCode)}</cbc:PostalZone>` : ''}
        <cac:Country><cbc:IdentificationCode>${xmlEsc(country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${taxScheme}
      ${legal}
      ${contact}
    </cac:Party>`;
}

/** Build UBL 2.1 Invoice XML string (UTF-8). */
export function buildUblInvoiceXml(input: UblInvoiceInput): string {
  const cur = input.currency || 'MAD';
  const uuid = input.uuid || crypto.randomUUID();

  // Group tax by rate
  const taxByRate = new Map<number, { taxable: number; tax: number }>();
  for (const line of input.lines) {
    const rate = Number(line.taxRate || 0);
    const prev = taxByRate.get(rate) || { taxable: 0, tax: 0 };
    prev.taxable += Number(line.lineHt || 0);
    prev.tax += Number(line.lineTax || 0);
    taxByRate.set(rate, prev);
  }
  if (!taxByRate.size && input.taxAmount) {
    taxByRate.set(20, { taxable: input.subtotal, tax: input.taxAmount });
  }

  const taxSubtotals = [...taxByRate.entries()]
    .map(
      ([rate, v]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${money(v.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${money(v.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${rate === 0 ? 'Z' : 'S'}</cbc:ID>
        <cbc:Percent>${money(rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
    )
    .join('');

  const linesXml = input.lines
    .map((line, i) => {
      const qty = Number(line.quantity || 0);
      const unit = Number(line.unitPrice || 0);
      const ht = Number(line.lineHt || qty * unit);
      const tax = Number(line.lineTax || 0);
      const rate = Number(line.taxRate || 0);
      return `
  <cac:InvoiceLine>
    <cbc:ID>${xmlEsc(String(line.id ?? i + 1))}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(ht)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${xmlEsc(line.name)}</cbc:Description>
      <cbc:Name>${xmlEsc(line.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${rate === 0 ? 'Z' : 'S'}</cbc:ID>
        <cbc:Percent>${money(rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${cur}">${money(unit)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('');

  const paymentMeans = input.supplier.bank_iban
    ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${xmlEsc(input.supplier.bank_iban)}</cbc:ID>
      ${input.supplier.bank_name ? `<cbc:Name>${xmlEsc(input.supplier.bank_name)}</cbc:Name>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
    : '';

  // Morocco-oriented customization placeholder until official CIUS is published
  const customizationId = 'urn:cen.eu:en16931:2017#compliant#urn:ma:dgi:cius:preview:1.0';
  const profileId = 'urn:ma:dgi:billing:01:1.0';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  UBL 2.1 Invoice — export préliminaire pour facturation électronique Maroc (DGI).
  UUID: ${uuid}
  Statut app: ${xmlEsc(input.status || '')}
  NOTE: CustomizationID / ProfileID sont des placeholders jusqu'à publication du CIUS officiel DGI.
  Ne pas soumettre à la plateforme nationale sans mise à jour des identifiants et signature.
-->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>${xmlEsc(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEsc(profileId)}</cbc:ProfileID>
  <cbc:ID>${xmlEsc(input.number)}</cbc:ID>
  <cbc:UUID>${xmlEsc(uuid)}</cbc:UUID>
  <cbc:IssueDate>${isoDate(input.issueDate)}</cbc:IssueDate>
  ${input.dueDate ? `<cbc:DueDate>${isoDate(input.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${input.notes ? `<cbc:Note>${xmlEsc(input.notes)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${xmlEsc(cur)}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    ${partyBlock('supplier', input.supplier)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${partyBlock('customer', input.customer)}
  </cac:AccountingCustomerParty>
  ${paymentMeans}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${money(input.taxAmount)}</cbc:TaxAmount>
    ${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(input.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${money(input.subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${money(input.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${money(input.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${linesXml}
</Invoice>
`;
}

export function invoiceToUblInput(settings: any, inv: any, items: any[]): UblInvoiceInput {
  const lines = (items || []).map((it: any, i: number) => {
    const qty = Number(it.quantity || 0);
    const unit = Number(it.unit_price ?? it.unit_cost ?? 0);
    const rate = Number(it.tax_rate ?? settings?.tax_rate ?? 20);
    const ht = qty * unit;
    const tax = ht * (rate / 100);
    return {
      id: it.id || i + 1,
      name: it.product_name || 'Article',
      quantity: qty,
      unitPrice: unit,
      taxRate: rate,
      lineTotal: Number(it.line_total ?? ht + tax),
      lineHt: ht,
      lineTax: tax,
    };
  });
  return {
    number: String(inv.number || ''),
    issueDate: String(inv.issue_date || ''),
    dueDate: inv.due_date || null,
    currency: settings?.currency || 'MAD',
    notes: inv.notes || '',
    status: inv.status,
    supplier: {
      name: settings?.company_name || '',
      address: settings?.address,
      city: settings?.city,
      postalCode: settings?.postal_code,
      country: settings?.country || 'MA',
      phone: settings?.phone,
      email: settings?.email,
      ice: settings?.ice,
      if_number: settings?.if_number,
      rc: settings?.rc,
      patente: settings?.patente,
      cnss: settings?.cnss,
      legal_form: settings?.legal_form,
      bank_iban: settings?.bank_iban,
      bank_name: settings?.bank_name,
    },
    customer: {
      name: inv.client_name || '',
      address: inv.client_address,
      city: inv.client_city,
      ice: inv.client_ice,
      email: inv.client_email,
      phone: inv.client_phone,
    },
    lines,
    subtotal: Number(inv.subtotal || 0),
    taxAmount: Number(inv.tax_amount || 0),
    total: Number(inv.total || 0),
  };
}

export type UblValidationIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
};

/**
 * Structural validation for UBL export (CGI + UBL 2.1 readiness).
 * Does not call DGI; flags missing mandatory fields before clearance.
 */
export function validateUblInvoice(input: UblInvoiceInput): {
  ok: boolean;
  errors: UblValidationIssue[];
  warnings: UblValidationIssue[];
} {
  const errors: UblValidationIssue[] = [];
  const warnings: UblValidationIssue[] = [];

  if (!String(input.number || '').trim()) {
    errors.push({ level: 'error', code: 'ID_MISSING', message: 'Numéro de facture manquant (cbc:ID).' });
  }
  if (!String(input.issueDate || '').trim()) {
    errors.push({ level: 'error', code: 'ISSUE_DATE', message: 'Date d’émission manquante.' });
  }
  if (!String(input.supplier?.name || '').trim()) {
    errors.push({ level: 'error', code: 'SUPPLIER_NAME', message: 'Raison sociale vendeur manquante.' });
  }
  const ice = String(input.supplier?.ice || '').replace(/\s/g, '');
  if (!ice || ice.length < 15) {
    errors.push({
      level: 'error',
      code: 'SUPPLIER_ICE',
      message: 'ICE vendeur obligatoire (15 chiffres) pour conformité CGI / e-facture.',
    });
  } else if (!/^\d{15}$/.test(ice)) {
    warnings.push({ level: 'warning', code: 'SUPPLIER_ICE_FORMAT', message: 'ICE vendeur non numérique sur 15 positions.' });
  }
  if (!String(input.supplier?.if_number || '').trim()) {
    warnings.push({ level: 'warning', code: 'SUPPLIER_IF', message: 'Identifiant fiscal (IF) vendeur recommandé.' });
  }
  if (!String(input.customer?.name || '').trim()) {
    errors.push({ level: 'error', code: 'CUSTOMER_NAME', message: 'Nom client manquant.' });
  }
  const clientIce = String(input.customer?.ice || '').replace(/\s/g, '');
  if (clientIce && !/^\d{15}$/.test(clientIce)) {
    warnings.push({ level: 'warning', code: 'CUSTOMER_ICE', message: 'ICE client présent mais format non standard (15 chiffres).' });
  } else if (!clientIce) {
    warnings.push({
      level: 'warning',
      code: 'CUSTOMER_ICE_MISSING',
      message: 'ICE client absent — requis pour déductibilité TVA B2B au Maroc.',
    });
  }
  if (!input.lines?.length) {
    errors.push({ level: 'error', code: 'NO_LINES', message: 'Aucune ligne de facture.' });
  }
  for (const [i, line] of (input.lines || []).entries()) {
    if (Number(line.quantity) <= 0) {
      errors.push({ level: 'error', code: 'LINE_QTY', message: `Ligne ${i + 1}: quantité invalide.` });
    }
    if (!String(line.name || '').trim()) {
      warnings.push({ level: 'warning', code: 'LINE_NAME', message: `Ligne ${i + 1}: description vide.` });
    }
  }
  if (!(Number(input.total) > 0) && input.status !== 'remboursement') {
    warnings.push({ level: 'warning', code: 'TOTAL_ZERO', message: 'Total TTC nul ou négatif.' });
  }
  // Monetary consistency (tolerance 1 MAD)
  const linesHt = (input.lines || []).reduce((s, l) => s + Number(l.lineHt || 0), 0);
  if (Math.abs(linesHt - Number(input.subtotal || 0)) > 1) {
    warnings.push({
      level: 'warning',
      code: 'SUBTOTAL_MISMATCH',
      message: `Sous-total HT (${input.subtotal}) ≠ somme lignes (${Math.round(linesHt)}).`,
    });
  }
  const cur = String(input.currency || 'MAD');
  if (cur !== 'MAD') {
    warnings.push({ level: 'warning', code: 'CURRENCY', message: `Devise ${cur} — DGI attend généralement MAD.` });
  }

  return { ok: errors.length === 0, errors, warnings };
}
