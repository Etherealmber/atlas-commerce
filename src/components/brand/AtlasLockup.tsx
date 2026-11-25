import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AtlasMark, AtlasWordmark } from './AtlasMark';
import { useBrandIntro } from './useBrandIntro';
import './atlas-brand.css';

type Props = {
  /** Rendered height in px (the wordmark keeps its proportions). Omit to size it from CSS (`--lk-h`, 24px by default). */
  height?: number;
  /** Mark only (no « Atlas »). */
  markOnly?: boolean;
  /** When the intro plays: on mount, when scrolled into view, or never. */
  play?: 'mount' | 'view' | 'none';
  /** Keep a slow tick wave going after the intro (hero marks). */
  idle?: boolean;
  /** Accessible name; empty = decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The Atlas sunburst lockup for public pages (nav, footers, hero marks):
 * inline SVG in currentColor, intro animation, a tick ripple on hover.
 */
export function AtlasLockup({ height, markOnly = false, play = 'mount', idle = false, label = 'Atlas', className = '', style }: Props) {
  const intro = useBrandIntro<HTMLSpanElement>(play);
  // Touch screens have no hover: a tap plays the same tick ripple (alternating
  // classes so every tap restarts it).
  const [tap, setTap] = useState<'' | 'is-tap-a' | 'is-tap-b'>('');
  const tapTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === 'mouse' || intro.className) return;
    setTap((t) => (t === 'is-tap-a' ? 'is-tap-b' : 'is-tap-a'));
    window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => setTap(''), 700);
  };
  const cls = ['atlas-lockup', markOnly ? 'atlas-lockup--mark' : '', idle ? 'is-idle' : '', intro.className, tap, className].filter(Boolean).join(' ');
  return (
    <span
      ref={intro.ref}
      className={cls}
      onPointerDown={onPointerDown}
      style={(height ? { '--lk-h': `${height}px`, ...style } : style) as CSSProperties | undefined}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <AtlasMark className="atlas-lockup-mark" />
      {!markOnly && <AtlasWordmark className="atlas-lockup-word" />}
    </span>
  );
}

export default AtlasLockup;
