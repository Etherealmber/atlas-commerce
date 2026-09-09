import { useLocation, useNavigate } from 'react-router-dom';
import './atlas-tokens.css';
import './MobileBottomNav.css';

type Item = {
  id: string;
  label: string;
  path: string;
  badge?: number;
  /** SVG path d */
  icon: string;
};

const NAV: Item[] = [
  { id: 'dashboard', label: 'Aperçu', path: '/', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { id: 'orders', label: 'Ventes', path: '/quick-sale', icon: 'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z' },
  { id: 'invoices', label: 'Factures', path: '/invoices', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6' },
  { id: 'settings', label: 'Réglages', path: '/settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9c.3.6.9 1 1.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
];

function activePath(pathname: string, path: string) {
  if (path === '/') return pathname === '/' || pathname === '';
  return pathname === path || pathname.startsWith(path + '/');
}

export default function MobileBottomNav({ badges }: { badges?: Partial<Record<string, number>> }) {
  const nav = useNavigate();
  const loc = useLocation();
  if (loc.pathname.startsWith('/m')) return null;

  return (
    <nav className="atlas-mobile-nav" aria-label="Navigation mobile">
      <div className="atlas-mobile-nav-container">
        {NAV.map((item) => {
          const isActive = activePath(loc.pathname, item.path);
          const badge = badges?.[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={`atlas-nav-btn${isActive ? ' active' : ''}`}
              onClick={() => nav(item.path)}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="atlas-icon-wrapper">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={item.icon} />
                </svg>
                {badge && badge > 0 ? (
                  <span className="atlas-badge">{badge > 99 ? '99+' : badge}</span>
                ) : null}
              </div>
              <span className="atlas-nav-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
