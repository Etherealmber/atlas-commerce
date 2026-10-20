/**
 * Lightweight input validation (no Zod dependency — Workers-friendly).
 * Use on write endpoints; return first error string or null if ok.
 */

export type FieldErrors = Record<string, string>;

export function requireString(v: unknown, field: string, opts?: { min?: number; max?: number }): string | null {
  if (v == null || typeof v !== 'string') return `${field} est requis`;
  const s = v.trim();
  if (!s) return `${field} est requis`;
  if (opts?.min != null && s.length < opts.min) return `${field} trop court (min ${opts.min})`;
  if (opts?.max != null && s.length > opts.max) return `${field} trop long (max ${opts.max})`;
  return null;
}

export function optionalString(v: unknown, field: string, opts?: { max?: number }): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return `${field} invalide`;
  if (opts?.max != null && v.length > opts.max) return `${field} trop long (max ${opts.max})`;
  return null;
}

export function requireNumber(v: unknown, field: string, opts?: { min?: number; max?: number }): string | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return `${field} doit être un nombre`;
  if (opts?.min != null && n < opts.min) return `${field} trop petit (min ${opts.min})`;
  if (opts?.max != null && n > opts.max) return `${field} trop grand (max ${opts.max})`;
  return null;
}

export function requireEmail(v: unknown, field = 'email'): string | null {
  const base = requireString(v, field, { max: 254 });
  if (base) return base;
  const s = String(v).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${field} invalide`;
  return null;
}

export function requireId(v: unknown, field = 'id'): string | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n <= 0) return `${field} invalide`;
  return null;
}

/** Collect first error from a list of checks (null = ok). */
export function firstError(...checks: Array<string | null | undefined>): string | null {
  for (const e of checks) if (e) return e;
  return null;
}

/** Merge field errors; return null if none. */
export function collectErrors(fields: FieldErrors): FieldErrors | null {
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Domain validators for write APIs */

export function validateClientWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const nameErr = requireString(body?.name, 'name', { min: 1, max: 200 });
  if (nameErr) errors.name = nameErr;
  const email = body?.email;
  if (email != null && String(email).trim()) {
    const e = requireEmail(email, 'email');
    if (e) errors.email = e;
  }
  if (body?.credit_limit != null && body.credit_limit !== '') {
    const n = requireNumber(body.credit_limit, 'credit_limit', { min: 0, max: 1e12 });
    if (n) errors.credit_limit = n;
  }
  if (body?.phone != null && String(body.phone).length > 40) errors.phone = 'phone trop long';
  if (body?.ice != null && String(body.ice).length > 40) errors.ice = 'ICE trop long';
  return collectErrors(errors);
}

export function validateProductWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const nameErr = requireString(body?.name, 'name', { min: 1, max: 200 });
  if (nameErr) errors.name = nameErr;
  if (body?.sku != null && String(body.sku).length > 80) errors.sku = 'sku trop long';
  if (body?.price != null && body.price !== '') {
    const n = requireNumber(body.price, 'price', { min: 0, max: 1e12 });
    if (n) errors.price = n;
  }
  if (body?.cost != null && body.cost !== '') {
    const n = requireNumber(body.cost, 'cost', { min: 0, max: 1e12 });
    if (n) errors.cost = n;
  }
  if (body?.stock_quantity != null && body.stock_quantity !== '') {
    const n = requireNumber(body.stock_quantity, 'stock_quantity', { min: 0, max: 1e9 });
    if (n) errors.stock_quantity = n;
  }
  return collectErrors(errors);
}

export function validateInvoiceWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const nameErr = requireString(body?.client_name, 'client_name', { min: 1, max: 200 });
  if (nameErr) errors.client_name = nameErr;
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    errors.items = 'Au moins une ligne est obligatoire';
  } else {
    let okLine = false;
    for (const it of body.items) {
      const qty = Number(it?.quantity ?? 0);
      if (qty > 0) okLine = true;
    }
    if (!okLine) errors.items = 'Chaque ligne doit avoir une quantité > 0';
  }
  return collectErrors(errors);
}

export function validateVendorWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const nameErr = requireString(body?.name, 'name', { min: 1, max: 200 });
  if (nameErr) errors.name = nameErr;
  if (body?.email != null && String(body.email).trim()) {
    const e = requireEmail(body.email, 'email');
    if (e) errors.email = e;
  }
  return collectErrors(errors);
}

export function validateExpenseWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const n = requireNumber(body?.amount, 'amount', { min: 0.01, max: 1e12 });
  if (n) errors.amount = n;
  if (body?.label != null || body?.description != null || body?.title != null) {
    const label = body.label ?? body.description ?? body.title;
    const e = optionalString(label, 'label', { max: 300 });
    if (e) errors.label = e;
  }
  return collectErrors(errors);
}

export function validateReceiptWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  const amount = body?.amount ?? body?.total;
  const n = requireNumber(amount, 'amount', { min: 0.01, max: 1e12 });
  if (n) errors.amount = n;
  return collectErrors(errors);
}

export function validateBillWrite(body: any): FieldErrors | null {
  const errors: FieldErrors = {};
  if (!Array.isArray(body?.items) || !body.items.length) {
    errors.items = 'Au moins une ligne est obligatoire';
  }
  if (body?.vendor_name != null) {
    const e = optionalString(body.vendor_name, 'vendor_name', { max: 200 });
    if (e) errors.vendor_name = e;
  }
  return collectErrors(errors);
}
