import type { UblInvoiceInput } from '../ubl';
import { validateUblInvoice } from '../ubl';

export type DgiClearanceStatus =
  | 'draft'
  | 'ubl_ready'
  | 'queued'
  | 'submitted'
  | 'cleared'
  | 'rejected'
  | 'retrying';

interface DgiSubmitInput {
  invoiceId: number;
  invoiceNumber: string;
  companyIce: string;
  xml: string;
  sha256: string;
  ublInput: UblInvoiceInput;
}

interface DgiSubmitResult {
  status: 'cleared' | 'rejected' | 'retrying';
  is_stub: boolean;
  clearance_ref?: string;
  qr_payload?: string;
  stamp_payload?: string;
  signed_xml?: string;
  error?: string;
}

interface DgiAdapter {
  readonly isStub: boolean;
  submitInvoice(input: DgiSubmitInput): Promise<DgiSubmitResult>;
}

/**
 * Default adapter when DGI credentials are not configured.
 * Validates UBL using worker/ubl.ts, generates a deterministic simulated clearance stamp & QR payload,
 * and marks is_stub: true without ever blocking normal invoicing.
 */
export class StubDgiAdapter implements DgiAdapter {
  readonly isStub = true;

  async submitInvoice(input: DgiSubmitInput): Promise<DgiSubmitResult> {
    const v = validateUblInvoice(input.ublInput);
    if (!v.ok || !input.xml.trim()) {
      return {
        status: 'rejected',
        is_stub: true,
        error: v.errors.map((e) => e.message).join(' ; ') || 'UBL invalide',
      };
    }
    const shortHash = input.sha256.slice(0, 12).toUpperCase();
    const clearanceRef = `DGI-STUB-${input.invoiceId}-${shortHash}`;
    const qrPayload = `DGI-STUB-QR|ICE:${input.companyIce || 'NA'}|NUM:${input.invoiceNumber}|SHA256:${shortHash}`;
    const stampPayload = `SIMULATED_DGI_STAMP:${clearanceRef}`;
    return {
      status: 'cleared',
      is_stub: true,
      clearance_ref: clearanceRef,
      qr_payload: qrPayload,
      stamp_payload: stampPayload,
      signed_xml: input.xml,
    };
  }
}

/**
 * Live HTTP adapter ready for official Moroccan DGI e-invoicing clearance API.
 * Activated automatically when DGI_BASE_URL, DGI_CLIENT_ID, and DGI_CLIENT_SECRET are present.
 */
export class HttpDgiAdapter implements DgiAdapter {
  readonly isStub = false;
  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async getAccessToken(): Promise<string> {
    const tokenRes = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`DGI OAuth HTTP ${tokenRes.status}`);
    }
    const json = (await tokenRes.json().catch(() => ({}))) as any;
    if (!json?.access_token) throw new Error('DGI OAuth access_token manquant');
    return String(json.access_token);
  }

  async submitInvoice(input: DgiSubmitInput): Promise<DgiSubmitResult> {
    try {
      const token = await this.getAccessToken();
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}/v1/invoices/clearance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Client-Id': this.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_number: input.invoiceNumber,
          company_ice: input.companyIce,
          ubl_sha256: input.sha256,
          ubl_xml: input.xml,
        }),
      });
      if (res.status >= 500 || res.status === 429) {
        return {
          status: 'retrying',
          is_stub: false,
          error: `DGI temporairement indisponible (HTTP ${res.status})`,
        };
      }
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || data?.status === 'rejected') {
        return {
          status: 'rejected',
          is_stub: false,
          error: data?.message || data?.error || `Rejet DGI (HTTP ${res.status})`,
        };
      }
      return {
        status: 'cleared',
        is_stub: false,
        clearance_ref: String(data?.clearance_ref || data?.reference || ''),
        qr_payload: String(data?.qr_payload || ''),
        stamp_payload: String(data?.stamp_payload || ''),
        signed_xml: typeof data?.signed_xml === 'string' && data.signed_xml ? data.signed_xml : input.xml,
      };
    } catch (e: any) {
      return {
        status: 'retrying',
        is_stub: false,
        error: String(e?.message || e),
      };
    }
  }
}

export function isDgiLiveConfigured(env: {
  DGI_BASE_URL?: string;
  DGI_CLIENT_ID?: string;
  DGI_CLIENT_SECRET?: string;
}): boolean {
  return Boolean(
    String(env?.DGI_BASE_URL || '').trim() &&
      String(env?.DGI_CLIENT_ID || '').trim() &&
      String(env?.DGI_CLIENT_SECRET || '').trim(),
  );
}

export function selectDgiAdapter(env: {
  DGI_BASE_URL?: string;
  DGI_CLIENT_ID?: string;
  DGI_CLIENT_SECRET?: string;
}): DgiAdapter {
  if (isDgiLiveConfigured(env)) {
    return new HttpDgiAdapter(
      String(env.DGI_BASE_URL).trim(),
      String(env.DGI_CLIENT_ID).trim(),
      String(env.DGI_CLIENT_SECRET).trim(),
    );
  }
  return new StubDgiAdapter();
}
