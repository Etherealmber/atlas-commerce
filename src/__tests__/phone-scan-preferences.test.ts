// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getScanPreference, setScanPreference, phoneScanFeedback } from '../mobile/phoneScanPreferences';

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('defaults safely and vibrates only when enabled', () => {
  const vibrate = vi.fn(); Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  expect(getScanPreference('autoCamera')).toBe(false); expect(getScanPreference('vibrate')).toBe(true); expect(getScanPreference('sound')).toBe(false);
  phoneScanFeedback(); expect(vibrate).toHaveBeenCalledWith(40);
  setScanPreference('vibrate', false); phoneScanFeedback(); expect(vibrate).toHaveBeenCalledTimes(1);
  delete (navigator as Partial<Navigator>).vibrate;
});
it('plays a short sound only when enabled and closes its audio context', () => {
  const close = vi.fn().mockResolvedValue(undefined); const start = vi.fn(); const stop = vi.fn(); let ended: () => void = () => {};
  const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), addEventListener: vi.fn((_event, cb) => { ended = cb; }), start, stop };
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  const ctor = vi.fn(function () { return { createOscillator: () => oscillator, createGain: () => gain, destination: {}, currentTime: 1, state: 'running', close }; });
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: ctor });
  setScanPreference('vibrate', false); phoneScanFeedback(); expect(ctor).not.toHaveBeenCalled();
  setScanPreference('sound', true); phoneScanFeedback(); expect(start).toHaveBeenCalled(); expect(stop).toHaveBeenCalledWith(1.12); ended(); expect(close).toHaveBeenCalled();
  Reflect.deleteProperty(window, 'AudioContext');
});
it('handles storage failures without throwing or claiming a save', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  expect(getScanPreference('autoCamera')).toBe(false); expect(getScanPreference('vibrate')).toBe(true); expect(setScanPreference('sound', true)).toBe(false);
});
