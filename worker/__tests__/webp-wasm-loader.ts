import { readFileSync } from 'node:fs';
const file = new URL('../../node_modules/@jsquash/webp/codec/enc/webp_enc.wasm', import.meta.url);
export default new WebAssembly.Module(readFileSync(file));
