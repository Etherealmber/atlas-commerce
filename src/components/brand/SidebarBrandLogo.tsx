import { useEffect, useRef, useState } from 'react';
import { AtlasMark, AtlasWordmark } from './AtlasMark';
import { useBrandIntro } from './useBrandIntro';
import './atlas-brand.css';
import { useLang } from '../../i18n/core';

/**
 * Sidebar lockup. Expanded: sunburst + "Atlas" (+ optional subtitle).
 * Collapsed: the full sunburst alone (ticks + the beam from the centre), centred.
 *
 * - On load the mark draws itself (ticks clockwise, beam out of the centre),
 *   then « Atlas » is revealed.
 * - Collapsing: the letters slide/fade into the mark (last letter first) while
 *   the beam pulls back into the centre and shoots out again; expanding plays
 *   it the other way. Hovering the mark sends a ripple around the ticks.
 * - Never display:none; every animated box keeps a fixed height (no jump).
 */
export function SidebarBrandLogo({ isCollapsed, subtitle }: { isCollapsed: boolean; subtitle?: string }) {
  const intro = useBrandIntro<HTMLSpanElement>('mount');
  const lang = useLang();
  const [morph, setMorph] = useState<'' | 'a' | 'b'>('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    // Alternate the class so the keyframes restart on every toggle.
    setMorph((m) => (m === 'a' ? 'b' : 'a'));
    const t = window.setTimeout(() => setMorph(''), 700);
    return () => window.clearTimeout(t);
  }, [isCollapsed]);

  const cls = ['atlas-brand', isCollapsed ? 'is-collapsed' : '', morph ? `is-morph-${morph}` : '', intro.className].filter(Boolean).join(' ');
  return (
    <span ref={intro.ref} className={cls} data-collapsed={isCollapsed ? 'true' : 'false'}>
      <span className="atlas-brand-row">
        <AtlasMark className="atlas-brand-mark" />
        <span className="atlas-brand-word" aria-hidden="true">{lang === 'ar' ? <span className="atlas-brand-word-ar" lang="ar" dir="rtl">أطلس</span> : <AtlasWordmark />}</span>
        <span className="sr-only">{lang === 'ar' ? 'أطلس للتجارة' : 'Atlas Commerce'}</span>
      </span>
      {subtitle ? (
        <span className="atlas-brand-sub-wrap" aria-hidden={isCollapsed || undefined}>
          <span className="atlas-brand-sub">{subtitle}</span>
        </span>
      ) : null}
    </span>
  );
}

export default SidebarBrandLogo;
