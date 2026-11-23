import { fetchWithTimeout } from './http-client';

/**
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

/** v0.7 — client-selectable agent response languages (Android app language). */
export type AgentResponseLanguage = 'fr' | 'en' | 'ar';

/**
 * Allowlist for the `response_language` body field. Returns null when the
 * value is absent or outside the allowlist → the legacy rule applies
 * (answer in the user's language, French default). Values are never echoed
 * into the prompt — only the allowlisted directive is.
 */
export function normalizeResponseLanguage(value: unknown): AgentResponseLanguage | null {
  const raw = String(value ?? '').trim().toLowerCase().slice(0, 32).split('-')[0];
  if (!raw) return null;
  if (raw === 'fr' || raw === 'french' || raw === 'francais') return 'fr';
  if (raw === 'en' || raw === 'english' || raw === 'anglais') return 'en';
  if (raw === 'ar' || raw === 'arabic' || raw === 'arabe') return 'ar';
  return null;
}

/** Hard language directive for the system prompt (overrides the French context). */
function languageDirective(lang: AgentResponseLanguage | null): string {
  if (lang === 'en') {
    return 'LANGUAGE (HARD RULE, overrides everything below and any other language in this prompt or the history): ALWAYS answer in English. Complete sentences.';
  }
  if (lang === 'ar') {
    return 'LANGUAGE (HARD RULE, overrides everything below and any other language in this prompt or the history): ALWAYS answer in Modern Standard Arabic. اللغة (قاعدة صارمة): أجب دائمًا بالعربية الفصحى، بجمل كاملة.';
  }
  if (lang === 'fr') {
    return 'Langue (RÈGLE STRICTE, prioritaire sur tout le reste): réponds TOUJOURS en français, même si la question est dans une autre langue. Phrases complètes.';
  }
  return 'Langue: réponds dans la langue de l’utilisateur (français par défaut). Phrases complètes.';
}

/** Concise by instruction; language follows the client-selected `response_language`. */
export function atlasAgentSystem(opts: {
  role: string;
  username: string;
  timezone?: string;
  source?: string;
  responseLanguage?: AgentResponseLanguage | string | null;
}): string {
  const lang = normalizeResponseLanguage(opts.responseLanguage);
  const isMobile = ['android', 'ios', 'mobile', 'capacitor'].includes(
    (opts.source || '').toLowerCase(),
  );
  return [
    'Tu es Atlas Agent, assistant intelligent d’Atlas Commerce (ERP stock, facturation, Maroc, MAD).',
    'Tu peux discuter librement: identité, explications, culture générale, conseils — pas seulement le stock.',
    'Si on te demande qui tu es: présente-toi clairement comme Atlas Agent (assistant Atlas Commerce).',
    languageDirective(lang),
    'Sois utile et naturel. Pour le métier: sois précis (chiffres, actions concrètes).',
    'Évite le jargon vendeur IA (ne dis pas que tu es Gemini, Mistral, Groq, Llama, ChatGPT).',
    'Si l’utilisateur est déjà sur une page, explique quoi y faire — n’ouvre pas cette même page.',
    `Rôle utilisateur: ${opts.role || 'user'} (${opts.username || 'user'}). Fuseau: ${opts.timezone || 'Africa/Casablanca'}.`,
    isMobile ? 'Mobile: réponses un peu plus courtes.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function productDescriptionSystem(opts?: {
  responseLanguage?: AgentResponseLanguage | string | null;
}): string {
  const lang = normalizeResponseLanguage(opts?.responseLanguage);
  return [
    'Tu es rédacteur de fiches catalogue pour un logiciel de gestion commerciale (Atlas Commerce).',
    languageDirective(lang),
    'Ta seule tâche est de rédiger une description catalogue courte, réelle, sobre et utile (1 à 2 phrases, 120 à 240 caractères max) à partir des seules données fournies sur le produit.',
    'RÈGLES STRICTES DE VÉRACITÉ :',
    '- Base-toi uniquement sur les informations explicitement données (nom, catégorie, unité, référence, notes).',
    '- N’invente JAMAIS de dimensions, poids, épaisseur, composition, origine géographique, marque, norme/certification, garantie, stock, prix ou promotion qui ne figurent pas dans les données.',
    '- N’écris pas de slogans publicitaires vides, de superlatifs exagérés (« exceptionnel », « révolutionnaire », « haut de gamme incomparable », « numéro 1 ») ni de phrases absurdes.',
    '- Renvoie uniquement le texte final de la description : aucune phrase d’introduction (« Voici… »), aucun titre, aucun guillemet autour, aucun Markdown (`**`, `#`, puces) et aucun émoji.',
  ].join(' ');
}

export function cleanProductDescription(raw: string): string {
  let text = String(raw || '').trim();
  // Remove markdown emphasis/headings/bullets
  text = text
    .replace(/^\s*[-*•#]+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Remove conversational preambles such as "Voici une description :"
  text = text.replace(
    /^(?:voici(?:\s+une)?\s+(?:proposition\s+de\s+)?description(?:\s+catalogue)?|description(?:\s+catalogue)?(?:\s+du\s+produit)?|here\s+is\s+(?:a\s+)?(?:short\s+)?(?:catalog\s+)?description)\s*[:\-–—]\s*/i,
    '',
  ).trim();
  // Strip outer matching quotes
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('«') && text.endsWith('»')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function extractProductDescriptionInput(
  body: any,
  message: string,
): { name: string; prompt: string } | null {
  const p = body?.product && typeof body.product === 'object' ? body.product : null;
  let name = String(p?.name ?? body?.product_name ?? '').trim().slice(0, 160);
  if (!name) {
    // Legacy message fallback: "Rédige la description catalogue pour: <hint>." or "Nom : <name>"
    const named =
      message.match(/(?:^|\n)\s*(?:nom|produit|title|name)\s*[:-]\s*([^\n·]+)/i)?.[1] ||
      message.match(/pour\s*:\s*([^.\n·]+)/i)?.[1] ||
      '';
    const candidate = named.trim().slice(0, 160);
    if (candidate && !/^produit\s+marbre$/i.test(candidate)) {
      name = candidate;
    }
  }
  if (!name) return null;

  const category = String(p?.category ?? '').trim().slice(0, 80);
  const sku = String(p?.sku ?? '').trim().slice(0, 64);
  const unit = String(p?.unit ?? '').trim().slice(0, 40);
  const secUnit = String(p?.secondary_unit ?? '').trim().slice(0, 40);
  const secFactor = String(p?.secondary_unit_factor ?? '').trim().slice(0, 24);
  const draft = String(p?.draft ?? '').trim().slice(0, 400);

  const lines = [`Nom du produit : ${name}`];
  if (category) lines.push(`Catégorie : ${category}`);
  if (sku) lines.push(`Référence SKU : ${sku}`);
  if (unit) lines.push(`Unité principale : ${unit}`);
  if (secUnit && secFactor) {
    lines.push(`Conditionnement : 1 ${unit || 'unité'} = ${secFactor} ${secUnit}`);
  } else if (secUnit) {
    lines.push(`Unité secondaire : ${secUnit}`);
  }
  if (draft) lines.push(`Notes ou brouillon existant : ${draft}`);

  lines.push(
    'Consigne : Rédige 1 à 2 phrases factuelles et naturelles pour la fiche catalogue en te limitant strictement aux données ci-dessus.',
  );

  return { name, prompt: lines.join('\n') };
}
