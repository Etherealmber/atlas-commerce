import { describe, expect, it } from 'vitest';

import { pickUiLang, tr } from '../lib/error-i18n';
import { updateRequiredBody } from '../lib/app-update-policy';

/**
 * v0.7 — stable server error messages in fr/en/ar.
 *
 * The Android app surfaces `error` strings to users; until now they were
 * French-only. Language comes from the allowlisted Accept-Language parse;
 * machine codes are unchanged. French literals are pinned to the historical
 * strings so default behavior never shifts.
 */
describe('pickUiLang (Accept-Language allowlist)', () => {
  it('absent / unknown / hostile → fr (historical default)', () => {
    expect(pickUiLang(undefined)).toBe('fr');
    expect(pickUiLang(null)).toBe('fr');
    expect(pickUiLang('')).toBe('fr');
    expect(pickUiLang('de-DE,de;q=0.9')).toBe('fr');
    expect(pickUiLang(';;,<script>')).toBe('fr');
    expect(pickUiLang('arabic-injection; DROP TABLE')).toBe('fr');
  });

  it('plain tags', () => {
    expect(pickUiLang('fr-FR,fr;q=0.9')).toBe('fr');
    expect(pickUiLang('en-US,en;q=0.9')).toBe('en');
    expect(pickUiLang('ar-SA,ar;q=0.9')).toBe('ar');
    expect(pickUiLang('ar')).toBe('ar');
    expect(pickUiLang('EN')).toBe('en');
  });

  it('honors q-values over order', () => {
    expect(pickUiLang('en;q=0.4,ar;q=0.9')).toBe('ar');
    expect(pickUiLang('fr;q=0.2,en;q=0.8,ar;q=0.5')).toBe('en');
    expect(pickUiLang('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
  });
});

describe('tr — localized stable messages', () => {
  it('french literals stay EXACTLY the historical strings', () => {
    expect(tr('fr', 'auth_required')).toBe('Authentification requise.');
    expect(tr('fr', 'message_empty')).toBe('Message vide.');
    expect(tr('fr', 'agent_no_key')).toBe('Assistant IA non configuré. Secret GROQ_API_KEY manquant.');
    expect(tr('fr', 'agent_upstream')).toBe('Échec Atlas Agent');
    expect(tr('fr', 'update_required')).toBe(
      "Cette version de l'application Android n'est plus supportée. Mettez à jour pour continuer.",
    );
    expect(tr('fr', 'token_required')).toBe('token requis');
    expect(tr('fr', 'token_store_error')).toBe('Enregistrement du token impossible pour le moment.');
  });

  it('every key exists in the three languages, distinct and non-empty', () => {
    const keys = ['auth_required', 'message_empty', 'agent_no_key', 'agent_upstream', 'update_required', 'token_required', 'token_store_error'] as const;
    for (const key of keys) {
      const fr = tr('fr', key);
      const en = tr('en', key);
      const ar = tr('ar', key);
      for (const s of [fr, en, ar]) expect(s.length).toBeGreaterThan(2);
      expect(new Set([fr, en, ar]).size).toBe(3);
    }
  });
});

describe('updateRequiredBody wires the language', () => {
  const manifest = { versionCode: 50, versionName: '1.0.9', apkUrl: 'https://cdn1.example/app.apk' };
  const policy = { enabled: true, code: 42 };

  it('default keeps the French historical body', () => {
    const body = updateRequiredBody(manifest, policy) as any;
    expect(body.code).toBe('APP_UPDATE_REQUIRED');
    expect(body.error).toBe(tr('fr', 'update_required'));
    expect(body.update.apkUrl).toBe('https://cdn1.example/app.apk');
  });

  it('en / ar swap only the message — code and update payload unchanged', () => {
    for (const lang of ['en', 'ar'] as const) {
      const body = updateRequiredBody(manifest, policy, lang) as any;
      expect(body.code).toBe('APP_UPDATE_REQUIRED');
      expect(body.error).toBe(tr(lang, 'update_required'));
      expect(body.update.minimumSupportedVersionCode).toBe(42);
    }
  });
});
