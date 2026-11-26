import { upstreamFetch } from './upstream';

/**
 * Atlas Agent — Groq-only LLM client & prompt helpers.
 * OpenAI-compatible endpoint: https://api.groq.com/openai/v1/chat/completions
 */

const MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

const VISION_MODELS = [
  'qwen/qwen3.8-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

const VENDOR_WORDS_RE = /\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Anthropic|Grok|Groq|Llama|Meta)\b/gi;

export function scrubVendorNames(s: string): string {
  return String(s || '')
    .replace(VENDOR_WORDS_RE, 'Atlas Agent')
    .replace(/\bLLM\b/gi, 'assistant')
    .trim();
}

/** Client-selectable agent response languages (web / Android app language). */
type AgentResponseLanguage = 'fr' | 'en' | 'ar';

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
  text = text
    .replace(/^\s*[-*•#]+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  text = text.replace(
    /^(?:voici(?:\s+une)?\s+(?:proposition\s+de\s+)?description(?:\s+catalogue)?|description(?:\s+catalogue)?(?:\s+du\s+produit)?|here\s+is\s+(?:a\s+)?(?:short\s+)?(?:catalog\s+)?description)\s*[:\-–—]\s*/i,
    '',
  ).trim();
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

export async function groqChat(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  temperature?: number;
  images?: string[];
  messages?: any[];
  fetchImpl?: typeof fetch;
}): Promise<{ reply: string; model: string; usage?: { prompt: number; completion: number } }> {
  const preferred = (opts.model || '').trim();
  const images = (opts.images || []).filter((u) => typeof u === 'string' && u.startsWith('data:image/') && u.length <= 3_500_000).slice(0, 4);
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 1024, 4096));
  let lastStatus = 0;
  let activeImages = images;
  for (let attempt = 0; attempt < (images.length ? 2 : 1); attempt++) {
    if (attempt === 1) activeImages = [];
    const base = activeImages.length ? [...VISION_MODELS, ...MODELS] : MODELS;
    const models = [preferred, ...base].filter((m, i, a) => !!m && a.indexOf(m) === i);
    for (const model of models) {
      const request = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.55,
          max_tokens: maxTokens,
          messages: opts.messages || [
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
      };
      const res = opts.fetchImpl
        ? await opts.fetchImpl('https://api.groq.com/openai/v1/chat/completions', request)
        : await upstreamFetch('https://api.groq.com/openai/v1/chat/completions', request, { timeoutMs: 20000, retries: 2, label: 'groq' });

      const raw = await res.text().catch(() => '');
      lastStatus = res.status;

      if (res.status === 401 || res.status === 403) {
        throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY (console.groq.com).');
      }
      if (res.status === 429) {
        throw new Error('Quota Groq atteint. Réessayez dans quelques minutes.');
      }
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
      text = scrubVendorNames(text);
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

export type AgentToolResult = { ok: boolean; data?: unknown; error?: string; proposal?: Record<string, unknown> };
export type AgentToolTrace = AgentToolResult & { name: string };

/** Only proposals from successful, server-executed tools reach the client. */
export function proposalsFromToolTrace(trace: AgentToolTrace[]): Record<string, unknown>[] {
  return trace.flatMap((t) => t.ok && t.proposal ? [t.proposal] : []);
}

export async function groqChatWithTools(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  tools: unknown[];
  executor: (name: string, args: Record<string, unknown>) => Promise<AgentToolResult>;
  maxRounds?: number;
}): Promise<{
  reply: string;
  model: string;
  usage?: { prompt: number; completion: number };
  tool_trace: AgentToolTrace[];
}> {
  const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? 3, 4));
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 1024, 4096));
  const messages: any[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.message },
  ];
  const trace: AgentToolTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let lastModel = '';
  for (let round = 0; round < maxRounds; round++) {
    const res = await upstreamFetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.model || MODELS[0],
          temperature: 0.55,
          max_tokens: maxTokens,
          tools: opts.tools,
          tool_choice: 'auto',
          messages,
        }),
      },
      { timeoutMs: 20000, retries: 2, label: 'groq-tools' },
    );
    if (res.status === 401 || res.status === 403) {
      throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY.');
    }
    if (res.status === 429) throw new Error('Quota Groq atteint. Réessayez dans quelques minutes.');
    const raw = await res.text().catch(() => '');
    let data: any = {};
    try { data = JSON.parse(raw); } catch { data = {}; }
    if (!res.ok) {
      const fallback = await groqChat({
        apiKey: opts.apiKey,
        model: opts.model,
        system: opts.system,
        message: opts.message,
        messages: trace.length ? messages : undefined,
        maxTokens,
      });
      return { ...fallback, usage: { prompt: promptTokens + (fallback.usage?.prompt || 0), completion: completionTokens + (fallback.usage?.completion || 0) }, tool_trace: trace };
    }
    promptTokens += Number(data?.usage?.prompt_tokens || 0);
    completionTokens += Number(data?.usage?.completion_tokens || 0);
    lastModel = String(data?.model || opts.model || MODELS[0]);
    const msg = data?.choices?.[0]?.message || {};
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls.slice(0, 4) : [];
    if (!calls.length) {
      const text = scrubVendorNames(String(msg.content || '').trim());
      if (text) return { reply: text, model: lastModel, usage: { prompt: promptTokens, completion: completionTokens }, tool_trace: trace };
      break;
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
    for (const call of calls) {
      const name = String(call?.function?.name || '');
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(String(call?.function?.arguments || '{}')); } catch { args = {}; }
      let out: AgentToolResult = { ok: false, error: 'Outil inconnu.' };
      try {
        out = await opts.executor(name, args);
      } catch (e: any) {
        out = { ok: false, error: String(e?.message || e).slice(0, 200) };
      }
      trace.push({ name, ok: out.ok, error: out.ok ? undefined : out.error, data: out.ok ? out.data : undefined, ...(out.ok && out.proposal ? { proposal: out.proposal } : {}) });
      messages.push({
        role: 'tool',
        tool_call_id: String(call?.id || ''),
        content: JSON.stringify(out).slice(0, 6000),
      });
    }
  }
  const fallback = await groqChat({
    apiKey: opts.apiKey,
    model: opts.model,
    system: opts.system,
    message: opts.message,
    messages: trace.length ? messages : undefined,
    maxTokens,
  });
  return { ...fallback, usage: { prompt: promptTokens + (fallback.usage?.prompt || 0), completion: completionTokens + (fallback.usage?.completion || 0) }, tool_trace: trace };
}

export async function groqChatStreamWithTools(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  tools: unknown[];
  executor: (name: string, args: Record<string, unknown>) => Promise<AgentToolResult>;
  maxRounds?: number;
  onToken: (delta: string) => void;
  onToolStart?: (name: string) => void;
  onTool?: (t: AgentToolTrace) => void;
  fetchImpl?: typeof fetch;
}): Promise<{
  reply: string;
  model: string;
  usage?: { prompt: number; completion: number };
  tool_trace: AgentToolTrace[];
}> {
  const f = opts.fetchImpl || fetch;
  const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? 3, 4));
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 700, 4096));
  const model = (opts.model || '').trim() || MODELS[0];
  const messages: any[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.message },
  ];
  const trace: AgentToolTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let lastModel = model;
  for (let round = 0; round < maxRounds; round++) {
    const res = await f('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        tools: opts.tools,
        tool_choice: 'auto',
        messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY (console.groq.com).');
    }
    if (res.status === 429) throw new Error('Quota Groq atteint. Réessayez dans quelques minutes.');
    if (!res.ok || !res.body) throw new Error(`Atlas Agent indisponible en flux (HTTP ${res.status}).`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let roundText = '';
    let streamCompleted = false;
    const callsByIndex = new Map<number, { id: string; name: string; args: string }>();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          streamCompleted = true;
          continue;
        }
        let j: any = null;
        try { j = JSON.parse(payload); } catch { continue; }
        if (j?.model) lastModel = String(j.model);
        if (j?.choices?.[0]?.finish_reason) streamCompleted = true;
        const delta = String(j?.choices?.[0]?.delta?.content || '');
        if (delta) {
          roundText += delta;
          try { opts.onToken(delta); } catch { /* consumer went away — keep draining */ }
        }
        const tcs = j?.choices?.[0]?.delta?.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const i = Number(tc?.index ?? 0);
            const cur = callsByIndex.get(i) || { id: '', name: '', args: '' };
            if (tc?.id) cur.id = String(tc.id);
            if (tc?.function?.name) cur.name += String(tc.function.name);
            if (tc?.function?.arguments) cur.args += String(tc.function.arguments);
            callsByIndex.set(i, cur);
          }
        }
        const u = j?.usage || j?.x_groq?.usage;
        if (u) {
          promptTokens += Number(u.prompt_tokens || 0);
          completionTokens += Number(u.completion_tokens || 0);
        }
      }
    }
    if (!streamCompleted && callsByIndex.size > 0) {
      throw new Error('Flux amont interrompu prématurément avant achèvement du tool_call.');
    }
    const calls = [...callsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter((v) => v.name)
      .slice(0, 4);
    if (!calls.length) {
      const text = scrubVendorNames(roundText.trim());
      if (text) {
        return { reply: text, model: lastModel, usage: { prompt: promptTokens, completion: completionTokens }, tool_trace: trace };
      }
      break;
    }
    messages.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: calls.map((v, k) => ({ id: v.id || `call_${k}`, type: 'function', function: { name: v.name, arguments: v.args || '{}' } })),
    });
    for (const [index, call] of calls.entries()) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }
      let out: AgentToolResult = { ok: false, error: 'Outil inconnu.' };
      try { opts.onToolStart?.(call.name); } catch { /* consumer went away */ }
      try {
        out = await opts.executor(call.name, args);
      } catch (e: any) {
        out = { ok: false, error: String(e?.message || e).slice(0, 200) };
      }
      const entry: AgentToolTrace = { name: call.name, ok: out.ok, error: out.ok ? undefined : out.error, data: out.ok ? out.data : undefined, ...(out.ok && out.proposal ? { proposal: out.proposal } : {}) };
      trace.push(entry);
      try { opts.onTool?.(entry); } catch { /* consumer went away */ }
      messages.push({ role: 'tool', tool_call_id: call.id || `call_${index}`, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  const fallback = await groqChat({ apiKey: opts.apiKey, model: opts.model, system: opts.system, message: opts.message, messages: trace.length ? messages : undefined, maxTokens, fetchImpl: opts.fetchImpl });
  if (fallback.reply) opts.onToken(fallback.reply);
  return { ...fallback, usage: { prompt: promptTokens + (fallback.usage?.prompt || 0), completion: completionTokens + (fallback.usage?.completion || 0) }, tool_trace: trace };
}

export async function groqChatStream(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  onToken: (delta: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ reply: string; model: string; usage?: { prompt: number; completion: number } }> {
  const f = opts.fetchImpl || fetch;
  const model = (opts.model || '').trim() || MODELS[0];
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 700, 4096));
  const res = await f('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.55,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.message },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY (console.groq.com).');
  }
  if (res.status === 429) {
    throw new Error('Quota Groq atteint. Réessayez dans quelques minutes.');
  }
  if (!res.ok || !res.body) {
    throw new Error(`Atlas Agent indisponible en flux (HTTP ${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let reply = '';
  let usedModel = model;
  let usage: { prompt: number; completion: number } | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j: any = null;
      try { j = JSON.parse(payload); } catch { continue; }
      if (j?.model) usedModel = String(j.model);
      const delta = String(j?.choices?.[0]?.delta?.content || '');
      if (delta) {
        reply += delta;
        try { opts.onToken(delta); } catch { /* consumer went away — keep draining */ }
      }
      const u = j?.usage || j?.x_groq?.usage;
      if (u) {
        usage = {
          prompt: Number(u.prompt_tokens || 0),
          completion: Number(u.completion_tokens || 0),
        };
      }
    }
  }
  reply = scrubVendorNames(reply);
  if (!reply) throw new Error('Atlas Agent: réponse vide du flux Groq.');
  return { reply, model: usedModel, usage };
}
