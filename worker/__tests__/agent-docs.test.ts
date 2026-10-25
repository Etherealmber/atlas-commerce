/**
 * v264 — Atlas Agent document ingestion tests: bounded, MIME-validated
 * PDF/text extraction (lib/agent-docs.ts) + SSE streaming parser
 * (groqChatStream, lib/groq-assist.ts).
 *
 * Locks the contract:
 *  - allow-list MIME + MAGIC-BYTE validation (a data-URL lying about its type
 *    is refused — never trusted);
 *  - hard bounds: ≤2 documents, ≤2 MB decoded, ≤30 PDF pages, 12 000-char
 *    extraction ceiling with an explicit `truncated` flag;
 *  - never infer: an unreadable/scanned PDF yields extraction:'empty' and the
 *    prompt section tells the model NOT to invent content;
 *  - groqChatStream forwards deltas, scrubs provider names, and reports the
 *    REAL usage from the final chunk (quota parity with the buffered path).
 */
import { describe, it, expect } from 'vitest';
// node:zlib — imported dynamically because the repo has no @types/node
// (same harness convention as finance.test.ts / node:sqlite).
const ZLIB_MODULE = ['node:', 'zlib'].join('');
const { deflateSync } = (await import(ZLIB_MODULE)) as { deflateSync: (buf: Uint8Array) => Uint8Array };
import {
  AGENT_DOC_LIMITS,
  parseAgentDocumentsAsync,
  agentDocumentPromptSection,
  type AgentDocExcerpt,
} from '../lib/agent-docs';
import { groqChatStream } from '../lib/groq-assist';

/* ─────────────────────────── fixtures ─────────────────────────── */

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${b64(bytes)}`;
}

function textUrl(mime: string, text: string): string {
  return dataUrl(mime, new TextEncoder().encode(text));
}

/** Synthetic PDF: real %PDF- header, N /Type /Page objects, one content
 *  stream (raw or FlateDecode) with text-show operators. */
function makePdf(opts: {
  pages?: number;
  content?: string;
  flate?: boolean;
  noTextOps?: boolean;
} = {}): Uint8Array {
  const pages = opts.pages ?? 1;
  const content = opts.noTextOps
    ? 'q 1 0 0 1 0 0 cm Q' // a scanned page: graphics state ops, no text
    : (opts.content ?? 'BT /F1 12 Tf (Hello Atlas) Tj [(Bon) -250 (jour)] TJ ET');
  let streamBytes = new TextEncoder().encode(content);
  let filter = '';
  if (opts.flate) {
    streamBytes = new Uint8Array(deflateSync(Buffer.from(streamBytes)));
    filter = '/Filter /FlateDecode ';
  }
  let pageObjs = '';
  for (let i = 0; i < pages; i++) pageObjs += `${i + 3} 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n`;
  const head =
    `%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n` +
    pageObjs +
    `4 0 obj\n<< ${filter}/Length ${streamBytes.length} >>\nstream\n`;
  const tail = '\nendstream\nendobj\ntrailer\n<< /Root 2 0 R >>\n%%EOF';
  return Buffer.concat([
    Buffer.from(head, 'latin1'),
    Buffer.from(streamBytes),
    Buffer.from(tail, 'latin1'),
  ]);
}

/** The route contract is a LIST; the helpers accept a single doc for brevity. */
function asList(input: unknown): unknown {
  return input == null || Array.isArray(input) ? input : [input];
}

async function ok(input: unknown): Promise<AgentDocExcerpt[]> {
  const r = await parseAgentDocumentsAsync(asList(input));
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r.docs;
}

async function fail(input: unknown): Promise<{ name: string; code: string; error: string }[]> {
  const r = await parseAgentDocumentsAsync(asList(input));
  if (r.ok) throw new Error('expected refusal, got ok');
  return r.errors;
}

/* ─────────────────────────── text family ─────────────────────────── */

describe('agent-docs — text/plain, csv, markdown, json', () => {
  it('accepts UTF-8 text with accents and reports exact metadata', async () => {
    const [doc] = await ok([{ name: 'note.txt', data_url: textUrl('text/plain', 'Bonjour — accentué éàç ☃') }]);
    expect(doc).toMatchObject({ name: 'note.txt', mime: 'text/plain', kind: 'text', extraction: 'ok', truncated: false, pages: null });
    expect(doc.text).toBe('Bonjour — accentué éàç ☃');
    expect(doc.chars).toBe(doc.text.length);
    expect(doc.bytes).toBeGreaterThan(0);
  });

  it('accepts csv / markdown / json mimes', async () => {
    const docs = await ok([
      textUrl('text/csv', 'a,b\n1,2\n'),
      { name: 'readme.md', data_url: textUrl('text/markdown', '# Titre\n') },
    ]);
    expect(docs).toHaveLength(2);
    expect(docs[0].mime).toBe('text/csv');
    expect(docs[1].mime).toBe('text/markdown');
    const [json] = await ok(textUrl('application/json', '{"ok":true}'));
    expect(json.extraction).toBe('ok');
  });

  it('caps extraction at the 12 000-char ceiling with truncated:true', async () => {
    const [doc] = await ok(textUrl('text/plain', 'x'.repeat(AGENT_DOC_LIMITS.maxExtractedChars + 8000)));
    expect(doc.truncated).toBe(true);
    expect(doc.chars).toBe(AGENT_DOC_LIMITS.maxExtractedChars);
  });

  it('refuses invalid UTF-8 (binary disguised as text) — DOC_BINARY', async () => {
    const bytes = new Uint8Array([0x68, 0x69, 0xc3, 0x28, 0xff, 0xfe, 0x61, 0x62, 0x63, 0x64]);
    const errs = await fail(textUrl('text/plain', '').replace(/;base64,.*/, `;base64,${b64(bytes)}`));
    expect(errs[0].code).toBe('DOC_BINARY');
  });

  it('refuses NUL bytes in a text document — DOC_BINARY', async () => {
    const errs = await fail(textUrl('text/plain', `hello\u0000world${' padding'.repeat(4)}`));
    expect(errs[0].code).toBe('DOC_BINARY');
  });

  it('refuses a control-byte bomb — DOC_BINARY', async () => {
    const errs = await fail(textUrl('text/plain', '\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008ok'));
    expect(errs[0].code).toBe('DOC_BINARY');
  });

  it('refuses mimes outside the allow-list — DOC_MIME (images keep the vision path)', async () => {
    const errs = await fail(dataUrl('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])));
    expect(errs[0].code).toBe('DOC_MIME');
    const errs2 = await fail(textUrl('application/msword', 'doc content padding'));
    expect(errs2[0].code).toBe('DOC_MIME');
  });
});

/* ─────────────────────────── PDF family ─────────────────────────── */

describe('agent-docs — application/pdf', () => {
  it('extracts text from an uncompressed content stream (Tj + TJ operators)', async () => {
    const [doc] = await ok({ name: 'facture.pdf', data_url: dataUrl('application/pdf', makePdf()) });
    expect(doc).toMatchObject({ kind: 'pdf', mime: 'application/pdf', extraction: 'ok', pages: 1 });
    expect(doc.text).toContain('Hello Atlas');
    expect(doc.text).toContain('Bonjour'); // TJ array concatenated across the kerning gap
  });

  it('extracts text from a FlateDecode (zlib) stream', async () => {
    const [doc] = await ok(dataUrl('application/pdf', makePdf({ flate: true, content: 'BT (Loyer payé 1500 MAD) Tj ET' })));
    expect(doc.extraction).toBe('ok');
    expect(doc.text).toContain('Loyer payé 1500 MAD');
  });

  it('counts declared pages and never guesses when absent', async () => {
    const [d3] = await ok(dataUrl('application/pdf', makePdf({ pages: 3 })));
    expect(d3.pages).toBe(3);
    // A minimal file with the magic header but no /Type /Page objects:
    const bare = new TextEncoder().encode('%PDF-1.4\ntrailer\n<<>>\n%%EOF padding');
    const [d0] = await ok(dataUrl('application/pdf', bare));
    expect(d0.pages).toBeNull();
    expect(d0.extraction).toBe('empty');
  });

  it('refuses a PDF over the page limit — DOC_PAGES', async () => {
    const errs = await fail(dataUrl('application/pdf', makePdf({ pages: AGENT_DOC_LIMITS.maxPdfPages + 1 })));
    expect(errs[0].code).toBe('DOC_PAGES');
    expect(errs[0].error).toContain(String(AGENT_DOC_LIMITS.maxPdfPages));
  });

  it('refuses a data-URL claiming application/pdf without the %PDF- magic — DOC_MAGIC', async () => {
    const errs = await fail(textUrl('application/pdf', 'ceci n est pas un pdf (padding)'));
    expect(errs[0].code).toBe('DOC_MAGIC');
  });

  it('refuses PDF bytes declared as text/plain — DOC_BINARY (MIME laundering)', async () => {
    const pdf = makePdf();
    // Real PDFs contain NUL/binary bytes; make sure the fixture does:
    const withNul = Buffer.concat([Buffer.from(pdf), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])]);
    const errs = await fail(dataUrl('text/plain', new Uint8Array(withNul)));
    expect(errs[0].code).toBe('DOC_BINARY');
  });

  it('a valid PDF with no text operators (scan) → extraction empty, never invented', async () => {
    const [doc] = await ok(dataUrl('application/pdf', makePdf({ noTextOps: true })));
    expect(doc.extraction).toBe('empty');
    expect(doc.text).toBe('');
    expect(doc.pages).toBe(1);
  });

  it('hex strings are decoded too', async () => {
    const [doc] = await ok(dataUrl('application/pdf', makePdf({ content: 'BT <48656C6C6F> Tj ET' })));
    expect(doc.text).toContain('Hello');
  });
});

/* ─────────────────────────── global bounds ─────────────────────────── */

describe('agent-docs — hard bounds', () => {
  it('refuses more than 2 documents — DOC_COUNT', async () => {
    const errs = await fail([
      textUrl('text/plain', 'un padding'),
      textUrl('text/plain', 'deux padding'),
      textUrl('text/plain', 'trois padding'),
    ]);
    expect(errs[0].code).toBe('DOC_COUNT');
  });

  it('refuses a document over the decoded byte limit — DOC_TOO_LARGE', async () => {
    const big = new Uint8Array(AGENT_DOC_LIMITS.maxBytesPerDocument + 1).fill(0x61);
    const errs = await fail(dataUrl('text/plain', big));
    expect(errs[0].code).toBe('DOC_TOO_LARGE');
  });

  it('refuses garbage that is not a data-URL — DOC_FORMAT', async () => {
    const errs = await fail(['http://example.com/file.pdf']);
    expect(errs[0].code).toBe('DOC_FORMAT');
    // a non-list `documents` field is refused as-is (route contract)
    const r = await parseAgentDocumentsAsync('not-a-list');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('DOC_FORMAT');
  });

  it('refuses broken base64 — DOC_ENCODING', async () => {
    const errs = await fail(['data:text/plain;base64,!!!not-base64!!!']);
    expect(errs[0].code).toBe('DOC_ENCODING');
  });

  it('empty/absent input is a no-op (ok, zero docs)', async () => {
    expect((await ok(undefined))).toHaveLength(0);
    expect((await ok([]))).toHaveLength(0);
    expect((await ok(null))).toHaveLength(0);
  });

  it('ALL-OR-NOTHING: one invalid document fails the whole batch and lists every error', async () => {
    const errs = await fail([
      textUrl('text/plain', 'valide padding'),
      textUrl('image/gif', 'GIF89a-padding'),
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe('DOC_MIME');
  });

  it('names are bounded and defaulted', async () => {
    const [d1, d2] = await ok([
      { name: 'x'.repeat(200), data_url: textUrl('text/plain', 'aaa padding') },
      textUrl('text/plain', 'bbb padding'),
    ]);
    expect(d1.name).toHaveLength(80);
    expect(d2.name).toBe('document-2');
  });
});

/* ─────────────────────────── prompt section ─────────────────────────── */

describe('agentDocumentPromptSection — honest prompting', () => {
  const base: AgentDocExcerpt = {
    name: 'f.pdf', mime: 'application/pdf', kind: 'pdf', bytes: 1234,
    pages: 2, chars: 10, truncated: false, text: 'Bonjour', extraction: 'ok',
  };

  it('returns "" when there is nothing', () => {
    expect(agentDocumentPromptSection([])).toBe('');
  });

  it('includes name, mime, page count and the extracted text', () => {
    const s = agentDocumentPromptSection([base]);
    expect(s).toContain('f.pdf');
    expect(s).toContain('application/pdf');
    expect(s).toContain('2 pages');
    expect(s).toContain('Bonjour');
  });

  it('an unreadable document says so and forbids invention', () => {
    const s = agentDocumentPromptSection([{ ...base, extraction: 'empty', text: '', chars: 0 }]);
    expect(s).toContain('non extractible');
    expect(s).toContain('Ne pas inventer');
  });

  it('a truncated excerpt is flagged as such', () => {
    const s = agentDocumentPromptSection([{ ...base, truncated: true }]);
    expect(s).toContain('tronqué');
  });
});

/* ─────────────────────────── SSE streaming ─────────────────────────── */

function sseResponse(chunks: string[], init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const enc = new TextEncoder();
      for (const ch of chunks) ctrl.enqueue(enc.encode(ch));
      ctrl.close();
    },
  });
  return new Response(body, { status });
}

describe('groqChatStream — SSE parsing, scrubbing, real usage', () => {
  const KEY = 'gsk_test';

  it('forwards deltas in order, scrubs provider names, returns model + usage', async () => {
    const deltas: string[] = [];
    const fetchImpl = (async () => sseResponse([
      'data: {"model":"llama-x","choices":[{"delta":{"content":"Bon"}}]}\n\n',
      // a chunk split across TCP frames must still parse:
      'data: {"choices":[{"delta":{"content":"jour, fourni par Gr',
      'oq"}}]}\n\ndata: {"x_groq":{"usage":{"prompt_tokens":42,"completion_tokens":7}}}\n\n',
      'data: [DONE]\n\n',
    ])) as unknown as typeof fetch;
    const out = await groqChatStream({
      apiKey: KEY, system: 'sys', message: 'salut', onToken: (t) => deltas.push(t), fetchImpl,
    });
    expect(deltas).toEqual(['Bon', 'jour, fourni par Groq']);
    expect(out.reply).toBe('Bonjour, fourni par Atlas Agent'); // provider scrubbed
    expect(out.model).toBe('llama-x');
    expect(out.usage).toEqual({ prompt: 42, completion: 7 });
  });

  it('posts stream:true with the requested model and token cap', async () => {
    let sentBody: any = null;
    const fetchImpl = (async (_u: any, init: any) => {
      sentBody = JSON.parse(init.body);
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']);
    }) as unknown as typeof fetch;
    await groqChatStream({ apiKey: KEY, model: 'm', system: 'S', message: 'M', maxTokens: 321, onToken: () => {}, fetchImpl });
    expect(sentBody).toMatchObject({ model: 'm', stream: true, max_tokens: 321 });
    expect(sentBody.messages[0]).toEqual({ role: 'system', content: 'S' });
  });

  it('429 → French quota error; 401 → key error; 5xx → unavailable error', async () => {
    const mk = (status: number) => (async () => sseResponse([], { status })) as unknown as typeof fetch;
    await expect(groqChatStream({ apiKey: KEY, system: 's', message: 'm', onToken: () => {}, fetchImpl: mk(429) }))
      .rejects.toThrow(/Quota Groq/);
    await expect(groqChatStream({ apiKey: KEY, system: 's', message: 'm', onToken: () => {}, fetchImpl: mk(401) }))
      .rejects.toThrow(/clé Groq refusée/);
    await expect(groqChatStream({ apiKey: KEY, system: 's', message: 'm', onToken: () => {}, fetchImpl: mk(503) }))
      .rejects.toThrow(/indisponible en flux/);
  });

  it('an empty stream never yields a fake reply', async () => {
    const fetchImpl = (async () => sseResponse(['data: [DONE]\n\n'])) as unknown as typeof fetch;
    await expect(groqChatStream({ apiKey: KEY, system: 's', message: 'm', onToken: () => {}, fetchImpl }))
      .rejects.toThrow(/réponse vide/);
  });

  it('malformed SSE lines are skipped, not fatal', async () => {
    const fetchImpl = (async () => sseResponse([
      ': keep-alive comment\n\n',
      'data: {broken json\n\n',
      'event: ping\ndata: {"choices":[{"delta":{"content":"salut"}}]}\n\n',
      'data: [DONE]\n\n',
    ])) as unknown as typeof fetch;
    const out = await groqChatStream({ apiKey: KEY, system: 's', message: 'm', onToken: () => {}, fetchImpl });
    expect(out.reply).toBe('salut');
  });
});
