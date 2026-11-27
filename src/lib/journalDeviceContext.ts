/** Low-cost, optional client-reported context for new journal events.
 * This is untrusted diagnostic data, not authentication or device identity. */
export function journalDeviceContext(): string | undefined {
  try {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return undefined;
    const context = {
      language: typeof navigator.language === 'string' ? navigator.language.slice(0, 35) : undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64),
      orientation: window.screen?.orientation?.type?.startsWith('landscape') ? 'landscape' : window.screen?.orientation?.type?.startsWith('portrait') ? 'portrait' : undefined,
      theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : undefined,
      screen_width: Number.isInteger(window.screen?.width) ? window.screen.width : undefined,
      screen_height: Number.isInteger(window.screen?.height) ? window.screen.height : undefined,
      touch: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints > 0 : undefined,
    };
    const encoded = JSON.stringify(context);
    return /^[\x20-\x7e]*$/.test(encoded) && encoded.length <= 512 ? encoded : undefined;
  } catch { return undefined; }
}
