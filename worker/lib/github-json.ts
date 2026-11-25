/** Bounded upstream reads; an empty token deliberately uses anonymous GitHub access. */
export async function githubJson(url: string, token: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json', 'User-Agent': 'atlas-commerce-work-status' },
      redirect: 'manual', signal: controller.signal,
    });
    if (!response.ok) throw new Error('upstream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('empty');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 65536) { controller.abort(); throw new Error('oversize'); }
      chunks.push(part.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(data));
  } finally { clearTimeout(timer); }
}
