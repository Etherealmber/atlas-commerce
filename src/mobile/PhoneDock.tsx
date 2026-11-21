import { NavLink } from 'react-router-dom';
import { Home, Package, ScanLine, Wallet, Users } from 'lucide-react';

/** The floating dock belongs to the five primary destinations only. */
export function showPhoneDock(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/m';
  return path === '/m' || ['/m/scan', '/m/products', '/m/balance', '/m/employees'].some((base) => path === base || path.startsWith(`${base}/`));
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

export default function PhoneDock({ role }: { role: string }) {
  const items = phoneDockItems(role);
  const center = items.findIndex((item) => item.id === 'scan');
  const renderItem = (item: typeof items[number]) => (
    <NavLink key={item.id} to={item.path} end={item.id === 'home'}
      className={({ isActive }) => `ptab${item.id === 'scan' ? ' ptab-scan' : ''}${isActive ? ' active' : ''}`}>
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
