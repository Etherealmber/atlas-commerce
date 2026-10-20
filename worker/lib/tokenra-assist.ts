/**
import { fetchWithTimeout } from './http-client';
 * TokenRa OpenAI-compatible gateway (DeepSeek V4 Flash, etc.)
 * https://tokenra.io — POST /v1/chat/completions
 * Auth: Authorization: Bearer sk-...
 */

const BASES = [
  'https://api.tokenra.io/v1',
  'https://tokenra.io/v1',
];

const MODEL_FALLBACKS = [
  'deepseek-v4-flash',
  'deepseek-chat',
  'deepseek-v4-pro',
  'deepseek-reasoner',
];

export async function tokenraChat(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
}): Promise<{ reply: string; model: string }> {
  const preferredBase = (opts.baseUrl || '').trim().replace(/\/+$/, '');
  const bases = [preferredBase, ...BASES].filter((b, i, a) => !!b && a.indexOf(b) === i);
  const preferredModel = (opts.model || '').trim();
  const models = [preferredModel, ...MODEL_FALLBACKS].filter((m, i, a) => !!m && a.indexOf(m) === i);
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 1024, 4096));

  let lastStatus = 0;
  let lastBody = '';

  for (const base of bases) {
    for (const model of models) {
      try {
        const res = await fetchWithTimeout(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: maxTokens,
            stream: false,
            messages: [
              { role: 'system', content: opts.system },
              { role: 'user', content: opts.message },
            ],
          }),
        });

        const raw = await res.text().catch(() => '');
        lastStatus = res.status;
        lastBody = raw.slice(0, 300);

        if (res.status === 401 || res.status === 403) {
          throw new Error('Atlas Agent: clé TokenRa refusée. Vérifiez TOKENRA_API_KEY dans Wrangler.');
        }
        if (res.status === 429) {
          throw new Error('Atlas Agent saturé (TokenRa). Réessayez dans une minute.');
        }
        // 404 model → try next model
        if (res.status === 404 || res.status === 400) {
          const low = raw.toLowerCase();
          if (low.includes('model') || low.includes('not found') || low.includes('invalid')) {
            continue;
          }
        }
        // 502/503/520/521/522/530 = gateway / origin down → try next base
        if (res.status >= 500) {
          continue;
        }
        if (!res.ok) continue;

        let data: any = {};
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }

        let text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!text) {
          text = String(data?.choices?.[0]?.message?.reasoning_content || '').trim();
        }
        if (!text && data?.error?.message) {
          lastBody = String(data.error.message);
          continue;
        }
        if (!text) continue;

        text = text
          .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|DeepSeek|TokenRa)\b/gi, 'Atlas Agent')
          .trim();

        return { reply: text, model: String(data?.model || model) };
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('clé TokenRa') || msg.includes('saturé')) throw e;
        lastBody = msg.slice(0, 200);
        continue;
      }
    }
  }

  if (lastStatus === 530 || lastStatus === 520 || lastStatus === 522) {
    throw new Error(
      'TokenRa inaccessible (passerelle). Vérifiez le modèle activé sur la clé, ou réessayez plus tard.',
    );
  }
  if (lastStatus === 404 || lastStatus === 400) {
    throw new Error(
      'Modèle TokenRa introuvable. Activez deepseek-v4-flash sur la clé, ou définissez TOKENRA_MODEL.',
    );
  }
  if (lastStatus) {
    throw new Error(`Atlas Agent indisponible (HTTP ${lastStatus}).`);
  }
  throw new Error('Atlas Agent indisponible (TokenRa). Réessayez.');
}
