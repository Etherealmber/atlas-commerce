/** Shared route-level and page-level skeleton while chunks or data load */
export default function PageSkeleton({
  variant = 'list',
}: {
  variant?: 'list' | 'dashboard' | 'form' | 'phone';
}) {
  if (variant === 'phone') {
    return (
      <div className="page-skeleton page-skeleton--phone" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-title" style={{ width: '55%' }} />
        <div className="skeleton skeleton-line" style={{ width: '40%' }} />
        <div className="page-skeleton-grid">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="skeleton skeleton-table" />
      </div>
    );
  }
  if (variant === 'dashboard') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-line" style={{ width: '18%', marginBottom: 10 }} />
        <div className="skeleton skeleton-title" style={{ width: '38%', marginBottom: 8 }} />
        <div className="skeleton skeleton-line" style={{ width: '48%', marginBottom: 20 }} />
        <div className="page-skeleton-kpis">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="page-skeleton-grid">
          <div className="skeleton skeleton-table" style={{ height: 260 }} />
          <div className="skeleton skeleton-table" style={{ height: 260 }} />
        </div>
      </div>
    );
  }
  if (variant === 'form') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-line" style={{ width: '18%', marginBottom: 10 }} />
        <div className="skeleton skeleton-title" style={{ width: '36%', marginBottom: 18 }} />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <div className="skeleton skeleton-card" style={{ minHeight: 110 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 110 }} />
        </div>
        <div className="skeleton" style={{ height: 48, marginBottom: 12, borderRadius: 12 }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 12, borderRadius: 12 }} />
        <div className="skeleton skeleton-table" style={{ height: 180 }} />
      </div>
    );
  }
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
      <div className="skeleton skeleton-line" style={{ width: '16%', marginBottom: 10 }} />
      <div className="skeleton skeleton-title" style={{ width: '34%', marginBottom: 8 }} />
      <div className="skeleton skeleton-line" style={{ width: '46%', marginBottom: 18 }} />
      <div className="page-skeleton-kpis">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="page-skeleton-toolbar">
        <div className="skeleton" style={{ height: 40, width: 220, borderRadius: 999 }} />
        <div className="skeleton" style={{ height: 40, width: 140, borderRadius: 999 }} />
      </div>
      <div className="skeleton skeleton-table" style={{ height: 220 }} />
    </div>
  );
}

export function PageFallback() {
  return <PageSkeleton variant="list" />;
}
