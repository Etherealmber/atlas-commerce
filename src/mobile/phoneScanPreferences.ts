export type ScanPreference = 'autoCamera' | 'vibrate' | 'sound';
const keys: Record<ScanPreference, string> = {
  autoCamera: 'atlas_phone_scan_auto_camera',
  vibrate: 'atlas_phone_scan_vibrate',
  sound: 'atlas_phone_scan_sound',
};
const defaults: Record<ScanPreference, boolean> = { autoCamera: false, vibrate: true, sound: false };

export function getScanPreference(preference: ScanPreference): boolean {
  try { const value = localStorage.getItem(keys[preference]); return value === 'on' ? true : value === 'off' ? false : defaults[preference]; }
  catch { return defaults[preference]; }
}
export function setScanPreference(preference: ScanPreference, value: boolean): boolean {
  try { localStorage.setItem(keys[preference], value ? 'on' : 'off'); return true; } catch { return false; }
}

/** Best-effort browser feedback only; neither capability is available everywhere. */
export function phoneScanFeedback(): void {
  if (getScanPreference('vibrate')) { try { navigator.vibrate?.(40); } catch { /* unsupported */ } }
  if (!getScanPreference('sound')) return;
  try {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + .12);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.addEventListener('ended', () => { void context.close().catch(() => {}); }, { once: true });
    oscillator.start(); oscillator.stop(context.currentTime + .12);
    if (context.state === 'suspended') void context.resume().catch(() => { void context.close().catch(() => {}); });
  } catch { /* browser denied audio or lacks an audio device */ }
}
