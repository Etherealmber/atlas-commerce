// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import PhoneDeviceScan from '../mobile/PhoneDeviceScan';

const scanner = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../lib/barcodeScan', () => ({ startDeviceQrScan: scanner.start }));
afterEach(() => { vi.clearAllMocks(); });

it('starts only on request, rejects another server and stops the camera', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).happyDOM.setURL('https://store.example:8443/m/device-scan');
  let scan!: (raw: string) => void;
  const stop = vi.fn(); scanner.start.mockImplementation(async (_element, callback) => { scan = callback; return stop; });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PhoneDeviceScan)));
    expect(scanner.start).not.toHaveBeenCalled();
    await act(async () => { host.querySelector('button')!.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(scanner.start).toHaveBeenCalledOnce();
    await act(async () => scan(`https://other.example/login/desktop-phone#request_id=${'a'.repeat(64)}`));
    expect(stop).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('QR non compatible');
    expect(window.location.pathname).toBe('/m/device-scan');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('releases a camera that starts after the user closes the scanner', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (stop: () => void) => void;
  scanner.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); const stop = vi.fn();
  try {
    await act(async () => root.render(createElement(PhoneDeviceScan)));
    await act(async () => { host.querySelector('button')!.click(); await new Promise(r => setTimeout(r, 30)); });
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Fermer')!.click());
    await act(async () => finish(stop));
    expect(stop).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('opens automatically only when opted in and releases the camera on unmount', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('atlas_phone_scan_auto_camera', 'on');
  const stop = vi.fn(); scanner.start.mockResolvedValue(stop);
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(PhoneDeviceScan)); await new Promise(r => setTimeout(r, 30)); });
    // Flush the frame scheduled by the mount effect.
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(scanner.start).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
  } finally { host.remove(); localStorage.clear(); }
});
