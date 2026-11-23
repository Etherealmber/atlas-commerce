/** Shared route-level and page-level shimmer skeletons matching desktop tables and screen sizes. */

const TABLE_WIDTHS = ['18%', '15%', '22%', '16%', '13%', '16%'];

export function DesktopTableSkeleton({
  rows = 6,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  const colCount = Math.max(2, Math.min(6, cols));
  const colsArr = Array.from({ length: colCount }, (_, idx) => idx);
  const rowsArr = Array.from({ length: rows }, (_, idx) => idx);

  return (
    <div
      className="ac-skeleton-table-wrap"
      data-cols={colCount}
      aria-busy="true"
      aria-label="Chargement du tableau"
    >
      <div className="ac-skeleton-thead">
        {colsArr.map((c) => (
          <div key={c} className="ac-skeleton-th">
            <span className="skeleton ac-skeleton-bar" style={{ width: c === 0 ? '68%' : '56%' }} />
          </div>
        ))}
      </div>
      <div className="ac-skeleton-tbody">
        {rowsArr.map((r) => (
          <div key={r} className="ac-skeleton-tr">
            {colsArr.map((c) => {
              const baseW = TABLE_WIDTHS[(r + c) % TABLE_WIDTHS.length];
              return (
                <div key={c} className="ac-skeleton-td">
                  <span
                    className={`skeleton ac-skeleton-bar${c === 1 ? ' ac-skeleton-bar--pill' : ''}`}
                    style={{ width: c === 1 ? '72%' : baseW === '22%' ? '84%' : '68%' }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PageSkeleton({
  variant = 'list',
}: {
  variant?: 'list' | 'dashboard' | 'form' | 'phone' | 'settings' | 'about' | 'changelog';
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
        <DesktopTableSkeleton rows={4} cols={3} />
      </div>
    );
  }

  if (variant === 'dashboard') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <div className="ac-skeleton-bento-card ac-skeleton-hero">
          <div className="skeleton skeleton-line" style={{ width: '18%', marginBottom: 10 }} />
          <div className="skeleton skeleton-title" style={{ width: '36%', marginBottom: 8 }} />
          <div className="skeleton skeleton-line" style={{ width: '52%' }} />
        </div>
        <div className="page-skeleton-kpis">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="page-skeleton-grid">
          <div className="skeleton skeleton-table" style={{ height: 240 }} />
          <div className="skeleton skeleton-table" style={{ height: 240 }} />
        </div>
        <DesktopTableSkeleton rows={4} cols={5} />
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      <div className="page-skeleton ac-settings-bento" aria-busy="true" aria-label="Chargement des paramètres">
        <div className="page-skeleton-kpis">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <div className="ac-skeleton-bento-card">
            <div className="skeleton skeleton-line" style={{ width: '42%', marginBottom: 14 }} />
            <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 40, width: '68%', borderRadius: 10 }} />
          </div>
          <div className="ac-skeleton-bento-card">
            <div className="skeleton skeleton-line" style={{ width: '48%', marginBottom: 14 }} />
            <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 40, width: '55%', borderRadius: 10 }} />
          </div>
        </div>
        <DesktopTableSkeleton rows={5} cols={6} />
      </div>
    );
  }

  if (variant === 'about') {
    return (
      <div className="page-skeleton ac-about-bento" aria-busy="true" aria-label="Chargement de À propos">
        <div className="ac-skeleton-bento-card ac-skeleton-hero">
          <div className="skeleton skeleton-line" style={{ width: '20%', marginBottom: 12 }} />
          <div className="skeleton skeleton-title" style={{ width: '32%', marginBottom: 10 }} />
          <div className="skeleton skeleton-line" style={{ width: '64%', marginBottom: 16 }} />
          <div className="ac-skeleton-pill-row">
            <span className="skeleton ac-skeleton-pill" />
            <span className="skeleton ac-skeleton-pill" />
            <span className="skeleton ac-skeleton-pill" />
            <span className="skeleton ac-skeleton-pill" />
          </div>
        </div>
        <div className="page-skeleton-kpis">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <div className="skeleton skeleton-card" style={{ minHeight: 160 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 160 }} />
        </div>
        <div className="ac-skeleton-bento-card" style={{ marginBottom: 14 }}>
          <div className="skeleton skeleton-line" style={{ width: '28%', marginBottom: 12 }} />
          <div className="ac-skeleton-pill-row">
            <span className="skeleton ac-skeleton-pill" style={{ width: 140 }} />
            <span className="skeleton ac-skeleton-pill" style={{ width: 130 }} />
            <span className="skeleton ac-skeleton-pill" style={{ width: 120 }} />
          </div>
        </div>
        <div className="ac-skeleton-grid-3">
          <div className="skeleton skeleton-card" style={{ minHeight: 130 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 130 }} />
          <div className="skeleton skeleton-card" style={{ minHeight: 130 }} />
        </div>
      </div>
    );
  }

  if (variant === 'changelog') {
    return (
      <div className="page-skeleton wn-changelog" aria-busy="true" aria-label="Chargement des nouveautés">
        <div className="skeleton skeleton-line" style={{ width: '16%', marginBottom: 10 }} />
        <div className="skeleton skeleton-title" style={{ width: '28%', marginBottom: 18 }} />
        <div className="ac-skeleton-bento-card" style={{ marginBottom: 16 }}>
          <div className="skeleton skeleton-line" style={{ width: '34%', marginBottom: 12 }} />
          <div className="ac-skeleton-pill-row">
            <span className="skeleton ac-skeleton-pill" style={{ width: 130 }} />
            <span className="skeleton ac-skeleton-pill" style={{ width: 145 }} />
            <span className="skeleton ac-skeleton-pill" style={{ width: 120 }} />
          </div>
        </div>
        {[0, 1].map((idx) => (
          <div key={idx} className="ac-skeleton-bento-card" style={{ marginBottom: 14 }}>
            <div className="skeleton skeleton-line" style={{ width: '26%', marginBottom: 14 }} />
            <div className="skeleton skeleton-line" style={{ width: '88%', marginBottom: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: '76%', marginBottom: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: '64%' }} />
          </div>
        ))}
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
        <DesktopTableSkeleton rows={4} cols={5} />
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
      <DesktopTableSkeleton rows={6} cols={6} />
    </div>
  );
}

export function PageFallback() {
  return <PageSkeleton variant="list" />;
}
