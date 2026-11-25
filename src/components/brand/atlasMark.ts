/**
 * Atlas sunburst mark — geometry shared by the splash (index.html), <AtlasLoader>
 * and <SidebarBrandLogo>. Measured from public/atlas-logo-light.png (mark = 253 px):
 * 16 radial positions every 22.5°, ticks ~9 px thick from r≈79 to r≈125; the
 * 3 o'clock position is replaced by a horizontal "beam" running from the centre
 * to the outer edge (it points at the wordmark in the lockup).
 */
export const MARK_VIEWBOX = 252;
export const MARK_CENTER = 126;
export const TICK_INNER = 79;
export const TICK_OUTER = 125;
export const MARK_STROKE = 9;

export type Tick = { x1: number; y1: number; x2: number; y2: number; angle: number; order: number };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Ticks in clockwise draw order starting just after the beam (3 o'clock → 4:30 → …),
 * so the stagger sweeps around and finishes back at the beam.
 */
export function atlasTicks(): Tick[] {
  const ticks: Tick[] = [];
  for (let k = 1; k < 16; k += 1) {
    const angle = k * 22.5; // degrees, clockwise from 3 o'clock (SVG y grows downward)
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    ticks.push({
      x1: round(MARK_CENTER + TICK_INNER * cos),
      y1: round(MARK_CENTER + TICK_INNER * sin),
      x2: round(MARK_CENTER + TICK_OUTER * cos),
      y2: round(MARK_CENTER + TICK_OUTER * sin),
      angle,
      order: k - 1,
    });
  }
  return ticks;
}

/** The beam: centre → right edge, drawn left-to-right so it "extends" toward the wordmark. */
export const ATLAS_BEAM = { x1: MARK_CENTER, y1: MARK_CENTER, x2: MARK_CENTER + TICK_OUTER, y2: MARK_CENTER } as const;

/** Shared easing (Linear/Stripe-style ease-out-quint). */
export const ATLAS_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
