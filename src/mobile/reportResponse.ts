/** Read a bounded report body even when a server omits Content-Length. */
export async function readReportBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('Rapport trop volumineux pour la lecture mobile.');
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Rapport vide ou trop volumineux.');
    return bytes;
  }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Rapport trop volumineux pour la lecture mobile.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('Rapport vide.');
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
