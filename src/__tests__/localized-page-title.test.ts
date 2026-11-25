// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { installI18n } from '../i18n';
import { applyPageTitle, titleForPath } from '../lib/pageTitle';

installI18n();

describe('localized page titles', () => {
  it('translates all fixed and dynamic routes in Arabic and English', () => {
    const paths = ['/', '/dashboard', '/actions', '/products', '/scan', '/clients', '/employees', '/payroll', '/attendance', '/vendors', '/quotes', '/quick-sale', '/invoices', '/reimbursements', '/bills', '/receipts', '/balance', '/cash-shifts', '/reports', '/inventory-ops', '/settings', '/about', '/whats-new', '/privacy', '/licenses', '/terms', '/support', '/login', '/welcome', '/404', '/403', '/android', '/desktop', '/m', '/m/products', '/m/balance', '/m/agent', '/p/1', '/products/1/historique', '/invoices/1', '/quick-sale/1', '/error/500'];
    for (const path of paths) {
      expect(titleForPath(path, 'ar'), path).not.toBe(titleForPath(path, 'fr'));
      expect(titleForPath(path, 'ar').split(' · ')[0], path).toMatch(/[\u0600-\u06ff]/);
      expect(titleForPath(path, 'en'), path).toMatch(/Atlas/);
    }
  });
  it('updates browser and social titles in the selected language', () => {
    applyPageTitle('/dashboard', 'ar');
    expect(document.title).toBe('لوحة القيادة · أطلس');
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(document.title);
    applyPageTitle('/dashboard', 'en');
    expect(document.title).toBe('Dashboard · Atlas');
  });
});
