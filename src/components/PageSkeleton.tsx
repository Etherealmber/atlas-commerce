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

function KpiSkeletonGrid() {
  return (
    <div className="page-skeleton-kpis">
      {[0, 1, 2, 3].map((idx) => (
        <div key={idx} className="ac-skeleton-bento-card" style={{ padding: '16px 18px' }}>
          <div className="skeleton" style={{ height: 10, width: '48%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 22, width: '62%', marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 10, width: '74%' }} />
        </div>
      ))}
    </div>
  );
}

function PanelSkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ac-skeleton-bento-card" style={{ padding: '18px 20px' }}>
      <div className="skeleton" style={{ height: 13, width: '38%', marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 10, width: '62%', marginBottom: 18 }} />
      {Array.from({ length: rows }, (_, idx) => (
        <div
          key={idx}
          className="skeleton"
          style={{
            height: 36,
            borderRadius: 10,
            marginBottom: idx === rows - 1 ? 0 : 10,
            width: idx === rows - 1 ? '76%' : '100%',
          }}
        />
      ))}
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
        <div className="page-skeleton-grid">
          <div className="ac-skeleton-bento-card" style={{ padding: 14 }}>
            <div className="skeleton" style={{ height: 10, width: '50%', marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 20, width: '66%' }} />
          </div>
          <div className="ac-skeleton-bento-card" style={{ padding: 14 }}>
            <div className="skeleton" style={{ height: 10, width: '50%', marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 20, width: '66%' }} />
          </div>
        </div>
        <DesktopTableSkeleton rows={4} cols={3} />
      </div>
    );
  }

  if (variant === 'dashboard') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <KpiSkeletonGrid />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
        <DesktopTableSkeleton rows={4} cols={5} />
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      <div className="page-skeleton ac-settings-bento" aria-busy="true" aria-label="Chargement des paramètres">
        <KpiSkeletonGrid />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
        <DesktopTableSkeleton rows={5} cols={6} />
      </div>
    );
  }

  if (variant === 'about') {
    return (
      <div className="page-skeleton ac-about-bento" aria-busy="true" aria-label="Chargement de À propos">
        <KpiSkeletonGrid />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={2} />
          <PanelSkeletonCard rows={2} />
        </div>
        <div className="ac-skeleton-grid-3">
          <PanelSkeletonCard rows={2} />
          <PanelSkeletonCard rows={2} />
          <PanelSkeletonCard rows={2} />
        </div>
      </div>
    );
  }

  if (variant === 'changelog') {
    return (
      <div className="page-skeleton wn-changelog" aria-busy="true" aria-label="Chargement des nouveautés">
        <PanelSkeletonCard rows={2} />
        <div style={{ height: 14 }} />
        <PanelSkeletonCard rows={3} />
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={2} />
          <PanelSkeletonCard rows={2} />
        </div>
        <DesktopTableSkeleton rows={4} cols={5} />
      </div>
    );
  }

  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
      <KpiSkeletonGrid />
      <div className="page-skeleton-toolbar">
        <div className="skeleton" style={{ height: 38, width: 220, borderRadius: 999 }} />
        <div className="skeleton" style={{ height: 38, width: 132, borderRadius: 999 }} />
      </div>
      <DesktopTableSkeleton rows={6} cols={6} />
    </div>
  );
}

export function PageFallback() {
  return <PageSkeleton variant="list" />;
}
