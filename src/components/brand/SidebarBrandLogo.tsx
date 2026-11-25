import { AtlasMark, AtlasWordmark } from './AtlasMark';
import './atlas-brand.css';

/**
 * Sidebar lockup. Expanded: sunburst + "Atlas" (+ optional subtitle).
 * Collapsed: the sunburst alone, centred in the rail.
 *
 * The collapse never uses display:none — the wordmark clips through max-width +
 * clip-path while its letters slide/fade into the mark (last letter first), and
 * the beam shortens to a regular tick so the closed mark reads as a full sun.
 * Every animated box keeps a fixed height, so nothing below jumps or flickers.
 */
export function SidebarBrandLogo({ isCollapsed, subtitle }: { isCollapsed: boolean; subtitle?: string }) {
  return (
    <span className={`atlas-brand${isCollapsed ? ' is-collapsed' : ''}`} data-collapsed={isCollapsed ? 'true' : 'false'}>
      <span className="atlas-brand-row">
        <AtlasMark className="atlas-brand-mark" />
        <span className="atlas-brand-word" aria-hidden="true"><AtlasWordmark /></span>
        <span className="sr-only">Atlas Commerce</span>
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
