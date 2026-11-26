/** Consume Atlas Agent SSE; only `done` makes a reply authoritative. */
export async function readAgentStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: any) => void,
  checkSession: () => void,
): Promise<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneData: any = null;
  const processFrame = (frame: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let parsed: any;
    try { parsed = JSON.parse(data.join('\n')); } catch { throw new Error('Réponse de l’agent invalide. Réessayez.'); }
    checkSession();
    if (event === 'error') throw Object.assign(new Error(String(parsed?.error || 'Agent indisponible. Réessayez.')), { code: parsed?.code });
    if (event === 'done') doneData = parsed;
    else onEvent(event, parsed);
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error('Réponse de l’agent trop volumineuse.');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        processFrame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);
    checkSession();
    if (!doneData) throw new Error('La réponse de l’agent a été interrompue. Réessayez.');
    return doneData;
  } catch (err) {
    try { await reader.cancel(); } catch { /* transport already closed */ }
    throw err;
  } finally {
    reader.releaseLock();
  }
}
