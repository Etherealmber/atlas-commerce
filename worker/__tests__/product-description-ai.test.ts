import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cleanProductDescription, extractProductDescriptionInput, productDescriptionSystem } from '../lib/assist';

describe('product description AI helpers & route behavior', () => {
  it('rejects empty product names and the legacy "produit marbre" fallback', () => {
    expect(extractProductDescriptionInput({}, 'Rédige la description catalogue pour: .')).toBeNull();
    expect(extractProductDescriptionInput({}, 'Rédige la description catalogue pour: produit marbre.')).toBeNull();
    expect(extractProductDescriptionInput({ product: { name: '   ' } }, 'Nom :   ')).toBeNull();
  });

  it('builds factual structured prompt from product fields and cleans conversational/markdown wrappers', () => {
    const parsed = extractProductDescriptionInput(
      {
        product: {
          name: 'Robinet mitigeur laiton',
          category: 'Plomberie',
          sku: 'ROB-102',
          unit: 'unité',
        },
      },
      'Rédige la description',
    );
    expect(parsed?.name).toBe('Robinet mitigeur laiton');
    expect(parsed?.prompt).toContain('Nom du produit : Robinet mitigeur laiton');
    expect(parsed?.prompt).toContain('Catégorie : Plomberie');
    expect(parsed?.prompt).toContain('Référence SKU : ROB-102');
    expect(parsed?.prompt).toContain('Unité principale : unité');

    const sys = productDescriptionSystem({ responseLanguage: 'fr' });
    expect(sys).toContain('N’invente JAMAIS');
    expect(sys).toContain('Renvoie uniquement le texte final');

    expect(
      cleanProductDescription('Voici une description : « **Robinet mitigeur** en laiton pour équipement sanitaire (réf. ROB-102). »'),
    ).toBe('Robinet mitigeur en laiton pour équipement sanitaire (réf. ROB-102).');
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/assist/chat returns 400 PRODUCT_NAME_REQUIRED without title and strips wrappers when valid', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'openai/gpt-oss-20b',
          choices: [{ message: { content: 'Description : « Tube PVC diamètre 100 mm pour évacuation. »' } }],
          usage: { prompt_tokens: 40, completion_tokens: 18 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { registerAssistRoutes } = await import('../routes/assist');
    const app = new Hono<{ Bindings: any }>();
    registerAssistRoutes(app, {
      authFailReason: async () => 'ok',
      sessionUserFromHeader: () => ({ username: 'owner', role: 'owner' }),
      clientIp: () => '127.0.0.1',
      requireOwner: async () => ({ ok: true, username: 'owner', role: 'owner' }),
      requireOwnerOrAdmin: async () => ({ ok: true, username: 'owner', role: 'owner' }),
      writeAudit: async () => {},
      issueDeleteOtp: async () => ({}),
      verifyDeleteOtp: async () => ({ ok: true }),
      userMail: async () => null,
      syncMobileHub: async () => {},
      notifyAssistApproval: async () => {},
    } as any);

    const token = 'test-token';
    const env = {
      GROQ_API_KEY: 'gsk-test',
      JWT_SECRET: 'test-secret',
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      },
      RATE_LIMIT: {
        get: async () => null,
        put: async () => {},
      },
    };

    const missingTitleRes = await app.fetch(
      new Request('http://test.local/api/assist/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          task: 'description',
          message: 'Rédige la description catalogue pour: produit marbre.',
          product: { name: '' },
        }),
      }),
      env,
    );
    expect(missingTitleRes.status).toBe(400);
    const missingBody: any = await missingTitleRes.json();
    expect(missingBody.code).toBe('PRODUCT_NAME_REQUIRED');
    expect(fetchSpy).not.toHaveBeenCalled();

    const validRes = await app.fetch(
      new Request('http://test.local/api/assist/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          task: 'description',
          message: 'Rédige la description catalogue pour: Tube PVC 100',
          product: { name: 'Tube PVC 100', category: 'Plomberie', unit: 'barre' },
        }),
      }),
      env,
    );
    expect(validRes.status).toBe(200);
    const validBody: any = await validRes.json();
    expect(validBody.data.reply).toBe('Tube PVC diamètre 100 mm pour évacuation.');
    expect(validBody.data.history_turns).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(sentPayload.temperature).toBe(0.3);
    expect(sentPayload.tools).toBeUndefined();
    expect(sentPayload.messages[0].content).toContain('N’invente JAMAIS');
  });
});
