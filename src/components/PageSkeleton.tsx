import type { ReactNode } from 'react';

/** Shared route-level skeleton while lazy chunks load */
export default function PageSkeleton({ variant = 'list' }: { variant?: 'list' | 'dashboard' | 'form' | 'phone' }) {
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
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="page-skeleton-kpis">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
        <div className="page-skeleton-grid">
          <div className="skeleton skeleton-table" />
          <div className="skeleton skeleton-table" />
        </div>
      </div>
    );
  }
  if (variant === 'form') {
    return (
      <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-title" style={{ width: '36%' }} />
        <div className="skeleton skeleton-line" style={{ width: '22%' }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Chargement">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="page-skeleton-toolbar">
        <div className="skeleton" style={{ height: 40, width: 180 }} />
        <div className="skeleton" style={{ height: 40, width: 120 }} />
      </div>
      <div className="skeleton skeleton-table" />
      <div className="skeleton skeleton-table" style={{ height: 120, marginTop: 12 }} />
    </div>
  );
}

export function PageFallback() {
  return <PageSkeleton variant="list" />;
}
