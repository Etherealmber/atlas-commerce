/**
 * Atomic document number sequences (FA / VR / DEV / …).
 * One DO instance: idFromName('doc-numbers').
 */
export class NumberHub {
  constructor(
    private readonly state: DurableObjectState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/next')) {
      const body = (await request.json().catch(() => ({}))) as {
        series?: string;
        floor?: number;
      };
      const series = String(body.series || 'invoice').slice(0, 64);
      const floor = Math.max(1, Number(body.floor) || 1);
      const key = `seq:${series}`;
      let cur = Number((await this.state.storage.get<number>(key)) || 0);
      if (cur < floor - 1) cur = floor - 1;
      const next = cur + 1;
      await this.state.storage.put(key, next);
      return Response.json({ success: true, data: { series, next } });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/seed')) {
      const body = (await request.json().catch(() => ({}))) as {
        series?: string;
        value?: number;
      };
      const series = String(body.series || 'invoice').slice(0, 64);
      const value = Math.max(0, Number(body.value) || 0);
      await this.state.storage.put(`seq:${series}`, value);
      return Response.json({ success: true, data: { series, value } });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/peek')) {
      const series = String(url.searchParams.get('series') || 'invoice').slice(0, 64);
      const cur = Number((await this.state.storage.get<number>(`seq:${series}`)) || 0);
      return Response.json({ success: true, data: { series, current: cur } });
    }
    return new Response('Not found', { status: 404 });
  }
}
