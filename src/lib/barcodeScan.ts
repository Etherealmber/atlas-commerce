/**
 * Barcode scanner — NO native BarcodeDetector.
 * Primary: ZXing-C++ WebAssembly (zxing-wasm) — fast on iOS/Android/low-end.
 * Fallback: html5-qrcode (ZXing-js).
 * Full-frame live scan + multi-pass image decode (any position / rotation).
 *
 * Refs: github.com/Sec-ant/zxing-wasm, community WASM scanners (koder / zbar-wasm).
 */

export type ScanStop = () => void;

const ZXING_VERSION = '2.2.0';
const ZXING_IIFE = `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/iife/reader/index.js`;
const ZXING_WASM = `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/reader/zxing_reader.wasm`;

const RETAIL_FORMATS = [
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'UPC-E',
  'Code128',
  'Code39',
  'Code93',
  'Codabar',
  'ITF',
] as const;

let zxingReady: Promise<any> | null = null;
let html5Ready: Promise<any> | null = null;
let preloaded = false;

export function preloadBarcodeScanner(): void {
  if (preloaded) return;
  preloaded = true;
  void loadZXing().catch(() => {});
  void loadHtml5Qrcode().catch(() => {});
}

export function loadZXing(): Promise<any> {
  if (zxingReady) return zxingReady;
  const w = window as any;
  if (w.ZXingWASM?.readBarcodes) {
    zxingReady = Promise.resolve(w.ZXingWASM);
    return zxingReady;
  }
  zxingReady = (async () => {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[data-zxing-wasm]');
      if (existing) {
        if (w.ZXingWASM?.readBarcodes) return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('zxing load')));
        setTimeout(() => (w.ZXingWASM?.readBarcodes ? resolve() : reject(new Error('timeout'))), 12000);
        return;
      }
      const s = document.createElement('script');
      s.src = ZXING_IIFE;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.dataset.zxingWasm = '1';
      const t = setTimeout(() => reject(new Error('zxing timeout')), 15000);
      s.onload = () => {
        clearTimeout(t);
        resolve();
      };
      s.onerror = () => {
        clearTimeout(t);
        reject(new Error('Échec chargement scanner WASM (réseau / CDN). Réessayez ou utilisez Image.'));
      };
      document.head.appendChild(s);
    });
    const api = w.ZXingWASM;
    if (!api?.readBarcodes) throw new Error('Module scanner WASM incomplet — actualisez la page');
    try {
      api.prepareZXingModule?.({
        overrides: {
          locateFile: (path: string, prefix: string) => {
            if (String(path).endsWith('.wasm')) return ZXING_WASM;
            return prefix + path;
          },
        },
      });
    } catch {
      /* */
    }
    try {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      if (ctx) {
        const id = ctx.getImageData(0, 0, 32, 32);
        await api.readBarcodes(id, { maxNumberOfSymbols: 1, tryHarder: false });
      }
    } catch {
      /* warm-up */
    }
    return api;
  })();
  return zxingReady;
}

function loadHtml5Qrcode(): Promise<any> {
  const w = window as any;
  if (w.Html5Qrcode) return Promise.resolve(w.Html5Qrcode);
  if (html5Ready) return html5Ready;
  const urls = [
    'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  ];
  html5Ready = (async () => {
    for (const src of urls) {
      try {
        await new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[data-h5q="${src}"]`)) {
            if (w.Html5Qrcode) return resolve();
            const el = document.querySelector(`script[data-h5q="${src}"]`)!;
            el.addEventListener('load', () => resolve());
            el.addEventListener('error', () => reject());
            return;
          }
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.crossOrigin = 'anonymous';
          s.dataset.h5q = src;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('load fail'));
          document.head.appendChild(s);
        });
        if (w.Html5Qrcode) return w.Html5Qrcode;
      } catch {
        /* next */
      }
    }
    throw new Error('html5-qrcode unavailable');
  })();
  return html5Ready;
}

export function isBarcodeLike(code: string): boolean {
  const c = String(code || '').trim().replace(/\s+/g, '');
  if (!c || c.includes('://') || /^https?/i.test(c)) return false;
  if (/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(c)) return true;
  return /^[0-9A-Za-z\-._/]{4,48}$/.test(c);
}

function normalizeCode(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, '');
}

function needHits(text: string): number {
  return /^\d{12,14}$/.test(text) ? 1 : 2;
}

const ZXING_OPTS = {
  tryHarder: true,
  formats: [...RETAIL_FORMATS],
  maxNumberOfSymbols: 1,
};

async function zxingDecodeImageData(imageData: ImageData): Promise<string | null> {
  const api = await loadZXing();
  const results = await api.readBarcodes(imageData, ZXING_OPTS);
  const text = results?.[0]?.text;
  if (text && isBarcodeLike(text)) return normalizeCode(text);
  return null;
}

async function zxingDecodeBlob(blob: Blob): Promise<string | null> {
  const api = await loadZXing();
  const results = await api.readBarcodes(blob, ZXING_OPTS);
  const text = results?.[0]?.text;
  if (text && isBarcodeLike(text)) return normalizeCode(text);
  return null;
}

export async function startBarcodeScan(
  containerOrVideo: HTMLElement | HTMLVideoElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop> {
  let stopped = false;
  let stream: MediaStream | null = null;
  let raf = 0;
  let inFlight = false;
  let last = '';
  let hits = 0;
  let video: HTMLVideoElement;
  let html5Stop: ScanStop | null = null;

  const stop: ScanStop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    try {
      html5Stop?.();
    } catch {
      /* */
    }
    html5Stop = null;
  };

  const emit = (raw: string) => {
    if (stopped) return;
    const text = normalizeCode(raw);
    if (!isBarcodeLike(text)) return;
    if (text === last) hits++;
    else {
      last = text;
      hits = 1;
    }
    if (hits < needHits(text)) return;
    onCode(text);
    stop();
  };

  try {
    await loadZXing();

    if (containerOrVideo instanceof HTMLVideoElement) {
      video = containerOrVideo;
      video.style.display = 'block';
    } else {
      video =
        (containerOrVideo.querySelector('video') as HTMLVideoElement) ||
        document.createElement('video');
      if (!video.parentElement) {
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        video.autoplay = true;
        video.style.cssText =
          'width:100%;max-height:320px;object-fit:cover;background:#000;border-radius:12px';
        containerOrVideo.appendChild(video);
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Caméra non accessible (HTTPS requis)');
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }

    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas indisponible');

    let frameSkip = 0;
    const skipEvery = 1;

    const tick = async () => {
      if (stopped) return;
      if (inFlight) {
        raf = requestAnimationFrame(() => {
          void tick();
        });
        return;
      }
      if (frameSkip++ % (skipEvery + 1) !== 0) {
        raf = requestAnimationFrame(() => {
          void tick();
        });
        return;
      }
      try {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const maxW = 720; // lower = less WASM memory on phones
          const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
          const w = Math.max(1, Math.round(video.videoWidth * scale));
          const h = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(video, 0, 0, w, h);
          inFlight = true;
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = await zxingDecodeImageData(imageData);
          inFlight = false;
          if (code) {
            emit(code);
            return;
          }
        }
      } catch {
        inFlight = false;
      }
      if (!stopped) {
        raf = requestAnimationFrame(() => {
          void tick();
        });
      }
    };
    raf = requestAnimationFrame(() => {
      void tick();
    });
    return stop;
  } catch (e1: any) {
    try {
      html5Stop = await startHtml5Scan(containerOrVideo, onCode, onError);
      return () => {
        stopped = true;
        html5Stop?.();
      };
    } catch (e2: any) {
      const msg = String(e1?.message || e2?.message || '');
      onError?.(
        msg.includes('WASM') || msg.includes('zxing') || msg.includes('CDN') || msg.includes('timeout')
          ? 'Scanner WASM non chargé (réseau). Utilisez Image ou saisissez le code.'
          : msg || 'Scanner indisponible — utilisez Image ou saisissez le code'
      );
      return stop;
    }
  }
}

async function startHtml5Scan(
  containerOrVideo: HTMLElement | HTMLVideoElement,
  onCode: (code: string) => void,
  _onError?: (msg: string) => void
): Promise<ScanStop> {
  const Html5Qrcode = await loadHtml5Qrcode();
  let stopped = false;
  let scanner: any = null;
  let last = '';
  let hits = 0;

  const stop: ScanStop = () => {
    stopped = true;
    try {
      if (scanner?.isScanning) scanner.stop().catch(() => {});
      scanner?.clear?.();
    } catch {
      /* */
    }
    scanner = null;
  };

  const emit = (raw: string) => {
    if (stopped) return;
    const text = normalizeCode(raw);
    if (!isBarcodeLike(text)) return;
    if (text === last) hits++;
    else {
      last = text;
      hits = 1;
    }
    if (hits < needHits(text)) return;
    onCode(text);
    stop();
  };

  let elementId: string;
  if (containerOrVideo instanceof HTMLVideoElement) {
    const parent = containerOrVideo.parentElement;
    if (!parent) throw new Error('Pas de conteneur');
    let box = parent.querySelector('[data-h5-reader]') as HTMLElement | null;
    if (!box) {
      box = document.createElement('div');
      box.dataset.h5Reader = '1';
      box.id = `h5reader-${Date.now()}`;
      box.style.cssText =
        'width:100%;min-height:220px;border-radius:12px;overflow:hidden;background:#000';
      parent.insertBefore(box, containerOrVideo);
    }
    containerOrVideo.style.display = 'none';
    elementId = box.id;
  } else {
    if (!containerOrVideo.id) containerOrVideo.id = `h5reader-${Date.now()}`;
    elementId = containerOrVideo.id;
  }

  const F = Html5Qrcode.Html5QrcodeSupportedFormats || (window as any).Html5QrcodeSupportedFormats;
  const formats = F
    ? [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.CODABAR, F.ITF].filter(
        (x: any) => x != null
      )
    : undefined;

  scanner = new Html5Qrcode(elementId, false);
  const config: any = {
    fps: 12,
    qrbox: (viewW: number, viewH: number) => ({
      width: Math.floor(viewW * 0.95),
      height: Math.floor(viewH * 0.95),
    }),
    aspectRatio: 1.333,
    disableFlip: false,
  };
  if (formats?.length) config.formatsToSupport = formats;

  await scanner.start(
    { facingMode: 'environment' },
    config,
    (decoded: string) => emit(decoded),
    () => {}
  );
  return stop;
}

export async function captureAndDecode(
  video: HTMLVideoElement | null
): Promise<string | null> {
  let vid = video;
  if (!vid?.videoWidth) {
    vid = document.querySelector(
      '.ph-cam-wrap video, [data-h5-reader] video, #ph-h5-reader video'
    ) as HTMLVideoElement | null;
  }
  if (!vid?.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = vid.videoWidth;
  c.height = vid.videoHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(vid, 0, 0);
  return decodeCanvas(c);
}

export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const candidates = buildCandidates(canvas);
  for (const c of candidates) {
    try {
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const hit = await zxingDecodeImageData(id);
      if (hit) return hit;
    } catch {
      /* */
    }
  }
  try {
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', 0.92)
    );
    if (blob) {
      const file = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
      const viaH5 = await html5ScanFile(file);
      if (viaH5) return viaH5;
    }
  } catch {
    /* */
  }
  return null;
}

export async function decodeImageFile(file: File): Promise<string | null> {
  try {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')) {
    throw new Error('Image HEIC (iPhone) non supportée ici. Ouvrez-la dans Photos → partagez en JPEG ou PNG, puis réessayez.');
  }

    const hit = await zxingDecodeBlob(file);
    if (hit) return hit;
  } catch {
    /* */
  }
  try {
    const canvas = await fileToCanvas(file);
    const hit = await decodeCanvas(canvas);
    if (hit) return hit;
  } catch {
    /* */
  }
  try {
    const hit = await html5ScanFile(file);
    if (hit) return hit;
  } catch {
    /* */
  }
  return null;
}

async function html5ScanFile(file: File): Promise<string | null> {
  const Html5Qrcode = await loadHtml5Qrcode();
  const tmpId = `h5f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const div = document.createElement('div');
  div.id = tmpId;
  div.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(div);
  const scanner = new Html5Qrcode(tmpId);
  try {
    const result = await scanner.scanFile(file, false);
    await scanner.clear?.();
    div.remove();
    if (result && isBarcodeLike(String(result))) return normalizeCode(String(result));
  } catch {
    try {
      await scanner.clear?.();
    } catch {
      /* */
    }
    div.remove();
  }
  return null;
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('ctx');
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return c;
  } catch {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('ctx'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('img'));
      };
      img.src = url;
    });
  }
}

function buildCandidates(source: HTMLCanvasElement): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [source];
  const w = source.width;
  const h = source.height;
  if (w < 8 || h < 8) return out;

  // Cap large photos early (memory limit on low-end devices)
  if (w > 1024 || h > 1024) {
    out.push(scaleCanvas(source, 1024 / Math.max(w, h)));
  }
  for (const deg of [90, 180, 270]) out.push(rotateCanvas(source, deg));

  const regions: [number, number, number, number][] = [
    [0.05, 0.05, 0.9, 0.9],
    [0, 0, 1, 0.5],
    [0, 0.5, 1, 0.5],
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 1],
    [0.05, 0.3, 0.9, 0.4],
    [0.2, 0.05, 0.6, 0.9],
    [0, 0, 0.55, 0.55],
    [0.45, 0, 0.55, 0.55],
    [0, 0.45, 0.55, 0.55],
    [0.45, 0.45, 0.55, 0.55],
  ];
  for (const [rx, ry, rw, rh] of regions) {
    const crop = cropCanvas(source, rx * w, ry * h, rw * w, rh * h);
    if (crop) out.push(crop);
  }
  out.push(contrastCanvas(source));
  return out;
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, c.width, c.height);
  }
  return c;
}

function rotateCanvas(source: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180;
  const c = document.createElement('canvas');
  if (deg === 90 || deg === 270) {
    c.width = source.height;
    c.height = source.width;
  } else {
    c.width = source.width;
    c.height = source.height;
  }
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return c;
}

function cropCanvas(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): HTMLCanvasElement | null {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(source.width - sx, Math.floor(w));
  const sh = Math.min(source.height - sy, Math.floor(h));
  if (sw < 24 || sh < 24) return null;
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

function contrastCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.drawImage(source, 0, 0);
  try {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      y = (y - 128) * 1.4 + 128;
      y = y < 0 ? 0 : y > 255 ? 255 : y;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    /* */
  }
  return c;
}

/** Alias for app preload */
export function prepareZXing(): Promise<any> {
  return loadZXing();
}
