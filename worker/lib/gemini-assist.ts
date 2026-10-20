/**
import { fetchWithTimeout } from './http-client';
 * Atlas Agent — Gemini generateContent path.
 *
 * Auth: header x-goog-api-key (required for current Gemini / auth keys).
 * Docs: finishReason MAX_TOKENS = response cut by maxOutputTokens;
 *       STOP = natural end. We set a high token budget and continue once if truncated.
 */

const DEFAULT_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
];

export async function geminiSimpleChat(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
}): Promise<{ reply: string; model: string }> {
  const preferred = (opts.model || '').trim();
  const candidates = [preferred, ...DEFAULT_MODELS].filter(
    (m, i, a) => !!m && a.indexOf(m) === i,
  ) as string[];

  // Full sentences need room; ~4 chars/token → 1024 tokens ≈ long paragraph
  const maxTok = Math.max(256, Math.min(opts.maxTokens ?? 1024, 2048));
  let lastErr = 'Atlas Agent indisponible.';

  for (const model of candidates) {
    try {
      const text = await callWithContinuation(
        opts.apiKey,
        model,
        opts.system,
        opts.message,
        maxTok,
      );
      if (text) return { reply: scrubVendorNames(text), model };
      lastErr = "Atlas Agent n'a pas pu répondre. Réessayez.";
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.startsWith('HTTP_404')) {
        lastErr = msg;
        continue;
      }
      if (msg.startsWith('HTTP_429')) {
        throw new Error('Atlas Agent est temporairement saturé. Réessayez dans une minute.');
      }
      if (msg.startsWith('HTTP_401') || msg.startsWith('HTTP_403')) {
        throw new Error(
          'Atlas Agent: clé refusée. Créez une clé Auth (AI Studio), puis: npx wrangler secret put GEMINI_API_KEY',
        );
      }
      lastErr = msg.replace(/^HTTP_\d+:\s*/, '') || lastErr;
      continue;
    }
  }

  throw new Error(
    lastErr.includes('404')
      ? 'Atlas Agent: modèle inaccessible. Définissez GEMINI_MODEL=gemini-flash-latest ou définissez GROQ_API_KEY.'
      : lastErr,
  );
}

type GenResult = { text: string; finishReason: string };

async function generateOnce(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<GenResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => '');
  if (res.status === 404) throw new Error(`HTTP_404:${raw.slice(0, 120)}`);
  if (!res.ok) throw new Error(`HTTP_${res.status}:${raw.slice(0, 180)}`);

  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Réponse API illisible');
  }

  const cand = data?.candidates?.[0];
  const finishReason = String(cand?.finishReason || data?.promptFeedback?.blockReason || '');
  const parts = cand?.content?.parts || [];
  const text = parts
    .map((p: any) => p?.text || '')
    .join('')
    .trim();
  return { text, finishReason };
}

async function callWithContinuation(
  apiKey: string,
  model: string,
  system: string,
  message: string,
  maxTokens: number,
): Promise<string> {
  const baseBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: maxTokens,
      candidateCount: 1,
    },
  };

  let { text, finishReason } = await generateOnce(apiKey, model, baseBody);

  // If empty, retry without systemInstruction (compat)
  if (!text) {
    const retry = await generateOnce(apiKey, model, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${system}\n\nMessage utilisateur:\n${message}\n\nRéponds en français, phrases complètes.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
      },
    });
    text = retry.text;
    finishReason = retry.finishReason;
  }

  // MAX_TOKENS = hard cut mid-reply — ask model to finish once
  if (text && /MAX_TOKENS/i.test(finishReason)) {
    try {
      const cont = await generateOnce(apiKey, model, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          { role: 'user', parts: [{ text: message }] },
          { role: 'model', parts: [{ text }] },
          {
            role: 'user',
            parts: [
              {
                text: 'Continue exactement où tu t’es arrêté. Termine la phrase en français, sans recommencer.',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: Math.min(512, maxTokens),
          candidateCount: 1,
        },
      });
      if (cont.text) {
        // append if continuation doesn't already include the start
        const extra = cont.text.trim();
        if (extra && !text.endsWith(extra)) {
          text = `${text}${/^\s/.test(extra) || /[.!?…]$/.test(text) ? '' : ' '}${extra}`.trim();
        }
      }
    } catch {
      /* keep partial text rather than fail */
    }
  }

  return cleanModelEcho(text);
}

function cleanModelEcho(s: string): string {
  let t = String(s || '').trim();
  t = t.replace(/^(NO introductory phrases|No introductory phrases)[.\s]*/i, '');
  t = t.replace(/^(System:|Instructions?:|Règles?:)\s*/i, '');
  return t.trim();
}

export function scrubVendorNames(s: string): string {
  return String(s || '')
    .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Anthropic|Grok)\b/gi, 'Atlas Agent')
    .replace(/\bLLM\b/gi, 'assistant')
    .trim();
}

/** Concise by instruction; always complete French sentences. */
export function atlasAgentSystem(opts: {
  role: string;
  username: string;
  timezone?: string;
  source?: string;
}): string {
  const isMobile = ['android', 'ios', 'mobile', 'capacitor'].includes(
    (opts.source || '').toLowerCase(),
  );
  return [
    'Tu es Atlas Agent, assistant intelligent d’Atlas Commerce (ERP stock, facturation, Maroc, MAD).',
    'Tu peux discuter librement: identité, explications, culture générale, conseils — pas seulement le stock.',
    'Si on te demande qui tu es: présente-toi clairement comme Atlas Agent (assistant Atlas Commerce).',
    'Langue: réponds dans la langue de l’utilisateur (français par défaut). Phrases complètes.',
    'Sois utile et naturel. Pour le métier: sois précis (chiffres, actions concrètes).',
    'Évite le jargon vendeur IA (ne dis pas que tu es Gemini, Mistral, Groq, Llama, ChatGPT).',
    'Si l’utilisateur est déjà sur une page, explique quoi y faire — n’ouvre pas cette même page.',
    `Rôle utilisateur: ${opts.role || 'user'} (${opts.username || 'user'}). Fuseau: ${opts.timezone || 'Africa/Casablanca'}.`,
    isMobile ? 'Mobile: réponses un peu plus courtes.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
