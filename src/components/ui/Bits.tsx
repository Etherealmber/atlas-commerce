/**
 * Bits — micro-interaction components adapted for Atlas Commerce from:
 *  - React Bits (github.com/DavidHDev/react-bits, MIT + Commons Clause):
 *    CountUp and Lens patterns;
 *  - Magic UI (magicui.design): NumberTicker easing feel.
 * Rewritten dependency-free (rAF + pointer events only, no Tailwind, no
 * framer-motion), dark-theme friendly, and respectful of
 * prefers-reduced-motion. Used by the phone terrain app (stats) and the
 * attachment lightbox (Lens magnifier on hover-capable devices).
 */
import { useEffect, useRef, useState, type CSSProperties, type FC } from 'react';

/* ------------------------------------------------------------------ CountUp */

type CountUpProps = {
  /** Target number. Animates from the previous value on change. */
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
};

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const CountUp: FC<CountUpProps> = ({ value, duration = 650, decimals = 0, suffix = '', className }) => {
  const target = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / Math.max(1, duration));
      const next = from + (target - from) * easeOutCubic(p);
      setDisplay(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  const text = `${display.toFixed(decimals)}${suffix}`;
  return <span className={className}>{text}</span>;
};

/* --------------------------------------------------------------------- Lens */

type LensProps = {
  src: string;
  alt?: string;
  /** Magnification of the floating lens (React Bits default ≈ 2.5). */
  zoom?: number;
  /** Lens diameter in px. */
  size?: number;
  imgStyle?: CSSProperties;
};

/**
 * Image with a floating magnifier that follows the pointer — the React Bits
 * "Lens" interaction, adapted: enabled only on hover-capable devices so touch
 * users keep the lightbox' tap-to-zoom instead of fighting a lens under a
 * finger. The lens is pure CSS background-position math — no canvas, no deps.
 */
export const Lens: FC<LensProps> = ({ src, alt = '', zoom = 2.5, size = 132, imgStyle }) => {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [hover, setHover] = useState(false);
  const [fine, setFine] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(any-hover: hover)') : null;
    if (!mq) return;
    const fn = () => setFine(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const enabled = fine;

  const onMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!enabled) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    setPos({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    });
  };

  const magStyle: CSSProperties = {
    width: size,
    height: size,
    left: `calc(${pos.x}% - ${size / 2}px)`,
    top: `calc(${pos.y}% - ${size / 2}px)`,
    backgroundImage: `url("${src.replace(/"/g, '%22')}")`,
    backgroundSize: `${zoom * 100}% ${zoom * 100}%`,
    backgroundPosition: `${pos.x}% ${pos.y}%`,
    opacity: hover && enabled ? 1 : 0,
  };

  return (
    <span
      ref={wrapRef}
      className="bits-lens"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerMove={onMove}
    >
      <img src={src} alt={alt} draggable={false} style={imgStyle} />
      <span className="bits-lens-mag" style={magStyle} aria-hidden />
    </span>
  );
};

export default CountUp;
