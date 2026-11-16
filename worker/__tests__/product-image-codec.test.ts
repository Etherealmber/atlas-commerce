import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeProductImage, PRODUCT_IMAGE_EDGE } from '../lib/product-image-codec';

describe('product image codec', () => {
  it('crops and resizes, strips metadata, and creates a valid WebP', async () => {
    const source = await sharp({ create: { width: 1400, height: 900, channels: 3, background: '#369' } }).jpeg().withMetadata().toBuffer();
    const out = await normalizeProductImage(source);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: PRODUCT_IMAGE_EDGE, height: PRODUCT_IMAGE_EDGE });
    expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined();
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('applies EXIF orientation %i before the center crop', async (orientation) => {
    const w = 80, h = 120;
    const pixels = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3;
      pixels[p] = x < w / 2 ? 230 : 20;
      pixels[p + 1] = y < h / 2 ? 230 : 20;
      pixels[p + 2] = y < h / 2 ? 20 : 230;
    }
    const source = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation }).toBuffer();
    const out = await normalizeProductImage(source);
    const transformed = await sharp(source).rotate().toBuffer({ resolveWithObject: true });
    const side = Math.min(transformed.info.width, transformed.info.height);
    const expected = await sharp(transformed.data).extract({ left: Math.floor((transformed.info.width - side) / 2), top: Math.floor((transformed.info.height - side) / 2), width: side, height: side }).removeAlpha().raw().toBuffer();
    const actual = await sharp(out).removeAlpha().raw().toBuffer();
    let error = 0;
    for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i] - expected[i]);
    expect(error / actual.length).toBeLessThan(10);
    expect((await sharp(out).metadata()).orientation).toBeUndefined();
  });
  it.each(['png', 'webp'] as const)('honors orientation metadata embedded in %s', async (format) => {
    const pixels = Buffer.alloc(60 * 90 * 3);
    for (let y = 0; y < 90; y++) for (let x = 0; x < 60; x++) {
      const p = (y * 60 + x) * 3; pixels[p] = x < 30 ? 240 : 10; pixels[p + 1] = y < 45 ? 240 : 10; pixels[p + 2] = 25;
    }
    const source = await sharp(pixels, { raw: { width: 60, height: 90, channels: 3 } }).toFormat(format).withMetadata({ orientation: 6 }).toBuffer();
    const expectedImage = await sharp(source).rotate().toBuffer({ resolveWithObject: true });
    const side = Math.min(expectedImage.info.width, expectedImage.info.height);
    const expected = await sharp(expectedImage.data).extract({ left: Math.floor((expectedImage.info.width - side) / 2), top: Math.floor((expectedImage.info.height - side) / 2), width: side, height: side }).removeAlpha().raw().toBuffer();
    const actual = await sharp(await normalizeProductImage(source)).removeAlpha().raw().toBuffer();
    let error = 0; for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i] - expected[i]);
    expect(error / actual.length).toBeLessThan(10);
  });
  it('accepts JPEG, PNG, WebP and static GIF pixels without enlarging', async () => {
    const png = await sharp({ create: { width: 24, height: 15, channels: 4, background: '#15a8' } }).png().toBuffer();
    const variants = [await sharp(png).jpeg().toBuffer(), png, await sharp(png).webp().toBuffer(), await sharp(png).gif().toBuffer()];
    for (const input of variants) {
      const info = await sharp(await normalizeProductImage(input)).metadata();
      expect(info).toMatchObject({ format: 'webp', width: 15, height: 15 });
    }
  });
  it('converts an animated GIF to its first frame', async () => {
    const w = 20, h = 20, pixels = Buffer.alloc(w * h * 2 * 3);
    for (let y = 0; y < h * 2; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3; pixels[p] = y < h ? 255 : 0; pixels[p + 1] = y < h ? 0 : 255;
    }
    const gif = await sharp(pixels, { raw: { width: w, height: h * 2, channels: 3, pageHeight: h } }).gif({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2);
    const webp = await normalizeProductImage(gif);
    expect(await sharp(webp).metadata()).toMatchObject({ format: 'webp', width: w, height: h });
    const raw = await sharp(webp).removeAlpha().raw().toBuffer();
    expect(raw[0]).toBeGreaterThan(200); expect(raw[1]).toBeLessThan(40);
  });
  it('rejects invalid and oversized dimensions', async () => {
    await expect(normalizeProductImage(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
    await expect(normalizeProductImage(png.subarray(0, 33))).rejects.toThrow();
    expect((await sharp(await normalizeProductImage(png)).metadata()).format).toBe('webp');
    const huge = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: 'red' } }).png().toBuffer();
    await expect(normalizeProductImage(huge)).rejects.toThrow();
  });
});
