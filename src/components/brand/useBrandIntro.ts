import { useEffect, useRef, useState } from 'react';

/** Total length of the intro (ticks → beam → wordmark), in ms. */
export const BRAND_INTRO_MS = 1500;

/**
 * Plays the sunburst intro once: the ticks draw in clockwise, the beam grows
 * out of the centre toward the wordmark, then « Atlas » is revealed.
 * - `mount`: as soon as the logo is on screen (sidebar, public nav).
 * - `view`:  when it scrolls into view (footers, hero marks).
 * - `none`:  static.
 * Returns a className for the logo root: `atlas-intro-armed` (hidden start
 * state) then `atlas-intro-play` (CSS keyframes) — removed once done so hover
 * and collapse animations take over. Reduced motion → a short fade instead.
 */
export function useBrandIntro<T extends HTMLElement>(mode: 'mount' | 'view' | 'none' = 'mount') {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<'idle' | 'armed' | 'play'>(mode === 'none' ? 'idle' : 'armed');

  useEffect(() => {
    if (mode === 'none') return undefined;
    let done: number | undefined;
    let raf: number | undefined;
    let io: IntersectionObserver | undefined;
    const play = () => {
      setPhase('play');
      done = window.setTimeout(() => setPhase('idle'), BRAND_INTRO_MS + 80);
    };
    const el = ref.current;
    if (mode === 'view' && el && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io?.disconnect();
          play();
        }
      }, { threshold: 0.35 });
      io.observe(el);
    } else {
      raf = window.requestAnimationFrame(play);
    }
    return () => {
      io?.disconnect();
      if (raf !== undefined) window.cancelAnimationFrame(raf);
      if (done !== undefined) window.clearTimeout(done);
    };
  }, [mode]);

  const className = phase === 'armed' ? 'atlas-intro-armed' : phase === 'play' ? 'atlas-intro-armed atlas-intro-play' : '';
  return { ref, className };
}
