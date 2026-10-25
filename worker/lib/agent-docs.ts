/**
 * v264 — Atlas Agent document ingestion: BOUNDED, MIME-VALIDATED extraction.
 *
 * Before this module, attached PDFs never reached the model at all (the SPA
 * only inlined client-side text excerpts for text/* files and image data-URLs
 * for vision) and the server trusted whatever the client put in the prompt.
 * Now the worker itself validates and extracts, server-side:
 *
 *  - allow-list of declared MIME types (PDF + plain-text family only);
 *  - MAGIC-BYTE validation — a data-URL claiming application/pdf must start
 *    with `%PDF-`; text types must decode as strict UTF-8 with no NUL and no
 *    abnormal control-byte ratio. MIME laundering is rejected, never trusted;
 *  - hard bounds: max documents per message, max decoded bytes per document,
 *    max PDF pages, max extracted characters (same 12 000-char ceiling the SPA
 *    already used for text excerpts). Over a bound → explicit refusal with a
 *    stable code; nothing is silently truncated away except the extracted text
 *    itself, which is flagged `truncated: true`;
 *  - NEVER INFER: a valid PDF whose text cannot be extracted (scanned image,
 *    exotic encodings) yields `extraction: 'empty'` with an honest placeholder
 *    in the prompt — the model is told the content is unreadable instead of
 *    being fed invented text;
 *  - PDF text extraction is bounded and dependency-free: content streams are
 *    inflated with DecompressionStream('deflate') (zlib-wrapped FlateDecode,
 *    the PDF standard) and text-show operators (Tj / TJ / ' / " + hex strings)
 *    are collected with a hard cap on streams processed and bytes inflated.
 *
 * Pure module (no Hono, no D1) → fully unit-tested in __tests__/agent-docs.test.ts.
 */

export const AGENT_DOC_LIMITS = {
  /** Max documents accepted per chat message. */
  maxDocuments: 2,
  /** Max DECODED bytes per document. */
  maxBytesPerDocument: 2_000_000,
  /** Max pages a PDF may declare (/Type /Page objects) — over → refusal. */
  maxPdfPages: 30,
  /** Max extracted characters handed to the model (SPA parity). */
  maxExtractedChars: 12_000,
  /** Max content streams inspected per PDF (bomb-safe bound). */
  maxPdfStreams: 40,
  /** Max inflated bytes per content stream. */
  maxInflatedBytes: 400_000,
} as const;

/** Declared-MIME allow-list. Images keep their existing vision path (data:image/*). */
export const AGENT_DOC_ALLOWED_MIME = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
] as const;

export type AgentDocExcerpt = {
  name: string;
  mime: string;
  kind: 'pdf' | 'text';
  bytes: number;
  /** PDF only — null when the document declares no countable page objects
   *  (never guessed). */
  pages: number | null;
  chars: number;
  truncated: boolean;
  /** Extracted text ('' when extraction yielded nothing). */
  text: string;
  /** 'ok' = real text extracted; 'empty' = valid file, no extractable text. */
  extraction: 'ok' | 'empty';
};

export type AgentDocError = { name: string; code: string; error: string };

export type AgentDocsResult =
  | { ok: true; docs: AgentDocExcerpt[] }
  | { ok: false; errors: AgentDocError[] };

type RawDocInput = string | { name?: string; data_url?: string; url?: string; data?: string };

function decodeDataUrl(raw: string): { mime: string; base64: boolean; payload: string } | null {
  const m = raw.match(/^data:([^;,]*)(;[^,]*)?,([\s\S]*)$/);
  if (!m) return null;
  return { mime: m[1].trim().toLowerCase(), base64: /;base64/i.test(m[2] || ''), payload: m[3] };
}

function b64ToBytes(payload: string): Uint8Array | null {
  try {
    const clean = payload.replace(/[\r\n\s]/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  const CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return s;
}

/** Strict UTF-8 decode + binary-content heuristics for the text family. */
function validateTextBytes(bytes: Uint8Array): { text: string } | { error: string } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { error: 'Contenu non-UTF-8 — fichier texte invalide ou binaire déguisé.' };
  }
  if (text.includes('\u0000')) return { error: 'Octet NUL détecté — contenu binaire refusé en document texte.' };
  let control = 0;
  const scan = text.slice(0, 20_000);
  for (const ch of scan) {
    const cp = ch.codePointAt(0) || 0;
    if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) control++;
  }
  if (scan.length && control / scan.length > 0.02) {
    return { error: 'Trop de caractères de contrôle — contenu binaire refusé en document texte.' };
  }
  return { text };
}

/** Count /Type /Page objects (not /Pages) — a declared page count, never guessed. */
function countPdfPages(s: string): number | null {
  const matches = s.match(/\/Type\s*\/Page[^sA-Za-z]/g);
  if (!matches || !matches.length) return null;
  return matches.length;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes.slice() as unknown as BlobPart]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    const out = new Uint8Array(buf);
    if (out.length > AGENT_DOC_LIMITS.maxInflatedBytes) return out.subarray(0, AGENT_DOC_LIMITS.maxInflatedBytes);
    return out;
  } catch {
    return null;
  }
}

function unescapePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g: string) => {
    switch (g) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(g, 8));
    }
  });
}

/** Collect text-show operators from one (decoded) content stream. Bounded. */
function pdfTextFromContentStream(s: string, budget: number): string {
  const out: string[] = [];
  let used = 0;
  // Literal strings before Tj/'/" , TJ arrays, hex strings, and line breaks.
  const re = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|\[((?:[^[\]\\]|\\.)*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|(T\*|Td|TD|ET)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    let piece = '';
    if (m[1] !== undefined) piece = unescapePdfString(m[1]);
    else if (m[2] !== undefined) {
      // TJ array: concatenate every literal string inside, keep the kerning gaps as-is.
      const inner = /\(((?:\\.|[^\\()])*)\)/g;
      let im: RegExpExecArray | null;
      while ((im = inner.exec(m[2])) !== null) piece += unescapePdfString(im[1]);
    } else if (m[3] !== undefined) {
      const hex = m[3].replace(/\s+/g, '');
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (!Number.isNaN(code)) piece += String.fromCharCode(code);
      }
    } else if (m[4] !== undefined) piece = '\n';
    if (!piece) continue;
    out.push(piece);
    used += piece.length;
    if (used > budget) break;
  }
  return out.join('');
}

/** Decode a content stream honestly: strict UTF-8 when the bytes are valid
 *  UTF-8 (modern generators), latin1 otherwise (PDFDocEncoding/WinAnsi is
 *  latin1-shaped — accent bytes land on the same code points). */
function decodeStreamBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}

/** Bounded PDF text extraction: inflate FlateDecode streams, collect text ops. */
async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const raw = latin1(bytes);
  const parts: string[] = [];
  let total = 0;
  let streams = 0;
  const streamRe = /(<<[^>]*(?:>(?!>)[^>]*)*>>)?\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null && streams < AGENT_DOC_LIMITS.maxPdfStreams) {
    const dict = m[1] || '';
    if (/\/Subtype\s*\/Image/.test(dict)) continue; // images → the vision path, not text
    const start = m.index + m[0].length;
    const endIdx = raw.indexOf('endstream', start);
    if (endIdx < 0) continue;
    streams++;
    // Byte-exact slice: the EOL before `endstream` is NOT part of the stream data.
    let byteEnd = endIdx;
    if (raw[byteEnd - 1] === '\n') byteEnd--;
    if (raw[byteEnd - 1] === '\r') byteEnd--;
    let slice = bytes.subarray(Math.min(start, bytes.length), Math.min(byteEnd, bytes.length));
    if (/\/FlateDecode/.test(dict)) {
      const inflated = await inflate(slice);
      if (!inflated) continue; // undecodable stream — honest skip, never invent
      slice = inflated;
    }
    const content = decodeStreamBytes(slice);
    if (!/(Tj|TJ)\b/.test(content)) continue;
    const piece = pdfTextFromContentStream(content, AGENT_DOC_LIMITS.maxExtractedChars);
    if (!piece) continue;
    parts.push(piece);
    total += piece.length;
    if (total >= AGENT_DOC_LIMITS.maxExtractedChars) break;
  }
  let text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = text.length > AGENT_DOC_LIMITS.maxExtractedChars;
  if (truncated) text = text.slice(0, AGENT_DOC_LIMITS.maxExtractedChars);
  return { text, truncated };
}

/**
 * Validate + extract every attached document. ALL-OR-NOTHING: if any document
 * fails validation the whole request is refused with per-document errors —
 * a rejected file is never silently dropped.
 */
export function parseAgentDocuments(input: unknown): AgentDocsResult | Promise<AgentDocsResult> {
  return parseAgentDocumentsAsync(input);
}

export async function parseAgentDocumentsAsync(input: unknown): Promise<AgentDocsResult> {
  if (input == null) return { ok: true, docs: [] };
  if (!Array.isArray(input)) {
    return { ok: false, errors: [{ name: 'documents', code: 'DOC_FORMAT', error: 'Le champ documents doit être une liste.' }] };
  }
  if (input.length === 0) return { ok: true, docs: [] };
  if (input.length > AGENT_DOC_LIMITS.maxDocuments) {
    return {
      ok: false,
      errors: [{
        name: 'documents',
        code: 'DOC_COUNT',
        error: `Trop de documents joints (${input.length}) — maximum ${AGENT_DOC_LIMITS.maxDocuments} par message.`,
      }],
    };
  }

  const docs: AgentDocExcerpt[] = [];
  const errors: AgentDocError[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i] as RawDocInput;
    const name = String((typeof item === 'object' && item?.name) || `document-${i + 1}`).slice(0, 80);
    const rawUrl = typeof item === 'string' ? item : String(item?.data_url || item?.url || item?.data || '');
    const fail = (code: string, error: string) => { errors.push({ name, code, error }); };

    const parsed = decodeDataUrl(rawUrl);
    if (!parsed) { fail('DOC_FORMAT', 'Document invalide — data-URL attendue (data:<mime>;base64,…).'); continue; }
    if (!(AGENT_DOC_ALLOWED_MIME as readonly string[]).includes(parsed.mime)) {
      fail('DOC_MIME', `Type refusé « ${parsed.mime || 'inconnu'} » — PDF ou texte brut uniquement (images : voie vision existante).`);
      continue;
    }
    const bytes = parsed.base64 ? b64ToBytes(parsed.payload) : new TextEncoder().encode(decodeURIComponent(parsed.payload));
    if (!bytes) { fail('DOC_ENCODING', 'Encodage base64 invalide.'); continue; }
    if (bytes.length > AGENT_DOC_LIMITS.maxBytesPerDocument) {
      fail('DOC_TOO_LARGE', `Document trop lourd (${bytes.length} octets) — maximum ${AGENT_DOC_LIMITS.maxBytesPerDocument} octets.`);
      continue;
    }
    if (bytes.length < 8) { fail('DOC_TOO_SMALL', 'Document vide ou illisible.'); continue; }

    if (parsed.mime === 'application/pdf') {
      const magic = latin1(bytes.subarray(0, 5));
      if (magic !== '%PDF-') { fail('DOC_MAGIC', 'PDF invalide — en-tête %PDF- absent (type déclaré ≠ contenu réel).'); continue; }
      const asText = latin1(bytes);
      const pages = countPdfPages(asText);
      if (pages !== null && pages > AGENT_DOC_LIMITS.maxPdfPages) {
        fail('DOC_PAGES', `PDF trop long (${pages} pages) — maximum ${AGENT_DOC_LIMITS.maxPdfPages} pages.`);
        continue;
      }
      const { text, truncated } = await extractPdfText(bytes);
      docs.push({
        name, mime: parsed.mime, kind: 'pdf', bytes: bytes.length, pages,
        chars: text.length, truncated, text, extraction: text ? 'ok' : 'empty',
      });
      continue;
    }

    // Text family — magic-content validation: strict UTF-8, no NUL, no binary smell.
    const v = validateTextBytes(bytes);
    if ('error' in v) { fail('DOC_BINARY', v.error); continue; }
    let text = v.text;
    const truncated = text.length > AGENT_DOC_LIMITS.maxExtractedChars;
    if (truncated) text = text.slice(0, AGENT_DOC_LIMITS.maxExtractedChars);
    docs.push({
      name, mime: parsed.mime, kind: 'text', bytes: bytes.length, pages: null,
      chars: text.length, truncated, text, extraction: text.trim() ? 'ok' : 'empty',
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, docs };
}

/**
 * Server-authored prompt section for validated documents. Honest by design:
 * an unreadable PDF says so explicitly — the model is instructed never to
 * invent its content.
 */
export function agentDocumentPromptSection(docs: AgentDocExcerpt[]): string {
  if (!docs.length) return '';
  const blocks = docs.map((d) => {
    const meta = [d.mime, d.pages ? `${d.pages} pages` : null, `${d.bytes} octets`].filter(Boolean).join(', ');
    const head = `--- Document joint (validé serveur) : ${d.name} (${meta}) ---`;
    if (d.extraction === 'empty') {
      return `${head}\n[Contenu non extractible : fichier valide mais sans texte lisible (document scanné ou encodage non pris en charge). Ne pas inventer de contenu — signale-le à l'utilisateur.]`;
    }
    return `${head}\n${d.text}${d.truncated ? `\n[Extrait tronqué à ${AGENT_DOC_LIMITS.maxExtractedChars} caractères — le document continue au-delà.]` : ''}`;
  });
  return `\n\nDocuments joints (extraits validés côté serveur — ne redemande pas ces fichiers) :\n${blocks.join('\n\n')}`;
}
