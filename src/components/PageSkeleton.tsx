/** Shared route-level and page-level shimmer skeletons matching each desktop page layout. */

const TABLE_WIDTHS = ['18%', '15%', '22%', '16%', '13%', '16%'];

export type PageSkeletonVariant =
  | 'list'
  | 'dashboard'
  | 'products'
  | 'kpis3-list'
  | 'kpis4-list'
  | 'table-only'
  | 'balance'
  | 'reports'
  | 'inventory-ops'
  | 'payroll'
  | 'cash-shifts'
  | 'attendance'
  | 'actions'
  | 'form'
  | 'phone'
  | 'settings'
  | 'about'
  | 'changelog'
  | 'landing'
  | 'welcome';

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

function KpiSkeletonGrid({ count = 4 }: { count?: 3 | 4 | 6 }) {
  const cls =
    count === 6
      ? 'page-skeleton-kpis page-skeleton-kpis--6'
      : count === 3
        ? 'page-skeleton-kpis page-skeleton-kpis--3'
        : 'page-skeleton-kpis';
  return (
    <div className={cls}>
      {Array.from({ length: count }, (_, idx) => (
        <div key={idx} className="ac-skeleton-bento-card" style={{ padding: '14px 16px', minHeight: 96 }}>
          <div className="skeleton" style={{ height: 10, width: '48%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 22, width: '62%', marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 10, width: '74%' }} />
        </div>
      ))}
    </div>
  );
}

function PanelSkeletonCard({
  rows = 3,
  tallBlock = false,
}: {
  rows?: number;
  tallBlock?: boolean;
}) {
  return (
    <div className="ac-skeleton-bento-card" style={{ padding: '18px 20px' }}>
      <div className="skeleton" style={{ height: 13, width: '38%', marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 10, width: '62%', marginBottom: 18 }} />
      {tallBlock ? (
        <div className="skeleton" style={{ height: 175, borderRadius: 12 }} />
      ) : (
        Array.from({ length: rows }, (_, idx) => (
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
        ))
      )}
    </div>
  );
}

function FilterBarSkeletonCard({ pills = 3 }: { pills?: number }) {
  return (
    <div className="ac-skeleton-bento-card ac-skeleton-filter-bar">
      <div className="skeleton ac-skeleton-search-pill" />
      <div className="ac-skeleton-filter-pills">
        {Array.from({ length: pills }, (_, idx) => (
          <div
            key={idx}
            className="skeleton"
            style={{ height: 36, width: idx === pills - 1 ? 112 : 138, borderRadius: 12 }}
          />
        ))}
      </div>
    </div>
  );
}

export function ActionListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ac-skeleton-action-list" aria-busy="true" aria-label="Chargement des actions">
      {Array.from({ length: rows }, (_, idx) => (
        <div key={idx} className="ac-skeleton-action-row">
          <div className="skeleton ac-skeleton-action-icon" />
          <div className="ac-skeleton-action-copy">
            <div className="skeleton" style={{ height: 13, width: idx % 2 === 0 ? '42%' : '54%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 10, width: idx % 2 === 0 ? '68%' : '58%' }} />
          </div>
          <div className="ac-skeleton-action-btns">
            <div className="skeleton" style={{ height: 30, width: 88, borderRadius: 999 }} />
            <div className="skeleton" style={{ height: 30, width: 76, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AtlasAgentShimmerBody({ rows = 2 }: { rows?: number }) {
  return (
    <div className="atlas-agent-shimmer-thread" aria-busy="true" aria-label="Chargement de la conversation">
      {Array.from({ length: rows }, (_, idx) => (
        <div key={idx} className="atlas-agent-shimmer-pair">
          <div className="atlas-agent-msg user">
            <div className="atlas-agent-bubble atlas-agent-shimmer-bubble atlas-agent-shimmer-bubble--user">
              <div className="skeleton" style={{ height: 11, width: idx === 0 ? 156 : 124 }} />
            </div>
          </div>
          <div className="atlas-agent-msg assistant">
            <div className="atlas-agent-bubble atlas-agent-shimmer-bubble">
              <div className="skeleton" style={{ height: 11, width: '92%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 11, width: '78%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 11, width: '54%' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PageSkeleton({
  variant = 'list',
}: {
  variant?: PageSkeletonVariant;
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
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement du tableau de bord">
        <div className="ac-skeleton-bento-card ac-skeleton-hero ac-skeleton-hero--split">
          <div>
            <div className="skeleton" style={{ height: 10, width: 150, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 26, width: 240, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 12, width: 320 }} />
          </div>
          <div className="ac-skeleton-pill-row">
            <span className="skeleton ac-skeleton-pill" style={{ width: 168, height: 34 }} />
            <span className="skeleton ac-skeleton-pill" style={{ width: 196, height: 34 }} />
          </div>
        </div>
        <KpiSkeletonGrid count={4} />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard tallBlock />
          <PanelSkeletonCard tallBlock />
        </div>
        <div className="ac-skeleton-grid-3">
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
      </div>
    );
  }

  if (variant === 'products') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement des produits">
        <KpiSkeletonGrid count={6} />
        <FilterBarSkeletonCard pills={4} />
        <DesktopTableSkeleton rows={7} cols={6} />
      </div>
    );
  }

  if (variant === 'kpis3-list') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <KpiSkeletonGrid count={3} />
        <FilterBarSkeletonCard pills={2} />
        <DesktopTableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  if (variant === 'kpis4-list') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <KpiSkeletonGrid count={4} />
        <FilterBarSkeletonCard pills={3} />
        <DesktopTableSkeleton rows={6} cols={6} />
      </div>
    );
  }

  if (variant === 'table-only') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <FilterBarSkeletonCard pills={3} />
        <DesktopTableSkeleton rows={6} cols={6} />
      </div>
    );
  }

  if (variant === 'balance') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement de la trésorerie">
        <div className="ac-skeleton-bento-card ac-skeleton-compact-bar">
          <div className="skeleton" style={{ height: 42, width: 320, borderRadius: 14 }} />
        </div>
        <KpiSkeletonGrid count={4} />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={2} />
          <PanelSkeletonCard rows={2} />
        </div>
        <DesktopTableSkeleton rows={5} cols={5} />
      </div>
    );
  }

  if (variant === 'reports') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement des rapports">
        <div className="ac-skeleton-bento-card ac-skeleton-compact-bar">
          <div className="skeleton" style={{ height: 34, width: 170, borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 34, width: 210, borderRadius: 999 }} />
        </div>
        <KpiSkeletonGrid count={4} />
        <div className="ac-skeleton-bento-card" style={{ marginBottom: 14 }}>
          <div className="skeleton" style={{ height: 14, width: '32%', marginBottom: 14 }} />
          <div className="ac-skeleton-pill-row" style={{ marginBottom: 14 }}>
            {[0, 1, 2, 3, 4].map((idx) => (
              <span key={idx} className="skeleton" style={{ height: 52, flex: '1 1 110px', borderRadius: 12 }} />
            ))}
          </div>
          <DesktopTableSkeleton rows={4} cols={6} />
        </div>
        <div className="page-skeleton-grid">
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
      </div>
    );
  }

  if (variant === 'inventory-ops') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement des opérations stock">
        <div className="ac-skeleton-compact-bar ac-skeleton-compact-bar--bare">
          <div className="skeleton" style={{ height: 36, width: 240, borderRadius: 12 }} />
        </div>
        <KpiSkeletonGrid count={4} />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={4} />
          <PanelSkeletonCard rows={4} />
        </div>
        <DesktopTableSkeleton rows={5} cols={6} />
      </div>
    );
  }

  if (variant === 'payroll') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement de la paie">
        <KpiSkeletonGrid count={4} />
        <div className="ac-skeleton-bento-card" style={{ marginBottom: 14 }}>
          <div className="skeleton" style={{ height: 14, width: '28%', marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 10, width: '52%', marginBottom: 16 }} />
          <div className="ac-skeleton-pill-row">
            <span className="skeleton" style={{ height: 38, flex: '1 1 180px', borderRadius: 12 }} />
            <span className="skeleton" style={{ height: 38, flex: '1 1 180px', borderRadius: 12 }} />
            <span className="skeleton" style={{ height: 38, width: 168, borderRadius: 999 }} />
          </div>
        </div>
        <div className="page-skeleton-grid">
          <PanelSkeletonCard rows={4} />
          <PanelSkeletonCard rows={4} />
        </div>
      </div>
    );
  }

  if (variant === 'cash-shifts') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement des clôtures de caisse">
        <KpiSkeletonGrid count={4} />
        <div className="page-skeleton-grid" style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <PanelSkeletonCard rows={3} />
        </div>
        <DesktopTableSkeleton rows={4} cols={6} />
      </div>
    );
  }

  if (variant === 'attendance') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement du pointage">
        <div className="ac-skeleton-bento-card ac-skeleton-compact-bar" style={{ justifyContent: 'space-between' }}>
          <div className="skeleton" style={{ height: 36, width: 260, borderRadius: 999 }} />
          <div className="ac-skeleton-pill-row">
            <div className="skeleton" style={{ height: 34, width: 160, borderRadius: 999 }} />
            <div className="skeleton" style={{ height: 34, width: 150, borderRadius: 999 }} />
          </div>
        </div>
        <KpiSkeletonGrid count={4} />
        <DesktopTableSkeleton rows={6} cols={6} />
      </div>
    );
  }

  if (variant === 'actions') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement des actions">
        <KpiSkeletonGrid count={4} />
        <div className="ac-skeleton-bento-card">
          <div className="ac-skeleton-compact-bar ac-skeleton-compact-bar--bare" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="skeleton" style={{ height: 34, width: 250, borderRadius: 999 }} />
            <div className="skeleton" style={{ height: 28, width: 140, borderRadius: 999 }} />
          </div>
          <ActionListRowsSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      <div className="page-skeleton ac-settings-bento" aria-busy="true" aria-label="Chargement des paramètres">
        <KpiSkeletonGrid count={4} />
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
        <KpiSkeletonGrid count={4} />
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

  if (variant === 'landing' || variant === 'welcome') {
    return (
      <div
        className="page-skeleton"
        style={{ maxWidth: 1080, margin: '28px auto', padding: '0 20px' }}
        aria-busy="true"
        aria-label="Chargement"
      >
        <div className="ac-skeleton-bento-card ac-skeleton-hero" style={{ marginBottom: 18 }}>
          <div className="skeleton" style={{ height: 12, width: 140, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 30, width: '48%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 14, width: '68%', marginBottom: 18 }} />
          <div className="ac-skeleton-pill-row">
            <span className="skeleton" style={{ height: 40, width: 170, borderRadius: 999 }} />
            <span className="skeleton" style={{ height: 40, width: 140, borderRadius: 999 }} />
          </div>
        </div>
        <div className="page-skeleton-grid">
          <PanelSkeletonCard rows={3} />
          <PanelSkeletonCard rows={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
      <FilterBarSkeletonCard pills={3} />
      <DesktopTableSkeleton rows={6} cols={6} />
    </div>
  );
}

export function PageFallback() {
  return <PageSkeleton variant="list" />;
}
