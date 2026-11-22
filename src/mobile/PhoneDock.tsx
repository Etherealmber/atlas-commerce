import { NavLink, useLocation } from 'react-router-dom';
import { Home, Package, ScanLine, Wallet, Users } from 'lucide-react';

/** Android keeps the dock on primary tabs and the sales/notifications overlays. */
export function showPhoneDock(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/m';
  return ['/m', '/m/scan', '/m/products', '/m/balance', '/m/employees', '/m/vente', '/m/inbox'].includes(path);
}

export function phoneShowsBack(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/m';
  return !showPhoneDock(path) || path === '/m/vente' || path === '/m/inbox';
}

export function phoneBackTarget(pathname: string): string {
  if (pathname.replace(/\/+$/, '') === '/m/device-scan') return '/m/profile';
  if (pathname.startsWith('/m/settings/')) return '/m/settings';
  if (pathname.startsWith('/m/products/')) return '/m/products';
  if (pathname.startsWith('/m/balance/')) return '/m/balance';
  return '/m';
}

export function canOpenPhoneBalance(role: string) {
  return role === 'owner' || role === 'admin' || role === 'secretaire';
}
export function canOpenPhoneEmployees(role: string) {
  return role === 'owner' || role === 'admin';
}

/** Match the Android dock where the web role permits the corresponding page.
 * Client-side visibility is not an authorization boundary. */
export function phoneDockItems(role: string) {
  const home = { id: 'home', label: 'Accueil', path: '/m', icon: Home };
  const products = { id: 'products', label: 'Produits', path: '/m/products', icon: Package };
  const scan = { id: 'scan', label: 'Scan', path: '/m/scan', icon: ScanLine };
  const balance = { id: 'balance', label: 'Balance', path: '/m/balance', icon: Wallet };
  const employees = { id: 'employees', label: 'Employés', path: '/m/employees', icon: Users };
  if (role === 'stock') return [home, scan, products];
  if (role === 'owner' || role === 'admin') return [home, products, scan, balance, employees];
  if (role === 'secretaire') return [home, products, scan, balance];
  // The web role does not have financial access even if Android offers a balance tab.
  return [home, products, scan];
}

export default function PhoneDock({ role, lastMainTab = '/m' }: { role: string; lastMainTab?: string }) {
  const items = phoneDockItems(role);
  const path = useLocation().pathname.replace(/\/+$/, '') || '/m';
  const overlay = path === '/m/vente' || path === '/m/inbox';
  const selectedOverlayTab = items.some(item => item.path === lastMainTab) ? lastMainTab : '/m';
  const center = items.findIndex((item) => item.id === 'scan');
  const renderItem = (item: typeof items[number]) => (
    <NavLink key={item.id} to={item.path} end={item.id === 'home'}
      className={({ isActive }) => `ptab${item.id === 'scan' ? ' ptab-scan' : ''}${isActive || (overlay && item.path === selectedOverlayTab) ? ' active' : ''}`}>
      <span className="ptab-ico"><item.icon size={22} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ptab-lbl">{item.label}</span>
    </NavLink>
  );
  return <nav className="phone-tabbar" aria-label="Navigation principale">
    <div className="phone-dock-side">{items.slice(0, center).map(renderItem)}</div>
    {renderItem(items[center])}
    <div className="phone-dock-side">{items.slice(center + 1).map(renderItem)}</div>
  </nav>;
}
