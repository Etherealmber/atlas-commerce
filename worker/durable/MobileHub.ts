import type { Env } from '../env';

/**
 * Free-tier SQLite Durable Object — shared live counters for phone + PC,
 * plus per-user profile cache (idFromName('profile:' + username)).
 * Keep writes sparse (on mutations only) to stay under free DO request limits.
 */
export type HubSnapshot = {
  pending: number;
  productCount: number;
  lowStock: number;
  stockValue: number;
  lastBarcode: string | null;
  lastProductId: number | null;
  lastActionAt: string | null;
  updatedAt: string | null;
};

export type UserProfile = {
  display_name: string;
  email: string;
  phone: string;
  avatar_url: string;
  notes: string;
  updatedAt: string | null;
};

const KEYS = [
  'pending',
  'productCount',
  'lowStock',
  'stockValue',
  'lastBarcode',
  'lastProductId',
  'lastActionAt',
  'updatedAt',
] as const;

const PROFILE_KEYS = [
  'display_name',
  'email',
  'phone',
  'avatar_url',
  'notes',
  'updatedAt',
] as const;

export class MobileHub {
  constructor(
    private readonly state: DurableObjectState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly env: Env
  ) {}

  private async readSnapshot(): Promise<HubSnapshot> {
    const bag = await this.state.storage.get([...KEYS]);
    return {
      pending: Number(bag.get('pending') ?? 0),
      productCount: Number(bag.get('productCount') ?? 0),
      lowStock: Number(bag.get('lowStock') ?? 0),
      stockValue: Number(bag.get('stockValue') ?? 0),
      lastBarcode: (bag.get('lastBarcode') as string) || null,
      lastProductId: bag.get('lastProductId') != null ? Number(bag.get('lastProductId')) : null,
      lastActionAt: (bag.get('lastActionAt') as string) || null,
      updatedAt: (bag.get('updatedAt') as string) || null,
    };
  }

  private async readProfile(): Promise<UserProfile> {
    const bag = await this.state.storage.get([...PROFILE_KEYS]);
    return {
      display_name: String(bag.get('display_name') ?? ''),
      email: String(bag.get('email') ?? ''),
      phone: String(bag.get('phone') ?? ''),
      avatar_url: String(bag.get('avatar_url') ?? ''),
      notes: String(bag.get('notes') ?? ''),
      updatedAt: (bag.get('updatedAt') as string) || null,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Per-user profile (object idFromName('profile:username')) ───
      if (path === '/profile' || path.endsWith('/profile')) {
        if (request.method === 'GET') {
          const data = await this.readProfile();
          return Response.json({ success: true, data });
        }
        if (request.method === 'PUT' || request.method === 'PATCH' || request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as Partial<UserProfile>;
          const now = new Date().toISOString();
          const cur = await this.readProfile();
          const next: UserProfile = {
            display_name:
              body.display_name != null ? String(body.display_name).trim().slice(0, 80) : cur.display_name,
            email: body.email != null ? String(body.email).trim().slice(0, 120) : cur.email,
            phone: body.phone != null ? String(body.phone).trim().slice(0, 40) : cur.phone,
            avatar_url:
              body.avatar_url != null ? String(body.avatar_url).trim().slice(0, 2000) : cur.avatar_url,
            notes: body.notes != null ? String(body.notes).trim().slice(0, 300) : cur.notes,
            updatedAt: now,
          };
          await this.state.storage.put({
            display_name: next.display_name,
            email: next.email,
            phone: next.phone,
            avatar_url: next.avatar_url,
            notes: next.notes,
            updatedAt: now,
          });
          return Response.json({ success: true, data: next });
        }
        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
      }

      if (request.method === 'GET' && (path === '/' || path === '/stats' || path === '/snapshot')) {
        const data = await this.readSnapshot();
        return Response.json({ success: true, data });
      }

      if (request.method === 'POST' && (path === '/sync' || path === '/snapshot')) {
        const body = (await request.json().catch(() => ({}))) as Partial<HubSnapshot>;
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { updatedAt: now };
        if (body.pending != null) patch.pending = Math.max(0, Math.floor(Number(body.pending)));
        if (body.productCount != null) patch.productCount = Math.max(0, Math.floor(Number(body.productCount)));
        if (body.lowStock != null) patch.lowStock = Math.max(0, Math.floor(Number(body.lowStock)));
        if (body.stockValue != null) patch.stockValue = Math.max(0, Number(body.stockValue));
        if (body.lastBarcode !== undefined) patch.lastBarcode = body.lastBarcode ? String(body.lastBarcode).slice(0, 64) : null;
        if (body.lastProductId !== undefined) {
          patch.lastProductId = body.lastProductId != null ? Number(body.lastProductId) : null;
        }
        if (body.lastActionAt) patch.lastActionAt = String(body.lastActionAt);
        else if (body.pending != null || body.lastBarcode || body.lastProductId) patch.lastActionAt = now;
        await this.state.storage.put(patch);
        const data = await this.readSnapshot();
        return Response.json({ success: true, data });
      }

      // Back-compat
      if (request.method === 'POST' && path === '/pending') {
        const body = (await request.json().catch(() => ({}))) as { pending?: number };
        await this.state.storage.put({
          pending: Math.max(0, Math.floor(Number(body.pending ?? 0))),
          updatedAt: new Date().toISOString(),
        });
        return Response.json({ success: true, data: await this.readSnapshot() });
      }

      if (request.method === 'POST' && path === '/bump') {
        const body = (await request.json().catch(() => ({}))) as { delta?: number };
        const cur = Number((await this.state.storage.get<number>('pending')) ?? 0);
        const pending = Math.max(0, cur + Number(body.delta ?? 1));
        await this.state.storage.put({ pending, updatedAt: new Date().toISOString() });
        return Response.json({ success: true, data: await this.readSnapshot() });
      }

      // ─── Short-lived QR login session (idFromName('qr:' + token)) ───
      // Keeps poll/claim off D1 to avoid Worker CPU limits. Alarm deletes after ~2 min.
      if (path === '/qr' || path.endsWith('/qr')) {
        if (request.method === 'GET') {
          const bag = await this.state.storage.get([
            'status', 'username', 'role', 'created_by', 'expires_at',
            'claim_fingerprint', 'display_name', 'avatar_url',
          ]);
          if (!bag.get('status')) {
            return Response.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
          }
          let status = String(bag.get('status') || 'pending');
          const exp = bag.get('expires_at') ? String(bag.get('expires_at')) : '';
          if (exp && status !== 'consumed' && status !== 'denied' && new Date(exp) < new Date()) {
            status = 'expired';
          }
          return Response.json({
            success: true,
            data: {
              status,
              username: String(bag.get('username') || ''),
              role: String(bag.get('role') || ''),
              created_by: String(bag.get('created_by') || ''),
              expires_at: exp,
              claim_fingerprint: bag.get('claim_fingerprint')
                ? String(bag.get('claim_fingerprint')).slice(0, 12) + '…'
                : '',
              has_device: !!bag.get('claim_fingerprint'),
              display_name: String(bag.get('display_name') || ''),
              avatar_url: String(bag.get('avatar_url') || ''),
            },
          });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const patch: Record<string, unknown> = {};
          for (const k of [
            'status', 'username', 'role', 'created_by', 'expires_at',
            'claim_fingerprint', 'claim_ua', 'claim_ip', 'display_name', 'avatar_url',
          ]) {
            if (body[k] !== undefined) patch[k] = body[k];
          }
          if (Object.keys(patch).length) {
            await this.state.storage.put(patch);
          }
          // Auto-delete ~130s after create/update to respect free-tier storage
          if (body.status === 'pending' || body._schedule_alarm) {
            await this.state.storage.setAlarm(Date.now() + 130_000);
          }
          if (body.status === 'consumed' || body.status === 'denied' || body.status === 'expired') {
            await this.state.storage.setAlarm(Date.now() + 15_000);
          }
          const bag = await this.state.storage.get(['status', 'username', 'role', 'expires_at', 'display_name', 'avatar_url', 'claim_fingerprint']);
          return Response.json({
            success: true,
            data: {
              status: bag.get('status'),
              username: bag.get('username'),
              role: bag.get('role'),
              expires_at: bag.get('expires_at'),
              display_name: bag.get('display_name'),
              avatar_url: bag.get('avatar_url'),
              has_device: !!bag.get('claim_fingerprint'),
            },
          });
        }
        return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
      }

      return Response.json({ success: false, error: 'Not found' }, { status: 404 });
    } catch (e: any) {
      return Response.json({ success: false, error: e?.message || 'DO error' }, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.state.storage.deleteAll();
    } catch { /* */ }
  }
}

