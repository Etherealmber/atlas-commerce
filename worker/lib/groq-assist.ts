import { upstreamFetch } from './upstream';

/**
 * Groq free-tier — OpenAI-compatible.
 * https://api.groq.com/openai/v1/chat/completions
 */

const MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

/* v232 — vision-capable Groq models, tried first when images are attached */
/* v234 — Groq docs (console.groq.com/docs/vision): qwen3.8-27b + llama-4-scout are the
   current vision models; llama-3.2-*-vision-preview was deprecated 2025-04-14.
   Data-URL base64 images allowed, ≤4 MB per image, ≤5 images per request. */
const VISION_MODELS = [
  'qwen/qwen3.8-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

export async function groqChat(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  images?: string[];
}): Promise<{ reply: string; model: string; usage?: { prompt: number; completion: number } }> {
  const preferred = (opts.model || '').trim();
  const images = (opts.images || []).filter((u) => typeof u === 'string' && u.startsWith('data:image/') && u.length <= 3_500_000).slice(0, 4);
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 1024, 4096));
  let lastStatus = 0;
  let lastBody = '';
  let activeImages = images;
  for (let attempt = 0; attempt < (images.length ? 2 : 1); attempt++) {
    if (attempt === 1) activeImages = []; // vision failed everywhere → answer without images
    const base = activeImages.length ? [...VISION_MODELS, ...MODELS] : MODELS;
    const models = [preferred, ...base].filter((m, i, a) => !!m && a.indexOf(m) === i);
    for (const model of models) {
    const res = await upstreamFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: opts.system },
          activeImages.length
            ? {
                role: 'user',
                content: [
                  { type: 'text', text: opts.message },
                  ...activeImages.map((url) => ({ type: 'image_url', image_url: { url } })),
                ],
              }
            : { role: 'user', content: opts.message },
        ],
      }),
    }, { timeoutMs: 20000, retries: 2, label: 'groq' });

    const raw = await res.text().catch(() => '');
    lastStatus = res.status;
    lastBody = raw.slice(0, 240);

    if (res.status === 401 || res.status === 403) {
      throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY (console.groq.com).');
    }
    if (res.status === 429) {
      throw new Error('Quota Groq atteint. Réessayez dans quelques minutes.');
    }
    // 404 = bad model id → try next
    if (res.status === 404 || res.status === 400) {
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
    if (!text) continue;
    text = text
      .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Groq|Llama|Meta)\b/gi, 'Atlas Agent')
      .trim();
    return {
      reply: text,
      model: String(data?.model || model),
      usage: {
        prompt: Number(data?.usage?.prompt_tokens || 0),
        completion: Number(data?.usage?.completion_tokens || 0),
      },
    };
    }
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY.');
  }
  if (lastStatus === 404) {
    throw new Error('Modèle Groq introuvable. Définissez GROQ_MODEL=openai/gpt-oss-20b');
  }
  throw new Error(
    lastStatus
      ? `Atlas Agent indisponible (HTTP ${lastStatus}).`
      : 'Atlas Agent indisponible (Groq).',
  );
}
