/** Client-side field validation — messages FR clairs */

export type FieldErrors = Record<string, string>;

export function firstError(errors: FieldErrors): string | null {
  const k = Object.keys(errors).find((key) => errors[key]);
  return k ? errors[k] : null;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function validateClientForm(form: {
  name?: string;
  ice?: string;
  email?: string;
  phone?: string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(form.name || '').trim()) e.name = 'Le nom du client est obligatoire.';
  const ice = String(form.ice || '').replace(/\s/g, '');
  if (ice && !/^\d{15}$/.test(ice)) e.ice = 'ICE : 15 chiffres (sans espaces).';
  const email = String(form.email || '').trim();
  if (email && !isEmail(email)) e.email = 'Adresse e-mail invalide.';
  const phone = String(form.phone || '').replace(/[\s.\-]/g, '');
  if (phone && phone.length < 8) e.phone = 'Numéro de téléphone trop court.';
  return e;
}

export function validateVendorForm(form: {
  name?: string;
  ice?: string;
  email?: string;
  phone?: string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(form.name || '').trim()) e.name = 'Le nom du fournisseur est obligatoire.';
  const ice = String(form.ice || '').replace(/\s/g, '');
  if (ice && !/^\d{15}$/.test(ice)) e.ice = 'ICE : 15 chiffres (sans espaces).';
  const email = String(form.email || '').trim();
  if (email && !isEmail(email)) e.email = 'Adresse e-mail invalide.';
  return e;
}

export function validateProductForm(form: {
  name?: string;
  price?: number | string;
  cost?: number | string;
  stock_quantity?: number | string;
  sku?: string;
  tax_rate?: number | string | null;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(form.name || '').trim()) e.name = 'Le nom du produit est obligatoire.';
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) e.price = 'Prix de vente invalide (nombre ≥ 0).';
  if (form.cost !== undefined && form.cost !== '' && form.cost !== null) {
    const cost = Number(form.cost);
    if (!Number.isFinite(cost) || cost < 0) e.cost = 'Coût d’achat invalide (nombre ≥ 0).';
  }
  if (form.tax_rate !== undefined && form.tax_rate !== '' && form.tax_rate !== null) {
    const tr = Number(form.tax_rate);
    if (!Number.isFinite(tr) || tr < 0 || tr > 100) e.tax_rate = 'TVA : entre 0 et 100 %.';
  }
  return e;
}

export function validateInvoiceForm(opts: {
  client_name?: string;
  items?: { product_name?: string; quantity?: number; unit_price?: number }[];
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(opts.client_name || '').trim()) e.client_name = 'Le client est obligatoire.';
  const items = opts.items || [];
  if (!items.length || items.every((i) => !String(i.product_name || '').trim())) {
    e.items = 'Ajoutez au moins une ligne avec une désignation.';
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!String(it.product_name || '').trim()) continue;
    if (!(Number(it.quantity) > 0)) e[`item_qty_${i}`] = `Ligne ${i + 1} : quantité invalide.`;
    if (!(Number(it.unit_price) >= 0) || !Number.isFinite(Number(it.unit_price))) {
      e[`item_price_${i}`] = `Ligne ${i + 1} : prix unitaire invalide.`;
    }
  }
  return e;
}

export function validateBillForm(opts: {
  vendor_name?: string;
  items?: { product_name?: string; quantity?: number; unit_cost?: number }[];
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(opts.vendor_name || '').trim()) e.vendor_name = 'Le fournisseur est obligatoire.';
  const items = opts.items || [];
  if (!items.length || items.every((i) => !String(i.product_name || '').trim())) {
    e.items = 'Ajoutez au moins une ligne d’achat.';
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!String(it.product_name || '').trim()) continue;
    if (!(Number(it.quantity) > 0)) e[`item_qty_${i}`] = `Ligne ${i + 1} : quantité invalide.`;
    if (!(Number(it.unit_cost) >= 0) || !Number.isFinite(Number(it.unit_cost))) {
      e[`item_cost_${i}`] = `Ligne ${i + 1} : coût unitaire invalide.`;
    }
  }
  return e;
}

export function validateBalanceEntry(opts: {
  description?: string;
  amount?: number | string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(opts.description || '').trim()) e.description = 'La description est obligatoire.';
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) e.amount = 'Montant invalide (nombre > 0).';
  return e;
}

export function validateLoginForm(opts: {
  username?: string;
  password?: string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(opts.username || '').trim()) e.username = 'Identifiant obligatoire.';
  if (!String(opts.password || '')) e.password = 'Mot de passe obligatoire.';
  return e;
}

export function validateSettingsCompany(form: {
  company_name?: string;
  email?: string;
  tax_rate?: number | string | null;
  phone?: string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!String(form.company_name || '').trim()) e.company_name = 'Le nom de la société est obligatoire.';
  const email = String(form.email || '').trim();
  if (email && !isEmail(email)) e.email = 'Adresse e-mail invalide.';
  if (form.tax_rate != null && form.tax_rate !== '') {
    const tr = Number(form.tax_rate);
    if (!Number.isFinite(tr) || tr < 0 || tr > 100) e.tax_rate = 'Taux de TVA : entre 0 et 100 %.';
  }
  return e;
}


/** French hints for common input constraints */
export const FR_HINT = {
  required: 'Ce champ est obligatoire.',
  numbersOnly: 'Chiffres uniquement.',
  positiveNumber: 'Entrez un nombre valide (≥ 0).',
  email: 'Adresse e-mail invalide.',
  phone: 'Numéro de téléphone invalide.',
  ice: 'ICE : 15 chiffres (sans espaces).',
  minLength: (n: number) => `Au moins ${n} caractères.`,
} as const;

export function requireNonEmpty(v: unknown, label = 'Ce champ'): string | null {
  if (!String(v ?? '').trim()) return `${label} est obligatoire.`;
  return null;
}

export function requireNumber(v: unknown, label = 'Valeur'): string | null {
  const s = String(v ?? '').trim();
  if (!s) return `${label} est obligatoire.`;
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return 'Chiffres uniquement (décimales autorisées).';
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) return 'Nombre invalide.';
  return null;
}

export function requireDigits(v: unknown, label = 'Ce champ'): string | null {
  const s = String(v ?? '').replace(/\s/g, '');
  if (!s) return `${label} est obligatoire.`;
  if (!/^\d+$/.test(s)) return 'Chiffres uniquement.';
  return null;
}
