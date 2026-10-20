/**
 * Barcode scanner pipeline:
 * 1) Quagga2 (@ericblade/quagga2) — free, maintained fork, strong EAN/UPC/Code128
 * 2) html5-qrcode
 * 3) getUserMedia + native BarcodeDetector + ZXing WASM
 */

export type ScanStop = () => void;

const ZXING_VERSION = '2.2.0';
/** Same-origin vendor first, then several CDNs (jsdelivr alone is often blocked). */
const ZXING_SCRIPT_URLS = [
  `/vendor/zxing-wasm/${ZXING_VERSION}/reader.js`,
  `https://unpkg.com/zxing-wasm@${ZXING_VERSION}/dist/iife/reader/index.js`,
  `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/iife/reader/index.js`,
  `https://fastly.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/iife/reader/index.js`,
];
const ZXING_WASM_URLS = [
  `/vendor/zxing-wasm/${ZXING_VERSION}/zxing_reader.wasm`,
  `https://unpkg.com/zxing-wasm@${ZXING_VERSION}/dist/reader/zxing_reader.wasm`,
  `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/reader/zxing_reader.wasm`,
  `https://fastly.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/reader/zxing_reader.wasm`,
];

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
  void loadQuagga().catch(() => {});
  void loadHtml5Qrcode().catch(() => {});
  void loadZXing().catch(() => {});
}

function loadScriptOnce(src: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sel = 'script[data-scan-src="' + src.replace(/"/g, '') + '"]';
    const existing = document.querySelector(sel) as HTMLScriptElement | null;
    if (existing) {
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      if ((existing as any).dataset.loaded === '1') {
        clearTimeout(t);
        return resolve();
      }
      existing.addEventListener('load', () => {
        clearTimeout(t);
        resolve();
      });
      existing.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('load'));
      });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-scan-src', src);
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    s.onload = () => {
      clearTimeout(t);
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => {
      clearTimeout(t);
      try { s.remove(); } catch { /* */ }
      reject(new Error('load'));
    };
    document.head.appendChild(s);
  });
}

export function loadZXing(): Promise<any> {
  if (zxingReady) return zxingReady;
  const w = window as any;
  if (w.ZXingWASM?.readBarcodes) {
    zxingReady = Promise.resolve(w.ZXingWASM);
    return zxingReady;
  }
  zxingReady = (async () => {
    let ok = false;
    for (const src of ZXING_SCRIPT_URLS) {
      try {
        await loadScriptOnce(src, 10000);
        if (w.ZXingWASM?.readBarcodes) {
          ok = true;
          break;
        }
      } catch {
        /* try next CDN */
      }
    }
    if (!ok || !w.ZXingWASM?.readBarcodes) {
      throw new Error('Scanner WASM indisponible (réseau). Passage au scanner alternatif…');
    }
    const api = w.ZXingWASM;
    // Prefer same-origin vendor (no network); skip slow multi-CDN probe
    const wasmUrl = ZXING_WASM_URLS[0] || ZXING_WASM_URLS[ZXING_WASM_URLS.length - 1];
    try {
      api.prepareZXingModule?.({
        overrides: {
          locateFile: (path: string, prefix: string) => {
            if (String(path).endsWith('.wasm')) return wasmUrl;
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
      /* warm-up optional */
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
    '/vendor/html5-qrcode/html5-qrcode.min.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
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
  if (!c || c.length < 3) return false;
  if (c.includes('://') || /^https?/i.test(c)) return false;
  // Numeric retail (EAN/UPC/ITF) or alnum SKU-like
  if (/^\d{6,18}$/.test(c)) return true;
  return /^[0-9A-Za-z\-._/]{3,64}$/.test(c);
}

function normalizeCode(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, '');
}

function needHits(_text: string): number {
  return 1;
}

const ZXING_OPTS = {
  tryHarder: true,
  // empty / omit formats → all symbologies (zxing-wasm default)
  maxNumberOfSymbols: 4,
};

async function zxingDecodeImageData(imageData: ImageData): Promise<string | null> {
  const api = await loadZXing();
  let results: any[] = [];
  try {
    if (typeof api.readBarcodes === 'function') {
      results = await api.readBarcodes(imageData, ZXING_OPTS);
    } else if (typeof api.readBarcodesFromImageData === 'function') {
      results = await api.readBarcodesFromImageData(imageData, ZXING_OPTS);
    }
  } catch {
    return null;
  }
  for (const r of results || []) {
    const text = r?.text || r?.rawValue || '';
    if (text && isBarcodeLike(text)) return normalizeCode(text);
  }
  return null;
}

async function zxingDecodeBlob(blob: Blob): Promise<string | null> {
  const api = await loadZXing();
  const results = await api.readBarcodes(blob, ZXING_OPTS);
  const text = results?.[0]?.text;
  if (text && isBarcodeLike(text)) return normalizeCode(text);
  return null;
}


/** Chrome Android / some Chromium: native Shape Detection API (fast, reliable). */
async function startNativeBarcodeDetector(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (typeof BD !== 'function') return null;
  let formats: string[] | undefined;
  try {
    const supported: string[] = await BD.getSupportedFormats?.() || [];
    const prefer = [
      'ean_13', 'ean_8', 'upc_a', 'upc_e',
      'code_128', 'code_39', 'code_93', 'codabar', 'itf',
      'qr_code', 'data_matrix',
    ];
    formats = prefer.filter((f) => supported.includes(f));
    if (!formats.length) formats = undefined;
  } catch {
    formats = undefined;
  }
  let detector: any;
  try {
    detector = formats?.length ? new BD({ formats }) : new BD();
  } catch {
    return null;
  }

  let stopped = false;
  let raf = 0;
  let inFlight = false;
  let last = '';
  let hits = 0;

  const stop: ScanStop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
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

  const tick = async () => {
    if (stopped) return;
    if (!inFlight && video.readyState >= 2 && video.videoWidth > 0) {
      inFlight = true;
      try {
        const codes = await detector.detect(video);
        for (const c of codes || []) {
          const v = c?.rawValue || c?.rawData || '';
          if (v) {
            emit(String(v));
            if (stopped) {
              inFlight = false;
              return;
            }
          }
        }
      } catch {
        /* transient */
      }
      inFlight = false;
    }
    if (!stopped) raf = requestAnimationFrame(() => { void tick(); });
  };
  raf = requestAnimationFrame(() => { void tick(); });
  return stop;
}




/** Quagga2 — maintained fork of QuaggaJS (@ericblade/quagga2 v1.12.1) */
const QUAGGA_SCRIPT_URLS = [
  '/vendor/quagga2/quagga.min.js',
  '/vendor/quagga2/quagga.js',
  'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.12.1/dist/quagga.min.js',
  'https://unpkg.com/@ericblade/quagga2@1.12.1/dist/quagga.min.js',
];

let quaggaReady: Promise<any> | null = null;

function loadQuagga(): Promise<any> {
  const w = window as any;
  if (w.Quagga) return Promise.resolve(w.Quagga);
  if (quaggaReady) return quaggaReady;
  quaggaReady = (async () => {
    let last: any = null;
    for (const src of QUAGGA_SCRIPT_URLS) {
      try {
        await loadScriptOnce(src, 15000);
        if (w.Quagga) return w.Quagga;
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error('Quagga2 indisponible');
  })();
  return quaggaReady;
}

async function startQuaggaScan(
  container: HTMLElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop> {
  const Quagga = await loadQuagga();
  container.innerHTML = '';
  container.style.position = container.style.position || 'relative';
  container.style.minHeight = container.style.minHeight || '240px';
  container.style.overflow = 'hidden';

  let stopped = false;
  let last = '';
  let hits = 0;
  const startedAt = Date.now();

  /** EAN-13 / UPC-A check digit */
  const validEan13 = (code: string): boolean => {
    if (!/^\d{13}$/.test(code)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(code[i], 10) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10 === parseInt(code[12], 10);
  };
  /** EAN-8 check digit */
  const validEan8 = (code: string): boolean => {
    if (!/^\d{8}$/.test(code)) return false;
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += parseInt(code[i], 10) * (i % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === parseInt(code[7], 10);
  };
  const looksReliable = (text: string, result: any): boolean => {
    if (text.length < 6) return false;
    // Reject numeric codes that fail checksum when length matches EAN/UPC
    if (/^\d{13}$/.test(text) && !validEan13(text)) return false;
    if (/^\d{12}$/.test(text)) {
      // UPC-A often as 12 digits — validate as EAN-13 with leading 0
      if (!validEan13('0' + text)) return false;
    }
    if (/^\d{8}$/.test(text) && !validEan8(text)) return false;
    // Quagga decodedCodes error errors — skip high-error frames
    const decoded = result?.codeResult?.decodedCodes;
    if (Array.isArray(decoded) && decoded.length > 2) {
      const errs = decoded.filter((d: any) => typeof d?.error === 'number');
      if (errs.length) {
        const avg = errs.reduce((a: number, d: any) => a + d.error, 0) / errs.length;
        if (avg > 0.12) return false;
      }
    }
    return true;
  };

  const stop: ScanStop = () => {
    stopped = true;
    try {
      Quagga.offDetected?.(onDetected);
      Quagga.stop();
    } catch {
      /* */
    }
    try {
      container.innerHTML = '';
    } catch {
      /* */
    }
  };

  function onDetected(result: any) {
    if (stopped) return;
    // Ignore first ~400ms (auto-focus noise / wrong partial reads)
    if (Date.now() - startedAt < 400) return;
    const text = normalizeCode(result?.codeResult?.code || '');
    if (!text || text.length < 6) return;
    if (!isBarcodeLike(text) && !/^\d{6,}$/.test(text)) return;
    if (!looksReliable(text, result)) {
      // Wrong checksum or noisy — reset streak
      if (text !== last) {
        last = '';
        hits = 0;
      }
      return;
    }
    if (text === last) hits += 1;
    else {
      last = text;
      hits = 1;
    }
    // Need several identical reads in a row (stops fast wrong codes)
    const need = text.length >= 12 ? 3 : 4;
    if (hits < need) return;
    onCode(text);
    stop();
  }

  await new Promise<void>((resolve, reject) => {
    Quagga.init(
      {
        inputStream: {
          type: 'LiveStream',
          target: container,
          constraints: {
            facingMode: 'environment',
            width: { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 },
          },
          // Match yellow frame — less edge noise
          area: { top: '32%', right: '12%', left: '12%', bottom: '32%' },
        },
        locator: {
          patchSize: 'large',
          halfSample: false,
        },
        numOfWorkers: Math.min(2, navigator.hardwareConcurrency || 2),
        frequency: 8,
        decoder: {
          readers: [
            'ean_reader',
            'ean_8_reader',
            'upc_reader',
            'upc_e_reader',
            'code_128_reader',
            'code_39_reader',
          ],
          multiple: false,
        },
        locate: true,
      },
      (err: any) => {
        if (err) {
          onError?.(err?.message || String(err) || 'Quagga init failed');
          reject(err);
          return;
        }
        Quagga.onDetected(onDetected);
        Quagga.start();
        resolve();
      }
    );
  });

  return stop;
}

/** Commercial: Dynamsoft Barcode Reader (primary when license is set). */
const DYNAMSOFT_BUNDLE_URLS = [
  'https://cdn.jsdelivr.net/npm/dynamsoft-barcode-reader-bundle@11.6.3200/dist/dbr.bundle.js',
  'https://unpkg.com/dynamsoft-barcode-reader-bundle@11.6.3200/dist/dbr.bundle.js',
];

export function getDynamsoftLicense(): string {
  try {
    const fromEnv = String((import.meta as any)?.env?.VITE_DYNAMSOFT_LICENSE || '').trim();
    if (fromEnv) return fromEnv;
  } catch {
    /* */
  }
  try {
    const fromLs = String(localStorage.getItem('atlas_dynamsoft_license') || '').trim();
    if (fromLs) return fromLs;
  } catch {
    /* */
  }
  try {
    const fromWin = String((window as any).__ATLAS_DYNAMSOFT_LICENSE__ || '').trim();
    if (fromWin) return fromWin;
  } catch {
    /* */
  }
  return '';
}

export function setDynamsoftLicense(key: string) {
  try {
    const k = String(key || '').trim();
    if (k) localStorage.setItem('atlas_dynamsoft_license', k);
    else localStorage.removeItem('atlas_dynamsoft_license');
  } catch {
    /* */
  }
}

let dynamsoftReady: Promise<any> | null = null;

function loadDynamsoftBundle(): Promise<any> {
  const w = window as any;
  if (w.Dynamsoft?.CVR || w.Dynamsoft?.BarcodeScanner || w.Dynamsoft?.DBR) {
    return Promise.resolve(w.Dynamsoft);
  }
  if (dynamsoftReady) return dynamsoftReady;
  dynamsoftReady = (async () => {
    let lastErr: any = null;
    for (const src of DYNAMSOFT_BUNDLE_URLS) {
      try {
        await loadScriptOnce(src, 20000);
        if (w.Dynamsoft) return w.Dynamsoft;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Dynamsoft SDK indisponible (réseau)');
  })();
  return dynamsoftReady;
}

/**
 * Commercial scanner — Dynamsoft Capture Vision (camera + decode).
 * Requires a license (trial 30 days from dynamsoft.com, or VITE_DYNAMSOFT_LICENSE).
 */
async function startDynamsoftScan(
  container: HTMLElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop> {
  const license = getDynamsoftLicense();
  if (!license) throw new Error('Dynamsoft: aucune licence configurée');

  const Dynamsoft = await loadDynamsoftBundle();
  container.innerHTML = '';
  container.style.position = container.style.position || 'relative';
  container.style.minHeight = container.style.minHeight || '240px';

  // License
  try {
    if (Dynamsoft.License?.LicenseManager?.initLicense) {
      await Dynamsoft.License.LicenseManager.initLicense(license);
    } else if (Dynamsoft.DBR?.BarcodeScanner) {
      Dynamsoft.DBR.BarcodeScanner.license = license;
    } else if (Dynamsoft.BarcodeScanner) {
      /* BarcodeScanner ctor accepts license */
    }
  } catch (e: any) {
    throw new Error(e?.message || 'Licence Dynamsoft invalide');
  }

  // Prefer high-level BarcodeScanner.launch into container when available
  if (typeof Dynamsoft.BarcodeScanner === 'function') {
    let scanner: any = null;
    let stopped = false;
    scanner = new Dynamsoft.BarcodeScanner({
      license,
      container,
      scannerViewConfig: {
        cameraEnhancerUIElement: container,
      },
    });
    const stop: ScanStop = () => {
      stopped = true;
      try {
        scanner?.dispose?.();
        scanner?.destroy?.();
        scanner?.stop?.();
      } catch {
        /* */
      }
      try {
        container.innerHTML = '';
      } catch {
        /* */
      }
    };
    // Non-blocking continuous: use launch promise only for first result, or CVR below
    void (async () => {
      try {
        const result = await scanner.launch();
        if (stopped) return;
        const items = result?.barcodeResults || result?.barcodes || [];
        const text =
          items[0]?.text ||
          items[0]?.barcodeText ||
          result?.text ||
          '';
        if (text) {
          onCode(normalizeCode(String(text)));
          stop();
        }
      } catch (e: any) {
        if (!stopped) onError?.(e?.message || 'Dynamsoft scan arrêté');
      }
    })();
    return stop;
  }

  // Foundational API: CameraView + CaptureVisionRouter (v10/v11)
  const DCE = Dynamsoft.DCE;
  const CVR = Dynamsoft.CVR;
  if (!DCE?.CameraView || !CVR?.CaptureVisionRouter) {
    throw new Error('Dynamsoft CVR/DCE non disponibles dans ce bundle');
  }

  try {
    await Dynamsoft.Core?.CoreModule?.loadWasm?.();
  } catch {
    /* optional */
  }

  const cameraView = await DCE.CameraView.createInstance();
  const ui = cameraView.getUIElement?.() || cameraView;
  if (ui instanceof HTMLElement) {
    ui.style.width = '100%';
    ui.style.minHeight = '240px';
    container.appendChild(ui);
  }

  const cameraEnhancer = await DCE.CameraEnhancer.createInstance(cameraView);
  await cameraEnhancer.open();

  const router = await CVR.CaptureVisionRouter.createInstance();
  router.setInput(cameraEnhancer);

  let stopped = false;
  const stop: ScanStop = () => {
    stopped = true;
    try {
      router.stopCapturing?.();
    } catch {
      /* */
    }
    try {
      router.dispose?.();
    } catch {
      /* */
    }
    try {
      cameraEnhancer.close?.();
      cameraEnhancer.dispose?.();
    } catch {
      /* */
    }
    try {
      container.innerHTML = '';
    } catch {
      /* */
    }
  };

  router.addResultReceiver({
    onDecodedBarcodesReceived: (result: any) => {
      if (stopped) return;
      const items = result?.barcodeResultItems || result?.barcodes || [];
      for (const item of items) {
        const text = item?.text || item?.barcodeText || '';
        if (text && (isBarcodeLike(String(text)) || /^\d{4,}$/.test(String(text)))) {
          onCode(normalizeCode(String(text)));
          stop();
          return;
        }
      }
    },
  });

  const template =
    (await router.getSimplifiedSettings?.('ReadBarcodes_Speed')) ? 'ReadBarcodes_Speed' : 'ReadSingleBarcode';
  try {
    await router.startCapturing(template);
  } catch {
    await router.startCapturing('ReadSingleBarcode');
  }

  return stop;
}

async function startHtml5Scan(
  container: HTMLElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop> {
  const Html5Qrcode = await loadHtml5Qrcode();
  if (!container.id) container.id = 'ph-h5-reader-' + Date.now();
  // html5-qrcode requires a clean container
  const scanner = new Html5Qrcode(container.id);
  let stopped = false;
  let last = '';

  const stop: ScanStop = () => {
    stopped = true;
    try {
      if (scanner.isScanning) scanner.stop().catch(() => {});
      scanner.clear?.();
    } catch {
      /* */
    }
  };

  const emit = (raw: string) => {
    if (stopped) return;
    const text = normalizeCode(raw);
    if (!text || text.length < 3) return;
    if (text === last) return; // debounce identical
    last = text;
    if (!isBarcodeLike(text) && !/^\d{4,}$/.test(text)) return;
    onCode(text);
    stop();
  };

  // Build formats list from library enum when available
  let formats: number[] | undefined;
  try {
    const F = (globalThis as any).Html5QrcodeSupportedFormats || (Html5Qrcode as any).FORMATS;
    // Prefer numeric enum values used by html5-qrcode 2.x
    const w = globalThis as any;
    const enumObj = w.Html5QrcodeSupportedFormats;
    if (enumObj) {
      formats = [
        enumObj.EAN_13,
        enumObj.EAN_8,
        enumObj.UPC_A,
        enumObj.UPC_E,
        enumObj.CODE_128,
        enumObj.CODE_39,
        enumObj.CODE_93,
        enumObj.ITF,
        enumObj.CODABAR,
        enumObj.QR_CODE,
      ].filter((x) => typeof x === 'number');
    }
  } catch {
    formats = undefined;
  }

  const config: any = {
    fps: 15,
    qrbox: (viewW: number, viewH: number) => ({
      width: Math.floor(viewW * 0.92),
      height: Math.floor(viewH * 0.45),
    }),
    aspectRatio: 1.777778,
    disableFlip: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };
  if (formats && formats.length) config.formatsToSupport = formats;

  try {
    await scanner.start(
      { facingMode: 'environment' },
      config,
      (decoded: string) => emit(decoded),
      () => {
        /* ignore per-frame failures */
      }
    );
  } catch (e1: any) {
    // Retry without format restriction / with basic camera
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, disableFlip: false },
        (decoded: string) => emit(decoded),
        () => {}
      );
    } catch (e2: any) {
      onError?.(e2?.message || e1?.message || 'html5-qrcode start failed');
      throw e2 || e1;
    }
  }

  return stop;
}

export async function startBarcodeScan(
  containerOrVideo: HTMLElement | HTMLVideoElement,
  onCode: (code: string) => void,
  onError?: (msg: string) => void
): Promise<ScanStop> {
  let stopped = false;
  let last = '';
  let hits = 0;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let raf = 0;
  let inFlight = false;
  let html5Stop: ScanStop | null = null;
  let nativeStop: ScanStop | null = null;

  const stopAll: ScanStop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try { nativeStop?.(); } catch { /* */ }
    nativeStop = null;
    try { html5Stop?.(); } catch { /* */ }
    html5Stop = null;
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch { /* */ }
    stream = null;
    if (video) {
      try {
        video.srcObject = null;
      } catch { /* */ }
    }
  };

  const emit = (raw: string) => {
    if (stopped) return;
    const text = normalizeCode(raw);
    if (!text || text.length < 3) return;
    // Accept almost anything that looks like a product code / SKU
    if (!isBarcodeLike(text) && !/^\d{4,}$/.test(text)) return;
    if (text === last) hits += 1;
    else {
      last = text;
      hits = 1;
    }
    if (hits < 1) return;
    onCode(text);
    stopAll();
  };

  // ---------- Path A0: Quagga2 (primary free 1D / EAN) ----------
  try {
    const container =
      containerOrVideo instanceof HTMLVideoElement
        ? (containerOrVideo.parentElement as HTMLElement)
        : (containerOrVideo as HTMLElement);
    if (container) {
      container.innerHTML = '';
      const qStop = await startQuaggaScan(container, (code) => emit(code), onError);
      if (qStop) {
        html5Stop = qStop;
        return () => stopAll();
      }
    }
  } catch {
    try {
      html5Stop?.();
    } catch {
      /* */
    }
    html5Stop = null;
  }

  // ---------- Path A: html5-qrcode owns camera (free fallback) ----------
  try {
    const container =
      containerOrVideo instanceof HTMLVideoElement
        ? (containerOrVideo.parentElement as HTMLElement)
        : containerOrVideo;
    if (container) {
      // Ensure element has an id for html5-qrcode
      if (!container.id) container.id = 'ph-h5-reader';
      container.innerHTML = '';
      html5Stop = await startHtml5Scan(container, (code) => emit(code), onError);
      if (html5Stop) {
        // Also try native BD on the video html5 creates (Chrome Android boost)
        const tryAttachNative = () => {
          if (stopped) return;
          const v = container.querySelector('video') as HTMLVideoElement | null;
          if (v && v.videoWidth > 0) {
            void startNativeBarcodeDetector(v, (code) => emit(code)).then((s) => {
              if (s && !stopped) nativeStop = s;
            });
            return;
          }
          setTimeout(tryAttachNative, 400);
        };
        setTimeout(tryAttachNative, 500);
        return () => stopAll();
      }
    }
  } catch (e: any) {
    /* fall through to manual getUserMedia + ZXing */
    try {
      html5Stop?.();
    } catch { /* */ }
    html5Stop = null;
  }

  // ---------- Path B: getUserMedia + ZXing WASM (+ native BD) ----------
  try {
    const container =
      containerOrVideo instanceof HTMLVideoElement
        ? null
        : (containerOrVideo as HTMLElement);

    if (containerOrVideo instanceof HTMLVideoElement) {
      video = containerOrVideo;
    } else {
      video = document.createElement('video');
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.autoplay = true;
      video.style.cssText =
        'width:100%;max-height:70vh;object-fit:cover;background:#000;border-radius:12px;display:block';
      if (container) {
        container.innerHTML = '';
        container.appendChild(video);
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
    await video.play().catch(() => {});
    await new Promise<void>((resolve) => {
      if (video && video.readyState >= 2 && video.videoWidth > 0) return resolve();
      const onReady = () => {
        video?.removeEventListener('loadeddata', onReady);
        resolve();
      };
      video?.addEventListener('loadeddata', onReady);
      setTimeout(resolve, 2000);
    });

    try {
      nativeStop = await startNativeBarcodeDetector(video!, (code) => emit(code));
    } catch {
      nativeStop = null;
    }

    const zx = await loadZXing().catch(() => null);
    if (!zx && !nativeStop) {
      throw new Error('Scanner non chargé');
    }

    if (zx) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas indisponible');

      const tick = async () => {
        if (stopped) return;
        if (inFlight) {
          raf = requestAnimationFrame(() => {
            void tick();
          });
          return;
        }
        try {
          if (video && video.readyState >= 2 && video.videoWidth > 0) {
            const maxW = 1280;
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
            // tryHarder every other frame to balance speed
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
    }

    return () => stopAll();
  } catch (e: any) {
    stopAll();
    const msg = e?.message || 'Caméra / scanner indisponible';
    onError?.(msg);
    throw e;
  }
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
