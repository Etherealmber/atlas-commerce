import type { CSSProperties } from 'react';
import { ATLAS_BEAM, MARK_STROKE, MARK_VIEWBOX, atlasTicks } from './atlasMark';
import { ATLAS_LETTERS, LOCKUP_WIDTH, WORDMARK_X } from './atlasWordmark';

const TICKS = atlasTicks();

/**
 * The sunburst mark as inline SVG (currentColor — black on light, white on dark).
 * Every stroke has pathLength=1 so CSS can draw it with stroke-dashoffset, and a
 * `--i` custom property (clockwise order) for staggered animations.
 */
export function AtlasMark({ className = '', size, style }: { className?: string; size?: number; style?: CSSProperties }) {
  return (
    <svg
      className={`atlas-mark ${className}`.trim()}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      width={size}
      height={size}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={MARK_STROKE}
      strokeLinecap="butt"
      aria-hidden="true"
      focusable="false"
    >
      <g className="atlas-mark-ticks">
        {TICKS.map((t) => (
          <line
            key={t.angle}
            className="atlas-mark-tick"
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            pathLength={1}
            style={{ '--i': t.order } as CSSProperties}
          />
        ))}
      </g>
      <line className="atlas-mark-beam" x1={ATLAS_BEAM.x1} y1={ATLAS_BEAM.y1} x2={ATLAS_BEAM.x2} y2={ATLAS_BEAM.y2} pathLength={1} />
    </svg>
  );
}

/** "Atlas" as vector glyphs, cropped to the word (same 252-unit height as the mark). */
export function AtlasWordmark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`atlas-wordmark ${className}`.trim()}
      viewBox={`${WORDMARK_X} 0 ${LOCKUP_WIDTH - WORDMARK_X} ${MARK_VIEWBOX}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {ATLAS_LETTERS.map((l, i) => (
        <path key={l.ch + i} className="atlas-wordmark-letter" d={l.d} style={{ '--i': i } as CSSProperties} />
      ))}
    </svg>
  );
}

export default AtlasMark;
