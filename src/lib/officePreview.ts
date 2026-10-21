/**
 * Local Office preview — zero npm deps.
 * Google-Docs-like slide/document reading for PPTX & DOCX.
 */

export type OfficeSlide = {
  index: number;
  title: string;
  lines: string[];
  images: string[];
  /** Optional table grid for XLSX */
  table?: string[][];
};

type ZipEntry = { name: string; data: Uint8Array };

function u16(v: DataView, o: number) {
  return v.getUint16(o, true);
}
function u32(v: DataView, o: number) {
  return v.getUint32(o, true);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 0x10000); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP EOCD not found');
  const totalEntries = u16(view, eocd + 10);
  let cdOff = u32(view, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < totalEntries; n++) {
    if (u32(view, cdOff) !== 0x02014b50) break;
    const method = u16(view, cdOff + 10);
    const compSize = u32(view, cdOff + 20);
    const nameLen = u16(view, cdOff + 28);
    const extraLen = u16(view, cdOff + 30);
    const commentLen = u16(view, cdOff + 32);
    const localOff = u32(view, cdOff + 42);
    const nameBytes = bytes.subarray(cdOff + 46, cdOff + 46 + nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    cdOff += 46 + nameLen + extraLen + commentLen;

    if (u32(view, localOff) !== 0x04034b50) continue;
    const locNameLen = u16(view, localOff + 26);
    const locExtraLen = u16(view, localOff + 28);
    const dataStart = localOff + 30 + locNameLen + locExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = compressed.slice();
    else if (method === 8) {
      try {
        data = await inflateRaw(compressed);
      } catch {
        continue;
      }
    } else continue;
    entries.push({ name, data });
  }
  return entries;
}

function entryText(e: ZipEntry): string {
  return new TextDecoder('utf-8').decode(e.data);
}

/** Extract paragraph-ish text blocks from OOXML. */
function extractLines(xml: string, paraTag: 'a:p' | 'w:p', runTag: 'a:t' | 'w:t'): string[] {
  const lines: string[] = [];
  const paraRe = new RegExp(`<${paraTag}[\\s\\S]*?<\\/${paraTag}>`, 'gi');
  const runRe = new RegExp(`<${runTag}[^>]*>([\\s\\S]*?)<\\/${runTag}>`, 'gi');
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml))) {
    const block = pm[0];
    const parts: string[] = [];
    let rm: RegExpExecArray | null;
    runRe.lastIndex = 0;
    while ((rm = runRe.exec(block))) {
      const t = rm[1]!
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();
      if (t) parts.push(t);
    }
    const line = parts.join('').trim();
    if (line) lines.push(line);
  }
  if (!lines.length) {
    // fallback flat
    const flat = xml
      .replace(new RegExp(`<${runTag}[^>]*>`, 'gi'), '')
      .replace(new RegExp(`</${runTag}>`, 'gi'), ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (flat) lines.push(flat);
  }
  return lines;
}

function toDataUrl(name: string, data: Uint8Array): string | null {
  const lower = name.toLowerCase();
  let mime = '';
  if (lower.endsWith('.png')) mime = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  else return null;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function previewPptx(blob: Blob): Promise<OfficeSlide[]> {
  const entries = await unzip(await blob.arrayBuffer());
  const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/'), e]));
  const media = new Map<string, string>();
  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/');
    if (!/^ppt\/media\//i.test(n)) continue;
    const url = toDataUrl(n, e.data);
    if (!url) continue;
    media.set(n.toLowerCase(), url);
    media.set(n.split('/').pop()!.toLowerCase(), url);
  }

  const slidePaths = entries
    .map((e) => e.name.replace(/\\/g, '/'))
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1] || 0) - Number(b.match(/(\d+)/)?.[1] || 0));

  if (!slidePaths.length) {
    return [{ index: 1, title: 'Diapositive 1', lines: ['Aucune diapositive trouvée.'], images: [] }];
  }

  const slides: OfficeSlide[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i]!;
    const xml = entryText(byName.get(path)!);
    const lines = extractLines(xml, 'a:p', 'a:t');
    const relPath = path.replace('slides/slide', 'slides/_rels/slide') + '.rels';
    const relEntry = byName.get(relPath);
    const images: string[] = [];
    if (relEntry) {
      const relXml = entryText(relEntry);
      const re = /Target="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(relXml))) {
        let target = m[1]!.replace(/\\/g, '/');
        if (target.startsWith('../')) target = 'ppt/' + target.replace(/^\.\.\//, '');
        const base = target.split('/').pop()!.toLowerCase();
        const data = media.get(target.toLowerCase()) || media.get(base);
        if (data && !images.includes(data)) images.push(data);
      }
    }
    slides.push({
      index: i + 1,
      title: lines[0] || `Diapositive ${i + 1}`,
      lines: lines.length ? lines : images.length ? [] : ['(Diapositive sans texte)'],
      images,
    });
  }
  return slides;
}

export async function previewDocx(blob: Blob): Promise<OfficeSlide[]> {
  const entries = await unzip(await blob.arrayBuffer());
  const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/'), e]));
  const doc = byName.get('word/document.xml');
  const lines = doc ? extractLines(entryText(doc), 'w:p', 'w:t') : [];
  const images: string[] = [];
  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/');
    if (!/^word\/media\//i.test(n)) continue;
    const url = toDataUrl(n, e.data);
    if (url) {
      images.push(url);
      if (images.length >= 12) break;
    }
  }
  return [
    {
      index: 1,
      title: 'Document',
      lines: lines.length ? lines : ['Pas de texte extractible.'],
      images,
    },
  ];
}


function colLettersToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseCellRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  return { c: colLettersToIndex(m[1]!.toUpperCase()), r: Number(m[2]) - 1 };
}

export async function previewXlsx(blob: Blob): Promise<OfficeSlide[]> {
  const entries = await unzip(await blob.arrayBuffer());
  const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/'), e]));

  // Shared strings
  const shared: string[] = [];
  const ss = byName.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = entryText(ss);
    // each <si>…</si>
    const siRe = /<si[\s\S]*?<\/si>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = siRe.exec(xml))) {
      const block = sm[0];
      const parts: string[] = [];
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(block))) {
        parts.push(
          tm[1]!
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))),
        );
      }
      shared.push(parts.join(''));
    }
  }

  // Sheet list from workbook
  const sheetFiles: { name: string; path: string }[] = [];
  const wb = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  const ridToTarget = new Map<string, string>();
  if (rels) {
    const relXml = entryText(rels);
    const re = /Id="([^"]+)"[^>]*Target="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relXml))) {
      let target = m[2]!.replace(/^\//, '');
      if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\.\.\//, '');
      ridToTarget.set(m[1]!, target.replace(/\\/g, '/'));
    }
    // also Target before Id
    const re2 = /Target="([^"]+)"[^>]*Id="([^"]+)"/gi;
    while ((m = re2.exec(relXml))) {
      let target = m[1]!.replace(/^\//, '');
      if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\.\.\//, '');
      ridToTarget.set(m[2]!, target.replace(/\\/g, '/'));
    }
  }
  if (wb) {
    const xml = entryText(wb);
    const re = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const target = ridToTarget.get(m[2]!);
      if (target) sheetFiles.push({ name: m[1]!, path: target });
    }
    // alternate attribute order
    const re2 = /<sheet[^>]*r:id="([^"]+)"[^>]*name="([^"]+)"[^>]*\/>/gi;
    while ((m = re2.exec(xml))) {
      const target = ridToTarget.get(m[1]!);
      if (target && !sheetFiles.some((s) => s.path === target)) {
        sheetFiles.push({ name: m[2]!, path: target });
      }
    }
  }
  // Fallback: any worksheet XML
  if (!sheetFiles.length) {
    for (const e of entries) {
      const n = e.name.replace(/\\/g, '/');
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(n)) {
        sheetFiles.push({ name: n.split('/').pop()!.replace(/\.xml$/i, ''), path: n });
      }
    }
    sheetFiles.sort((a, b) => a.path.localeCompare(b.path));
  }

  const slides: OfficeSlide[] = [];
  for (let si = 0; si < sheetFiles.length; si++) {
    const sheet = sheetFiles[si]!;
    const entry = byName.get(sheet.path) || byName.get(sheet.path.replace(/^xl\//, ''));
    if (!entry) continue;
    const xml = entryText(entry);
    // Build sparse grid from <c r="A1" ...>
    const cells = new Map<string, string>();
    let maxR = 0;
    let maxC = 0;
    const cellRe = /<c\s+([^>]+)>([\s\S]*?)<\/c>|<c\s+([^>]+)\/>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(xml))) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const refM = /r="([A-Z]+\d+)"/i.exec(attrs);
      if (!refM) continue;
      const ref = refM[1]!;
      const pos = parseCellRef(ref);
      if (!pos) continue;
      maxR = Math.max(maxR, pos.r);
      maxC = Math.max(maxC, pos.c);
      const tAttr = /t="([^"]+)"/.exec(attrs);
      const type = tAttr?.[1] || '';
      let val = '';
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const isM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      if (type === 's' && vM) {
        const idx = Number(vM[1]);
        val = shared[idx] ?? '';
      } else if (type === 'inlineStr' && isM) {
        val = isM[1] || '';
      } else if (vM) {
        val = vM[1] || '';
      } else if (isM) {
        val = isM[1] || '';
      }
      val = val
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      cells.set(`${pos.r}:${pos.c}`, val);
    }
    // Cap preview size for UI
    const rowLimit = Math.min(maxR + 1, 80);
    const colLimit = Math.min(maxC + 1, 20);
    const table: string[][] = [];
    for (let r = 0; r < rowLimit; r++) {
      const row: string[] = [];
      for (let c = 0; c < colLimit; c++) {
        row.push(cells.get(`${r}:${c}`) || '');
      }
      // skip fully empty rows
      if (row.every((x) => !x)) continue;
      table.push(row);
    }
    // Trim empty trailing columns
    if (table.length) {
      let lastCol = 0;
      for (const row of table) {
        for (let c = row.length - 1; c >= 0; c--) {
          if (row[c]) {
            lastCol = Math.max(lastCol, c);
            break;
          }
        }
      }
      for (let i = 0; i < table.length; i++) table[i] = table[i]!.slice(0, lastCol + 1);
    }
    slides.push({
      index: si + 1,
      title: sheet.name || `Feuille ${si + 1}`,
      lines: table.length
        ? [`${table.length} ligne(s) · ${(table[0]?.length || 0)} colonne(s)`]
        : ['Feuille vide'],
      images: [],
      table: table.length ? table : [['(vide)']],
    });
  }
  if (!slides.length) {
    return [{ index: 1, title: 'Classeur', lines: ['Aucune feuille trouvée.'], images: [], table: [['(vide)']] }];
  }
  return slides;
}

export async function buildOfficePreview(blob: Blob, filename: string): Promise<OfficeSlide[] | null> {
  const n = filename.toLowerCase();
  if (n.endsWith('.pptx')) return previewPptx(blob);
  if (n.endsWith('.docx')) return previewDocx(blob);
  if (n.endsWith('.xlsx')) return previewXlsx(blob);
  return null;
}
