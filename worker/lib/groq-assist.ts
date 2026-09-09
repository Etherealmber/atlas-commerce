/**
 * Groq free-tier — OpenAI-compatible.
 * https://api.groq.com/openai/v1/chat/completions
 */

const MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'llama-3.1-70b-versatile',
];

export async function groqChat(opts: {
  apiKey: string;
  model?: string;
  system: string;
  message: string;
  maxTokens?: number;
}): Promise<{ reply: string; model: string }> {
  const preferred = (opts.model || '').trim();
  const models = [preferred, ...MODELS].filter((m, i, a) => !!m && a.indexOf(m) === i);
  const maxTokens = Math.max(64, Math.min(opts.maxTokens ?? 1024, 4096));
  let lastStatus = 0;
  let lastBody = '';

  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
          { role: 'user', content: opts.message },
        ],
      }),
    });

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
    return { reply: text, model: String(data?.model || model) };
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error('Atlas Agent: clé Groq refusée. Vérifiez GROQ_API_KEY.');
  }
  if (lastStatus === 404) {
    throw new Error('Modèle Groq introuvable. Définissez GROQ_MODEL=llama-3.1-8b-instant');
  }
  throw new Error(
    lastStatus
      ? `Atlas Agent indisponible (HTTP ${lastStatus}).`
      : 'Atlas Agent indisponible (Groq).',
  );
}
