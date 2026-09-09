/**
 * ESC/POS + Web Serial + Web Bluetooth (GATT discovery)
 *
 * Server ticket: GET /api/print/thermal/:id?width=32|48
 *
 * Web Bluetooth = BLE GATT only (not classic SPP).
 * Web Serial = USB CDC / UART printers (Chrome desktop, HTTPS, user gesture).
 */

export type ThermalWidth = 32 | 48;

const ESC = 0x1b;
const GS = 0x1d;

function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export const EscPos = {
  init: () => cmd(ESC, 0x40),
  align: (mode: 'left' | 'center' | 'right') =>
    cmd(ESC, 0x61, mode === 'center' ? 1 : mode === 'right' ? 2 : 0),
  bold: (on: boolean) => cmd(ESC, 0x45, on ? 1 : 0),
  underline: (n: 0 | 1 | 2 = 0) => cmd(ESC, 0x2d, n),
  size: (w: 1 | 2 = 1, h: 1 | 2 = 1) =>
    cmd(GS, 0x21, (h === 2 ? 0x01 : 0) | (w === 2 ? 0x10 : 0)),
  feed: (n = 1) => cmd(ESC, 0x64, Math.max(0, Math.min(255, n))),
  lf: () => cmd(0x0a),
  cut: () => cmd(GS, 0x56, 0x00),
  cutPartial: () => cmd(GS, 0x56, 0x01),
  drawer: () => cmd(ESC, 0x70, 0x00, 0x19, 0xfa),
  codePage: (n: number) => cmd(ESC, 0x74, n),
  barcodeCode128: (data: string) => {
    const payload = text('{B' + data);
    return concat(cmd(GS, 0x6b, 73, payload.length), payload);
  },
  qrCode: (data: string, size = 6) => {
    const d = text(data);
    const storeLen = d.length + 3;
    return concat(
      cmd(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00),
      cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size),
      cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30),
      cmd(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30),
      d,
      cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
    );
  },
};

export function line(str: string, width: ThermalWidth = 32): Uint8Array {
  return concat(text(String(str || '').slice(0, width)), EscPos.lf());
}

export function hr(width: ThermalWidth = 32, char = '-'): Uint8Array {
  return line(char.repeat(width), width);
}

export function pair(left: string, right: string, width: ThermalWidth = 32): Uint8Array {
  const l = String(left || '');
  const r = String(right || '');
  const gap = Math.max(1, width - l.length - r.length);
  return line(l + ' '.repeat(gap) + r, width);
}

export function buildReceiptEscPos(opts: {
  company: string;
  number: string;
  date: string;
  client: string;
  items: { name: string; qty: number; total: number }[];
  total: number;
  currency?: string;
  width?: ThermalWidth;
  footer?: string;
  qr?: string;
}): Uint8Array {
  const w = opts.width || 32;
  const cur = opts.currency || 'MAD';
  const parts: Uint8Array[] = [
    EscPos.init(),
    EscPos.align('center'),
    EscPos.bold(true),
    EscPos.size(1, 2),
    line(opts.company.slice(0, w), w),
    EscPos.size(1, 1),
    EscPos.bold(false),
    line(opts.number, w),
    line(opts.date, w),
    hr(w),
    EscPos.align('left'),
    line(('Client: ' + opts.client).slice(0, w), w),
    hr(w),
  ];
  for (const it of opts.items) {
    parts.push(line(it.name.slice(0, w), w));
    parts.push(pair('  x' + it.qty, String(Math.round(Number(it.total))), w));
  }
  parts.push(hr(w, '='));
  parts.push(EscPos.bold(true));
  parts.push(pair('TOTAL', String(Math.round(Number(opts.total))) + ' ' + cur, w));
  parts.push(EscPos.bold(false));
  if (opts.qr) {
    parts.push(EscPos.align('center'), EscPos.feed(1), EscPos.qrCode(opts.qr, 5));
  }
  parts.push(EscPos.align('center'), EscPos.feed(1));
  parts.push(line((opts.footer || 'Merci de votre visite').slice(0, w), w));
  parts.push(EscPos.feed(2), EscPos.cut());
  return concat(...parts);
}

export function toBytes(escpos: string): Uint8Array {
  const bytes = new Uint8Array(escpos.length);
  for (let i = 0; i < escpos.length; i++) bytes[i] = escpos.charCodeAt(i) & 0xff;
  return bytes;
}

// ─── Ticket fetch / download ────────────────────────────────────

export function thermalTicketUrl(invoiceId: number, width: ThermalWidth = 32): string {
  return '/api/print/thermal/' + invoiceId + '?width=' + width;
}

export async function fetchTicketBytes(
  invoiceId: number,
  width: ThermalWidth = 32
): Promise<Uint8Array> {
  // Must match auth.ts TOKEN_KEY and send fingerprint (worker auth middleware)
  const token = localStorage.getItem('stock_auth_token') || '';
  let fingerprint = 'none';
  try {
    const { getCachedFingerprint } = await import('../fingerprint');
    fingerprint = await getCachedFingerprint();
  } catch {
    /* ignore */
  }
  const res = await fetch(thermalTicketUrl(invoiceId, width), {
    headers: {
      Authorization: 'Bearer ' + token,
      'X-Device-Fingerprint': fingerprint,
    },
  });
  if (!res.ok) {
    let msg = 'Ticket indisponible (' + res.status + ')';
    try {
      const data = await res.clone().json();
      if (data?.error) msg = data.error + ' (' + res.status + ')';
    } catch {
      /* non-JSON body (raw ESC/POS or plain text) */
    }
    throw new Error(msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Force browser download of raw ESC/POS (.bin) for external tools / APK debug */
export async function downloadTicket(
  invoiceId: number,
  width: ThermalWidth = 32,
  filename?: string
): Promise<void> {
  const bytes = await fetchTicketBytes(invoiceId, width);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'ticket-' + invoiceId + '-w' + width + '.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Web Serial ─────────────────────────────────────────────────

export type SerialPrintOptions = {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
};

export function supportsWebSerial(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).serial;
}

/**
 * Print via Web Serial (USB serial / CDC ACM).
 * Requires Chrome/Edge desktop, HTTPS (or localhost), user gesture.
 * Opens the OS port picker; no vendor filter by default (most POS chips vary).
 */
export async function printViaSerial(
  data: Uint8Array | string,
  opts: SerialPrintOptions = {}
): Promise<void> {
  const nav = navigator as any;
  if (!nav.serial) {
    throw new Error(
      'Web Serial indisponible. Utilisez Chrome desktop + USB, ou téléchargez le ticket .bin.'
    );
  }
  const port = await nav.serial.requestPort({ filters: [] });
  await port.open({
    baudRate: opts.baudRate || 9600,
    dataBits: opts.dataBits || 8,
    stopBits: opts.stopBits || 1,
    parity: opts.parity || 'none',
    bufferSize: opts.bufferSize || 255,
  });
  const writer = port.writable.getWriter();
  const bytes = typeof data === 'string' ? toBytes(data) : data;
  const CHUNK = 512;
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      await writer.write(bytes.subarray(i, i + CHUNK));
    }
  } finally {
    writer.releaseLock();
    await port.close();
  }
}

/** List previously permitted serial ports (no picker) */
export async function listSerialPorts(): Promise<any[]> {
  const nav = navigator as any;
  if (!nav.serial?.getPorts) return [];
  return nav.serial.getPorts();
}

// ─── Web Bluetooth + GATT discovery ─────────────────────────────

/** Services frequently used by ESC/POS BLE modules */
export const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
];

export type GattCharInfo = {
  uuid: string;
  serviceUuid: string;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  read: boolean;
};

export type GattDiscoveryReport = {
  deviceName: string;
  deviceId: string;
  services: { uuid: string; characteristics: GattCharInfo[] }[];
  preferredWrite?: GattCharInfo;
};

export function supportsWebBluetooth(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
}

function uuidStr(u: string | { toString(): string }): string {
  return String(u).toLowerCase();
}

/**
 * Full GATT walk: every primary service + characteristic properties.
 * Use this once per printer model to learn which UUID accepts ESC/POS writes.
 */
export async function discoverGattUuids(): Promise<GattDiscoveryReport> {
  const nav = navigator as any;
  if (!nav.bluetooth) {
    throw new Error('Web Bluetooth non supporté (Chrome/Edge, HTTPS, geste utilisateur).');
  }

  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  });

  const server = await device.gatt.connect();
  // Request a broad set so getPrimaryServices is allowed
  try {
    await Promise.all(
      BLE_PRINTER_SERVICES.map((u: string) =>
        server.getPrimaryService(u).catch(() => null)
      )
    );
  } catch {
    /* ignore */
  }

  let services: any[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch (e) {
    // Browser may require explicit optionalServices — retry known list only
    for (const u of BLE_PRINTER_SERVICES) {
      try {
        services.push(await server.getPrimaryService(u));
      } catch {
        /* */
      }
    }
  }

  const report: GattDiscoveryReport = {
    deviceName: device.name || '(sans nom)',
    deviceId: device.id || '',
    services: [],
  };

  for (const service of services) {
    const svcUuid = uuidStr(service.uuid);
    const charsInfo: GattCharInfo[] = [];
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        const info: GattCharInfo = {
          uuid: uuidStr(ch.uuid),
          serviceUuid: svcUuid,
          write: !!ch.properties.write,
          writeWithoutResponse: !!ch.properties.writeWithoutResponse,
          notify: !!ch.properties.notify,
          read: !!ch.properties.read,
        };
        charsInfo.push(info);
        if (
          !report.preferredWrite &&
          (info.write || info.writeWithoutResponse)
        ) {
          report.preferredWrite = info;
        }
      }
    } catch {
      /* characteristic access denied */
    }
    report.services.push({ uuid: svcUuid, characteristics: charsInfo });
  }

  try {
    server.disconnect();
  } catch {
    /* */
  }
  return report;
}

async function findWritableCharacteristic(server: any): Promise<any> {
  // 1) Known printer services first
  for (const svcUuid of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(svcUuid);
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties.writeWithoutResponse || ch.properties.write) return ch;
      }
    } catch {
      /* */
    }
  }
  // 2) Full discovery fallback
  try {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties.writeWithoutResponse || ch.properties.write) return ch;
      }
    }
  } catch {
    /* */
  }
  return null;
}

export async function printViaBluetooth(data: Uint8Array | string): Promise<void> {
  const nav = navigator as any;
  if (!nav.bluetooth) {
    throw new Error(
      'Web Bluetooth non supporté. Imprimantes SPP Classic → APK Android. Ou téléchargez le .bin.'
    );
  }

  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  });

  const server = await device.gatt.connect();
  const bytes = typeof data === 'string' ? toBytes(data) : data;
  const writeChar = await findWritableCharacteristic(server);

  if (!writeChar) {
    try {
      server.disconnect();
    } catch {
      /* */
    }
    throw new Error(
      'Aucune caractéristique GATT en écriture. Souvent Bluetooth Classic (SPP) — utilisez l’APK ou le téléchargement .bin.'
    );
  }

  const CHUNK = 180;
  const withoutResponse = writeChar.properties.writeWithoutResponse;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    if (withoutResponse) await writeChar.writeValueWithoutResponse(slice);
    else await writeChar.writeValue(slice);
  }

  setTimeout(() => {
    try {
      server.disconnect();
    } catch {
      /* */
    }
  }, 600);
}

export async function printInvoiceTicket(
  invoiceId: number,
  opts?: {
    width?: ThermalWidth;
    transport?: 'serial' | 'bluetooth' | 'auto';
    serial?: SerialPrintOptions;
  }
): Promise<'serial' | 'bluetooth'> {
  const width = opts?.width || 32;
  const buf = await fetchTicketBytes(invoiceId, width);
  const transport = opts?.transport || 'auto';

  if (transport === 'serial') {
    await printViaSerial(buf, opts?.serial);
    return 'serial';
  }
  if (transport === 'bluetooth') {
    await printViaBluetooth(buf);
    return 'bluetooth';
  }
  // auto: prefer BLE if present, else Serial
  if (supportsWebBluetooth()) {
    try {
      await printViaBluetooth(buf);
      return 'bluetooth';
    } catch (e) {
      if (supportsWebSerial()) {
        await printViaSerial(buf, opts?.serial);
        return 'serial';
      }
      throw e;
    }
  }
  if (supportsWebSerial()) {
    await printViaSerial(buf, opts?.serial);
    return 'serial';
  }
  throw new Error(
    'Aucun transport navigateur (Serial/Bluetooth). Téléchargez le ticket .bin à la place.'
  );
}
