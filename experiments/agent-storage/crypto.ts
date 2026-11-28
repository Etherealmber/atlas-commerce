/** Offline prototype only: not imported by production Worker routes. */
const MAX_PLAINTEXT_BYTES = 1_500_000;
const MAX_ENVELOPE_CHARS = 2_100_000;
const enc = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  return Uint8Array.from(decoded, ch => ch.charCodeAt(0));
}
function context(account: string, thread: string): Uint8Array<ArrayBuffer> {
  if (!account || account.length > 200 || !thread || thread.length > 80) throw new Error('Invalid context');
  return enc.encode(JSON.stringify(['atlas-agent-history-v1', account, thread]));
}
async function importKey(encodedKey: string, usages: KeyUsage[]): Promise<CryptoKey> {
  // A dedicated uniformly random 32-byte key; no low-entropy password KDF.
  const bytes = base64ToBytes(encodedKey);
  if (bytes.length !== 32 || bytesToBase64(bytes) !== encodedKey) throw new Error('Invalid key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
}

/** Encrypts an opaque payload and binds it to its account and thread. */
export async function encryptAgentPayload(key: string, account: string, thread: string, payload: string): Promise<string> {
  const plain = enc.encode(payload);
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new Error('Payload too large');
  const aad = context(account, thread);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, await importKey(key, ['encrypt']), plain);
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(cipher)) });
}

/** Rejects corruption, wrong keys, wrong account/thread and unknown formats. */
export async function decryptAgentPayload(key: string, account: string, thread: string, envelope: string): Promise<string> {
  if (envelope.length > MAX_ENVELOPE_CHARS) throw new Error('Envelope too large');
  const parsed = JSON.parse(envelope);
  if (!parsed || parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.ciphertext !== 'string') throw new Error('Invalid envelope');
  const iv = base64ToBytes(parsed.iv); const ciphertext = base64ToBytes(parsed.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16) throw new Error('Invalid envelope');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context(account, thread), tagLength: 128 }, await importKey(key, ['decrypt']), ciphertext);
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}
