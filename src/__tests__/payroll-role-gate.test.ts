// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canAccessAdminSettings, canManagePayroll, canOfficeWork } from '../auth';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('Payroll UI/API role gate alignment', () => {
  it('admits only owner and admin in canManagePayroll(), rejecting secretaire/stock/user like /api/payroll/*', () => {
    for (const role of ['owner', 'admin']) {
      localStorage.setItem('stock_role', role);
      expect(canManagePayroll()).toBe(true);
      expect(canAccessAdminSettings()).toBe(true);
    }

    for (const role of ['secretaire', 'stock', 'user']) {
      localStorage.setItem('stock_role', role);
      expect(canManagePayroll()).toBe(false);
    }

    localStorage.setItem('stock_role', 'secretaire');
    expect(canOfficeWork()).toBe(true);
    expect(canManagePayroll()).toBe(false);
  });

  it('gates both the /payroll route and sidebar nav entry with canManagePayroll() in src/App.tsx', () => {
    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(appSrc).toContain('<Route path="/payroll" element={<RoleGate allow={canManagePayroll()}><Payroll /></RoleGate>} />');
    expect(appSrc).not.toContain('<Route path="/payroll" element={<RoleGate allow={canOfficeWork()}><Payroll /></RoleGate>} />');

    expect(appSrc).toMatch(/\{canManagePayroll\(\)\s*&&\s*\(\s*<NavLink\s+to="\/payroll"/);
  });

  it('gates the payroll Settings tab with adminSettings (not officeSettings) in src/pages/Settings.tsx', () => {
    const settingsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf8');

    expect(settingsSrc).toContain("...(adminSettings ? [{ id: 'payroll', label: 'Paie CNSS / AMO'");
    expect(settingsSrc).toContain("{activeTab === 'payroll' && adminSettings && (");
    expect(settingsSrc).not.toContain("{activeTab === 'payroll' && officeSettings && (");
  });
});
