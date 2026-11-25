import { useLang } from '../../i18n/core';
import type { CSSProperties } from 'react';
import { AtlasMark, AtlasWordmark } from './AtlasMark';
import './atlas-brand.css';

type Props = {
  /**
   * splash — full-screen intro: ticks draw in clockwise, the beam extends toward
   *          the wordmark, "Atlas" is revealed, then the ticks keep a slow wave.
   * inline — the mark alone as an activity indicator (ticks fade in sequence,
   *          like a classic spinner; the beam stays put as the anchor).
   */
  mode?: 'splash' | 'inline';
  /** Accessible status text (also shown under the splash lockup). Inline + empty label = decorative. */
  label?: string;
  /** Inline only: rendered size in px (default 20). */
  size?: number;
  className?: string;
};

export function AtlasLoader({ mode = 'inline', label = 'Chargement…', size = 20, className = '' }: Props) {
  const lang = useLang();
  if (mode === 'inline') {
    return (
      <span className={`atlas-loader atlas-loader--inline ${className}`.trim()} {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })} style={{ '--al-size': `${size}px` } as CSSProperties}>
        <AtlasMark />
      </span>
    );
  }
  return (
    <div className={`atlas-loader atlas-loader--splash ${className}`.trim()} role="status" aria-live="polite">
      <div className="atlas-loader-lockup">
        <AtlasMark />
        {lang === 'ar' ? <span className="atlas-loader-word atlas-brand-word-ar" lang="ar" dir="rtl">أطلس</span> : <AtlasWordmark className="atlas-loader-word" />}
      </div>
      <span className="atlas-loader-label">{label}</span>
    </div>
  );
}

export default AtlasLoader;
