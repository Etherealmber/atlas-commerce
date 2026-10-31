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

/* ─────────────────────── boucle d'outils (v0.7.7) ───────────────────────
 * Function-calling OpenAI-compatible sur Groq : le modèle peut appeler des
 * outils (métier via runAssistTool, mémoire/RAG via agent-knowledge) jusqu'à
 * 3 tours avant de répondre. Chaque appel est journalisé dans tool_trace. */
export type AgentToolTrace = { name: string; ok: boolean; error?: string; data?: unknown };

export async function groqChatWithTools(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
  tools: unknown[];
  executor: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
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
      // modèle sans support outils ? → repli sans outils
      const fallback = await groqChat({
        apiKey: opts.apiKey,
        model: opts.model,
        system: opts.system,
        message: opts.message,
        maxTokens,
      });
      return { ...fallback, tool_trace: trace };
    }
    promptTokens += Number(data?.usage?.prompt_tokens || 0);
    completionTokens += Number(data?.usage?.completion_tokens || 0);
    lastModel = String(data?.model || opts.model || MODELS[0]);
    const msg = data?.choices?.[0]?.message || {};
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls.slice(0, 4) : [];
    if (!calls.length) {
      const text = String(msg.content || '')
        .trim()
        .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Groq|Llama|Meta)\b/gi, 'Atlas Agent')
        .trim();
      if (text) return { reply: text, model: lastModel, usage: { prompt: promptTokens, completion: completionTokens }, tool_trace: trace };
      break;
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
    for (const call of calls) {
      const name = String(call?.function?.name || '');
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(String(call?.function?.arguments || '{}')); } catch { args = {}; }
      let out: { ok: boolean; data?: unknown; error?: string } = { ok: false, error: 'Outil inconnu.' };
      try {
        out = await opts.executor(name, args);
      } catch (e: any) {
        out = { ok: false, error: String(e?.message || e).slice(0, 200) };
      }
      trace.push({ name, ok: out.ok, error: out.ok ? undefined : out.error, data: out.ok ? out.data : undefined });
      messages.push({
        role: 'tool',
        tool_call_id: String(call?.id || ''),
        content: JSON.stringify(out).slice(0, 6000),
      });
    }
  }
  // dernier recours : réponse directe sans outils
  const fallback = await groqChat({
    apiKey: opts.apiKey,
    model: opts.model,
    system: opts.system,
    message: opts.message,
    maxTokens,
  });
  return { ...fallback, tool_trace: trace };
}

/* ─────────────────────────── streaming (v264) ───────────────────────────
 * SSE token streaming for POST /api/assist/chat/stream. Same provider, same
 * scrubbing rules as groqChat(); deltas are forwarded as they arrive and the
 * REAL usage (prompt+completion tokens) is read from the final chunk so the
 * server-side quota charges streamed turns exactly like buffered ones.
 * `fetchImpl` is injectable for tests; the production path uses global fetch
 * (upstreamFetch buffers whole bodies and cannot stream). */

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
  reply = reply
    .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Groq|Llama|Meta)\b/gi, 'Atlas Agent')
    .trim();
  if (!reply) throw new Error('Atlas Agent: réponse vide du flux Groq.');
  return { reply, model: usedModel, usage };
}
