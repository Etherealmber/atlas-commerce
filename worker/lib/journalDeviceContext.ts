/** All values are client-reported, optional and bounded; never trust them for security decisions. */
export function parseJournalDeviceContext(header: string | undefined): Record<string, unknown> | undefined {
  if (!header || header.length > 512) return undefined;
  try {
    const value: unknown = JSON.parse(header);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const v = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof v.language === 'string' && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,3}$/.test(v.language)) out.language = v.language;
    if (typeof v.timezone === 'string' && v.timezone.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(v.timezone)) out.timezone = v.timezone;
    if (v.orientation === 'portrait' || v.orientation === 'landscape') out.orientation = v.orientation;
    if (v.theme === 'light' || v.theme === 'dark') out.theme = v.theme;
    for (const key of ['screen_width', 'screen_height']) {
      if (typeof v[key] === 'number' && Number.isInteger(v[key]) && v[key] >= 1 && v[key] <= 16384) out[key] = v[key];
    }
    if (typeof v.touch === 'boolean') out.touch = v.touch;
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}
