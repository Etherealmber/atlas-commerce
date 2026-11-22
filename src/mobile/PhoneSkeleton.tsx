type Props = { variant?: 'catalog-list' | 'catalog-grid' | 'dashboard' | 'rows'; label?: string };
/** Content-shaped placeholder; no fake numbers or interactive elements. */
export default function PhoneSkeleton({ variant = 'rows', label = 'Chargement…' }: Props) {
  return <div className={`ph-skeleton ph-skeleton--${variant}`} role="status" aria-label={label} aria-busy="true">
    <span className="ph-sr-only">{label}</span>
    {variant === 'dashboard' && <><div className="ph-skeleton-hero"><i /><i /><i /></div><div className="ph-skeleton-tiles"><i /><i /></div></>}
    <div className="ph-skeleton-items" aria-hidden="true">{Array.from({ length: variant === 'catalog-grid' ? 4 : 3 }, (_, i) => <div className="ph-skeleton-row" key={i}><i className="ph-skeleton-art" /><div><i /><i /><i /></div></div>)}</div>
  </div>;
}
