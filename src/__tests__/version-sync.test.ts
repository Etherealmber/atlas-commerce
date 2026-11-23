/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_BUILD_DATE, APP_CHANNEL, APP_VERSION } from '../version';
import { registerCanaryHealthRoutes } from '../../worker/routes/ledgerMisc';
import { Hono } from 'hono';

describe('version single source of truth & /api/health metadata', () => {
  it('matches package.json version with src/version.ts APP_VERSION', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.version).toBe(APP_VERSION);
  });

  it('exposes app_version, build_date, and channel on GET /api/health', async () => {
    const app = new Hono<any>();
    registerCanaryHealthRoutes(app as any, {
      WAF_STATS: { blocked: 0, lastAt: null, lastSig: null },
      requireOwner: () => ({ ok: false, response: new Response('denied', { status: 403 }) }),
    });
    const env = {
      ENVIRONMENT: 'test',
      DB: {
        prepare: () => ({
          first: async () => ({ ok: 1 }),
          all: async () => ({ results: [] }),
        }),
      },
    };
    const res = await app.fetch(new Request('http://localhost/api/health'), env as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.app_version).toBe(APP_VERSION);
    expect(body.data.build_date).toBe(APP_BUILD_DATE);
    expect(body.data.channel).toBe(APP_CHANNEL);
  });
});
