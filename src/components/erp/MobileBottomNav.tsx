import { useLocation, useNavigate } from 'react-router-dom';
import './atlas-tokens.css';
import './MobileBottomNav.css';
import {
  canManageStock,
  canOfficeWork,
  canSell,
  canAccessSettings,
  isStockRole,
} from '../../auth';

type Item = {
  id: string;
  label: string;
  path: string;
  icon: string;
  visible: boolean;
};

function buildNav(): Item[] {
  const stockOnly = isStockRole();
  return [
    {
      id: 'dashboard',
      label: 'Accueil',
      path: stockOnly ? '/products' : '/',
      icon: 'M3 12l9-9 9 9M5 10v10h14V10',
      visible: true,
    },
    {
      id: 'products',
      label: 'Stock',
      path: '/products',
      icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
      visible: canManageStock(),
    },
    {
      id: 'scan',
      label: 'Scan',
      path: '/scan',
      icon: 'M4 7V5a1 1 0 011-1h2M20 7V5a1 1 0 00-1-1h-2M4 17v2a1 1 0 001 1h2M20 17v2a1 1 0 01-1 1h-2M8 12h8',
      visible: canManageStock(),
    },
    {
      id: 'orders',
      label: 'Caisse',
      path: '/quick-sale',
      icon: 'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
      visible: canSell() && !stockOnly,
    },
    {
      id: 'invoices',
      label: 'Factures',
      path: '/invoices',
      icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6',
      visible: canOfficeWork() && !stockOnly,
    },
    {
      id: 'settings',
      label: 'Réglages',
      path: '/settings',
      icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9c.3.6.9 1 1.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
      visible: canAccessSettings(),
    },
  ].filter((i) => i.visible);
}

function activePath(pathname: string, path: string) {
  if (path === '/') return pathname === '/' || pathname === '';
  return pathname === path || pathname.startsWith(path + '/');
}

export default function MobileBottomNav({ badges }: { badges?: Partial<Record<string, number>> }) {
  const nav = useNavigate();
  const loc = useLocation();
  const items = buildNav().slice(0, 5);

  return (
    <nav className="atlas-mobile-nav" aria-label="Navigation mobile">
      <div className="atlas-mobile-nav-container">
        {items.map((item) => {
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
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
