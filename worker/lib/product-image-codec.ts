import { PhotonImage, SamplingFilter, resize } from '@cf-wasm/photon';
import { imageSize } from 'image-size';
import { orientation as readOrientation } from 'exifr';
import webpFactory from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions } from '@jsquash/webp/meta.js';
import webpWasm from '@jsquash/webp/codec/enc/webp_enc.wasm';

export const PRODUCT_IMAGE_EDGE = 768;
const PRODUCT_IMAGE_QUALITY = 82;
export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 4_000_000;
const MAX_SOURCE_EDGE = 4096;

let encoder: ReturnType<typeof webpFactory> | undefined;
function getEncoder() {
  if (!encoder) {
    encoder = webpFactory({
      noInitialRun: true,
      instantiateWasm(imports: WebAssembly.Imports, callback: (instance: WebAssembly.Instance) => void) {
        const instance = new WebAssembly.Instance(webpWasm, imports);
        callback(instance);
        return instance.exports;
      },
    });
  }
  return encoder;
}

/** exifr reads TIFF/PNG/JPEG, but WebP EXIF lives inside a RIFF chunk. */
function webpExif(input: Uint8Array): Uint8Array | null {
  if (input.length < 12 || String.fromCharCode(...input.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...input.subarray(8, 12)) !== 'WEBP') return null;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  for (let pos = 12; pos + 8 <= input.length;) {
    const length = view.getUint32(pos + 4, true), start = pos + 8;
    if (length > input.length - start) break;
    if (String.fromCharCode(...input.subarray(pos, pos + 4)) === 'EXIF') {
      const chunk = input.subarray(start, start + length);
      const prefix = chunk.length >= 6 && String.fromCharCode(...chunk.subarray(0, 6)) === 'Exif\0\0';
      return chunk.subarray(prefix ? 6 : 0);
    }
    pos = start + length + (length & 1);
  }
  return null;
}

/** Validates bytes before decoding, applies EXIF orientation, crops centrally, and encodes WebP. */
export async function normalizeProductImage(input: Uint8Array): Promise<Uint8Array> {
  if (!input.length || input.length > PRODUCT_IMAGE_MAX_BYTES) throw new Error('IMAGE_SIZE');
  const info = imageSize(input);
  if (!['jpg', 'png', 'webp', 'gif'].includes(info.type || '') || !info.width || !info.height ||
      info.width > MAX_SOURCE_EDGE || info.height > MAX_SOURCE_EDGE || info.width * info.height > MAX_SOURCE_PIXELS) {
    throw new Error('IMAGE_FORMAT_OR_DIMENSIONS');
  }
  let orientation = 1;
  try { orientation = Number(await readOrientation(webpExif(input) || input)) || 1; } catch { /* image may have no EXIF */ }
  if (orientation < 1 || orientation > 8) orientation = 1;
  let decoded: PhotonImage | undefined;
  let square: PhotonImage | undefined;
  let resized: PhotonImage | undefined;
  try {
    decoded = PhotonImage.new_from_byteslice(input);
    const w = decoded.get_width(), h = decoded.get_height();
    if (w !== info.width || h !== info.height) throw new Error('IMAGE_DIMENSIONS');
    const pixels = decoded.get_raw_pixels();
    const ow = orientation >= 5 ? h : w, oh = orientation >= 5 ? w : h;
    const side = Math.min(ow, oh);
    const left = Math.floor((ow - side) / 2), top = Math.floor((oh - side) / 2);
    const crop = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const a = x + left, b = y + top;
        let sx = a, sy = b;
        switch (orientation) {
          case 2: sx = w - 1 - a; break;
          case 3: sx = w - 1 - a; sy = h - 1 - b; break;
          case 4: sy = h - 1 - b; break;
          case 5: sx = b; sy = a; break;
          case 6: sx = b; sy = h - 1 - a; break;
          case 7: sx = w - 1 - b; sy = h - 1 - a; break;
          case 8: sx = w - 1 - b; sy = a; break;
        }
        const from = (sy * w + sx) * 4, to = (y * side + x) * 4;
        crop[to] = pixels[from]; crop[to + 1] = pixels[from + 1]; crop[to + 2] = pixels[from + 2]; crop[to + 3] = pixels[from + 3];
      }
    }
    square = new PhotonImage(crop, side, side);
    const edge = Math.min(side, PRODUCT_IMAGE_EDGE);
    resized = side === edge ? undefined : resize(square, edge, edge, SamplingFilter.Lanczos3);
    const raw = (resized || square).get_raw_pixels();
    const module = await getEncoder();
    const result = module.encode(raw, edge, edge, { ...defaultOptions, quality: PRODUCT_IMAGE_QUALITY });
    if (!result || !result.length || result.length > PRODUCT_IMAGE_MAX_BYTES) throw new Error('IMAGE_ENCODING');
    return new Uint8Array(result);
  } finally {
    resized?.free(); square?.free(); decoded?.free();
  }
}
