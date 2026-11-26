// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import FocusSidebar from '../components/FocusSidebar';
import { PublicSettingsTopbar } from '../components/PublicChrome';
import About from '../pages/About';
import Reports from '../pages/Reports';
import InventoryOps from '../pages/InventoryOps';
import Settings from '../pages/Settings';
import Payroll from '../pages/Payroll';
import CashShifts from '../pages/CashShifts';
import Actions from '../pages/Actions';
import Support from '../pages/Support';
import { api } from '../api';
import { vi } from 'vitest';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('stock_role', 'owner');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('FocusSidebar, clean focus topbar, and dark-mode button contrast', () => {
  it('renders grouped settings navigation and supports collapsing/expanding', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/settings?tab=invoicing'] },
          createElement(FocusSidebar, { authenticated: true }),
        ),
      );
    });

    const aside = host.querySelector('aside.atlas-focus-sidebar')!;
    expect(aside).not.toBeNull();
    expect(aside.classList.contains('is-collapsed')).toBe(false);
    expect(aside.textContent).toContain('Paramètres');
    expect(aside.textContent).toContain('Mon profil');
    expect(aside.textContent).toContain('Facturation');
    expect(aside.textContent).toContain('Atlas Agent');

    const active = aside.querySelector('button.atlas-focus-nav-item.is-active');
    expect(active?.textContent).toContain('Facturation');

    const collapseBtn = aside.querySelector<HTMLButtonElement>('button.atlas-focus-collapse-btn')!;
    await act(async () => collapseBtn.click());
    expect(aside.classList.contains('is-collapsed')).toBe(true);
    expect(localStorage.getItem('atlas-focus-sidebar-collapsed')).toBe('1');
  });

  it('renders filter links on /whats-new and section links on /about', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/whats-new?f=added'] },
          createElement(FocusSidebar, { authenticated: false }),
        ),
      );
    });

    expect(host.querySelector('aside.atlas-focus-sidebar')?.textContent).toContain('Filtrer le journal');
    expect(host.querySelector('button.atlas-focus-nav-item.is-active')?.textContent).toContain('Ajouté');

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/about'] },
          createElement(FocusSidebar, { authenticated: true }),
        ),
      );
    });

    const aboutText = host.querySelector('aside.atlas-focus-sidebar')?.textContent || '';
    expect(aboutText).toContain('Présentation');
    expect(aboutText).toContain('Signaler un bug');
    expect(aboutText).toContain('Confidentialité');
  });

  it('removes horizontal icon-row tabs and search buttons from PublicSettingsTopbar, PublicNav, and App.tsx focus header', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/whats-new'] },
          createElement(PublicSettingsTopbar),
        ),
      );
    });

    expect(host.querySelector('.settings-topbar-tabs')).toBeNull();
    expect(host.querySelector('.settings-topbar-searchtab')).toBeNull();
    expect(host.querySelector('[aria-label="Recherche globale"]')).toBeNull();

    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).not.toContain('SETTINGS_TOP_TABS');
    expect(appSrc).not.toContain('settings-topbar');
    expect(appSrc).toContain('<FocusSidebar');
    expect(appSrc).toContain('ac-desktop-dock');

    const publicChromeSrc = readFileSync(path.resolve(process.cwd(), 'src/components/PublicChrome.tsx'), 'utf8');
    expect(publicChromeSrc).not.toContain('Recherche globale');
    expect(publicChromeSrc).toContain('<TopbarUserMenu');
  });

  it('locks dark-mode button contrast on hover/focus/active and segmented pills without purple', () => {
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    expect(focusCss).not.toMatch(/#4f46e5|#6366f1|#4338ca/i);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+\.content\s+\.ac-dash-period-pills\s+button\.ac-seg-btn\[aria-pressed="true"\][\s\S]*-webkit-text-fill-color:\s*#0f172a\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+aside\.atlas-focus-sidebar\s+button\.atlas-focus-nav-item\.is-active[\s\S]*background:\s*#f4f4f5\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\](?::not\(\.phone-shell\))?\s+body\s+\.content\s+button:hover:not\(:disabled\):not\(\.secondary\):not\(\.danger\):not\(\.ghost\):not\(\.ac-seg-btn\)[\s\S]*-webkit-text-fill-color:\s*#18181b\s*!important;/);
  });

  it('does not render duplicate Tableau de bord button in FocusSidebar', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/settings'] },
          createElement(FocusSidebar, { authenticated: true }),
        ),
      );
    });
    expect(host.querySelector('aside.atlas-focus-sidebar')?.textContent).not.toContain('Tableau de bord');
  });

  it('renders About, Reports, and InventoryOps in Dashboard Bento layout with all sections visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
    vi.spyOn(api, 'getAgingReport').mockResolvedValue({ data: { as_of: '2026-10-20', buckets: {}, rows: [] } } as any);
    vi.spyOn(api, 'getTvaReport').mockResolvedValue({ data: { sales: [], credits: [] } } as any);
    vi.spyOn(api, 'getReorderList').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getCogsReport').mockResolvedValue({ data: { method: 'fifo', lines: [] } } as any);
    vi.spyOn(api, 'getPeriodLock').mockResolvedValue({ data: {} } as any);
    vi.spyOn(api, 'getStockLocations').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getStockValuation').mockResolvedValue({ data: { total_value: 0, lines: [] } } as any);
    vi.spyOn(api, 'getStockReport').mockResolvedValue({ data: { totals: {}, by_warehouse: [], by_category: [], lines: [] } } as any);
    vi.spyOn(api, 'getAutoTransferRules').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/about'] }, createElement(About)));
    });
    expect(host.querySelector('.ac-dash-hero')).not.toBeNull();
    expect(host.querySelector('.ac-metric-grid')).not.toBeNull();
    expect(host.querySelector('#about-overview')).not.toBeNull();
    expect(host.querySelector('#about-features')).not.toBeNull();
    expect(host.querySelector('#about-creator')).not.toBeNull();
    expect(host.querySelector('#about-projects')).not.toBeNull();

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/reports'] }, createElement(Reports)));
    });
    const repText = host.textContent || '';
    expect(repText).toContain('Balance âgée');
    expect(repText).toContain('Récapitulatif TVA');
    expect(repText).toContain('Coût des ventes (COGS)');
    expect(repText).toContain('À réapprovisionner');
    expect(repText).toContain('Clôture de période fiscale');

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/inventory-ops'] }, createElement(InventoryOps)));
    });
    const opsText = host.textContent || '';
    expect(opsText).toContain('Transfert inter-emplacements');
    expect(opsText).toContain('Inventaire physique');
    expect(opsText).toContain('Rapport stock consolidé');
    expect(opsText).toContain('Emplacements / entrepôts');
    expect(opsText).toContain('Valorisation stock');
    expect(opsText).toContain('Transferts automatiques');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('switches active item dynamically in FocusSidebar on About and Legal pages', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/about'] },
          createElement(FocusSidebar, { authenticated: false }),
        ),
      );
    });
    const getButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('aside.atlas-focus-sidebar button.atlas-focus-nav-item'));
    const overviewBtn = getButtons().find((b) => b.textContent?.includes('Présentation'));
    const featuresBtn = getButtons().find((b) => b.textContent?.includes('Fonctionnalités'));
    expect(overviewBtn?.classList.contains('is-active')).toBe(true);
    expect(featuresBtn?.classList.contains('is-active')).toBe(false);

    await act(async () => {
      featuresBtn?.click();
    });
    expect(getButtons().find((b) => b.textContent?.includes('Présentation'))?.classList.contains('is-active')).toBe(false);
    expect(getButtons().find((b) => b.textContent?.includes('Fonctionnalités'))?.classList.contains('is-active')).toBe(true);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { key: 'terms', initialEntries: ['/terms'] },
          createElement(FocusSidebar, { authenticated: false }),
        ),
      );
    });
    const termsBtn = getButtons().find((b) => b.textContent?.includes('Conditions'));
    const privacyBtn = getButtons().find((b) => b.textContent?.includes('Confidentialité'));
    expect(termsBtn?.classList.contains('is-active')).toBe(true);
    expect(privacyBtn?.classList.contains('is-active')).toBe(false);
  });

  it('renders /support page strictly for Atlas Commerce & Etherealmber with Cloudflare Turnstile', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/support'] }, createElement(Support)));
    });
    const txt = host.textContent || '';
    expect(host.querySelector('.download-landing.desktop-landing.support-landing')).not.toBeNull();
    expect(txt).toContain('Atlas Commerce');
    expect(txt).toContain('Etherealmber');
    expect(txt).not.toMatch(/afmarbre|05 22 96 97 36|06 61 12 45 78|El Jadida|Berahma|WhatsApp/i);
    expect(host.querySelectorAll('.dl-support-faq details')).toHaveLength(6);

    const supportSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Support.tsx'), 'utf8');
    expect(supportSrc).toContain('id="cf-turnstile"');
    expect(supportSrc).toContain('/api/auth/turnstile-config');
    expect(supportSrc).toContain('/api/reports');

    const aboutSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/About.tsx'), 'utf8');
    expect(aboutSrc).not.toMatch(/afmarbre|APP_LOCATION|Conformité Maroc/i);
    expect(aboutSrc).toContain('about-page');

    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).toContain('path="/support"');
    expect(appSrc).toContain('path="/supprot"');
    expect(appSrc).toContain('PublicLegalOutlet');
    expect(appSrc).toContain('layout--focus');
    expect(appSrc).toContain('{!isFocusRoute && (');
  });

  it('keeps FocusSidebar, Bento metrics, CookieConsent, and split download CTAs properly styled', () => {
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const shellCss = readFileSync(path.resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const indexCss = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    const darkCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');

    expect(focusCss).toContain('text-decoration: none !important;');
    expect(focusCss).toContain('transform: translateY(-50%);');
    expect(focusCss).toContain('.ac-metric-label');
    expect(focusCss).toContain('.ac-metric-val');
    expect(focusCss).toContain('.ac-metric-meta');
    expect(focusCss).toContain('.atlas-focus-main .privacy-page');
    expect(shellCss).toContain('.layout.layout--focus');
    expect(shellCss).toContain(':not(.atlas-focus-nav-item)');
    expect(shellCss).toContain('.ac-dash-hero:has(.ac-dash-hero-side)');
    expect(indexCss).toContain('background: transparent !important;');
    expect(indexCss).toContain(':not(.public-download-toggle)');
    expect(indexCss).not.toContain('rgba(18, 46, 39');
    expect(darkCss).toContain('.public-download-menu-item');
    expect(darkCss).toContain('.atlas-dl-teaser-link');
    expect(darkCss).toContain('html body .cookie-consent-head a { color: #18181b !important;');
    expect(darkCss).toContain('outline: 2px solid #18181b !important;');
    expect(darkCss).toContain('.ac-topbar-notif-wrap');
    expect(darkCss).toContain('.modal-form-alert--error');
    expect(darkCss).toContain('color-scheme: dark');
    expect(darkCss).toContain('html[data-theme] body .privacy-link-btn');
    expect(darkCss).toContain('--bg: #121215 !important;');
    expect(darkCss).toContain('--paper: #18181b !important;');
    expect(darkCss).toContain(':not(.privacy-link-btn)');
    expect(darkCss).toMatch(/thead\s+th:last-child\s*\{[^}]*text-align:\s*center\s*!important;/s);
    for (const legal of ['src/pages/Privacy.tsx', 'src/pages/Terms.tsx', 'src/pages/Licenses.tsx']) {
      expect(readFileSync(path.resolve(process.cwd(), legal), 'utf8')).not.toContain('privacy-nav');
    }
    expect(shellCss).toContain('display: inline-flex !important;');
    expect(shellCss).toContain('white-space: nowrap;');
    expect(overridesCss).toContain('white-space: nowrap !important;');
    expect(appCss).toContain('.atlas-dl-teaser-link');
    expect(appCss).toContain('minmax(0, 310px) minmax(0, 1fr)');
    expect(appCss).toContain('.download-landing .dl-ed-heading { min-width: 0;');

    const cleanedFiles = [
      'src/styles/theme.css',
      'src/styles/login-auth.css',
      'src/components/SaveFeedback.tsx',
      'src/components/ui/RunActionButton.tsx',
      'src/pages/Receipts.tsx',
      'src/pages/Dashboard.tsx',
      'src/pages/Welcome.tsx',
      'src/App.css',
    ];
    for (const rel of cleanedFiles) {
      const content = readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      expect(content).not.toMatch(/#4f46e5|#6366f1|#8b5cf6|#a5b4fc|#c4b5fd|#eef2ff|rgba\(99,\s*102,\s*241|rgba\(124,\s*58,\s*237|rgba\(139,\s*156,\s*255/i);
    }
  });

  it('formats chart money compactly as 1k / 1M / 1B when large or tight while keeping normal values intact', async () => {
    const { formatCompactNum, formatAxisVal } = await import('../components/DashboardCharts');

    expect(formatCompactNum(0, 'MAD')).toBe('0 DH');
    expect(formatCompactNum(12500, 'MAD', 100_000)).toMatch(/12[\s\u202f\u00a0]?500 DH/);
    expect(formatCompactNum(12500, 'MAD', 10_000)).toBe('12.5k DH');
    expect(formatCompactNum(150_000, 'MAD')).toBe('150k DH');
    expect(formatCompactNum(2_500_000, 'MAD')).toBe('2.5M DH');
    expect(formatCompactNum(1_200_000_000, 'MAD')).toBe('1.2B DH');

    expect(formatAxisVal(1_500_000_000, 2_000_000_000)).toBe('1.5B');
    expect(formatAxisVal(2_000_000, 4_000_000)).toBe('2M');
    expect(formatAxisVal(45_000, 50_000)).toBe('45k');
  });

  it('prevents layout--focus collapse under sidebar-collapsed, keeps FocusSidebar light buttons unhijacked, and fixes Reports/InventoryOps bento layout', () => {
    const shellCss = readFileSync(path.resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const indexCss = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');
    const darkCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const reportsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Reports.tsx'), 'utf8');
    const opsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/InventoryOps.tsx'), 'utf8');

    // 1. Focus layout stays single-column 1fr even when main sidebar was previously collapsed
    expect(shellCss).toMatch(/\.layout\.layout--focus\.sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/s);
    expect(appCss).toMatch(/\.page-anim\s*\{\s*opacity:\s*1;/);
    expect(indexCss).toMatch(/\.page-anim\s*\{\s*opacity:\s*1;/);

    // 2. Global button overrides must exclude FocusSidebar controls so light/dark pills stay styled
    for (const css of [indexCss, appCss, overridesCss, darkCss, shellCss]) {
      expect(css).toContain(':not(.atlas-focus-nav-item)');
      expect(css).toContain(':not(.atlas-focus-collapse-btn)');
    }
    expect(focusCss).toContain('html body aside.atlas-focus-sidebar button.atlas-focus-nav-item');
    expect(focusCss).toContain('html body aside.atlas-focus-sidebar button.atlas-focus-collapse-btn');

    // 3. Reports uses column stacks to eliminate vertical gaps between COGS and Clôture fiscale
    expect(reportsSrc).toContain('<div className="ac-bento-grid-2">');
    expect(reportsSrc).toContain('<div className="ac-bento-stack">');

    // 4. InventoryOps uses 2-col compact form grids, single-line row actions, and scope control without redundant hero title
    expect(opsSrc).toContain('ac-ops-form-grid-2');
    expect(opsSrc).toContain('ac-ops-row-actions');
    expect(opsSrc).toContain('ac-ops-scope-control');
    expect(opsSrc).not.toContain('<h2 className="ac-dash-hello">Opérations stock</h2>');
    expect(focusCss).toContain('.ac-ops-row-actions');
    expect(focusCss).toContain('flex-wrap: nowrap !important;');
  });

  it('guards mobile login lock, dark dock pill & backdrop seam, Attendance card, select clipping, skeletons, Reports DateRangePicker, and README version history', () => {
    const loginSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Login.tsx'), 'utf8');
    const loginCss = readFileSync(path.resolve(process.cwd(), 'src/styles/login-auth.css'), 'utf8');
    const indexCss = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');
    const darkCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const attendanceSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Attendance.tsx'), 'utf8');
    const reportsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Reports.tsx'), 'utf8');
    const readmeSrc = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');

    // Mobile login: no three-dots link, overflow-x locked
    expect(loginSrc).not.toContain('>•••<');
    expect(loginSrc).not.toContain('aria-label="À propos et aide"');
    expect(loginCss).toContain('overflow-x: hidden !important');

    // Dark mode ac-dock-expand never turns into a bright solid pill, backdrop unified
    expect(indexCss).toContain(':not(.ac-dock-expand)');
    expect(overridesCss).toContain(':not(.ac-dock-expand)');
    expect(darkCss).toContain('html[data-theme="dark"] #root .ac-desktop-dock button.ac-dock-expand');
    expect(darkCss).toContain('html[data-theme="dark"] body .ac-main-column > .content');
    expect(darkCss).toContain('html[data-theme="dark"] body .ac-desktop-top-row');

    // Disabled Attendance card uses themed class instead of inline pale-yellow styles
    expect(attendanceSrc).toContain('ac-disabled-module-card');
    expect(attendanceSrc).not.toContain('#fffbeb');

    // Global select clipping protection
    expect(overridesCss).toContain('html body select:not(.ac-pick):not([multiple]):not([size])');
    expect(overridesCss).toContain('.bal-reports-field select');

    // Skeleton containers are never painted by [class*="skeleton"]
    expect(appCss).not.toContain('[class*="skeleton"]');
    expect(overridesCss).not.toContain('[class*="skeleton"]');

    // Reports uses Dashboard-style PRESET_OPTIONS + DateRangePicker
    expect(reportsSrc).toContain('DateRangePicker');
    expect(reportsSrc).toContain("'ytd'");

    // README retains its documented older release history; the current badge is generated separately.
    expect(readmeSrc).toContain('0.0.1-beta → 0.9.3-beta');
    expect(readmeSrc).toContain('### 0.9.3-beta');
    expect(readmeSrc).toContain('### 0.9.2-beta');
    expect(readmeSrc).toContain('### 0.9.1-beta');
  });

  it('prevents App.css density button selectors from blacking out FocusSidebar items and renders Journal d’audit in Dashboard Bento layout', async () => {
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');

    // Every generic .content button:not(...) rule in App.css must exclude FocusSidebar controls
    const densityButtonRules = appCss
      .split('\n')
      .filter((line) => /\.content button:not\(/.test(line) && !/\.content button\.(secondary|danger|ghost)/.test(line));
    expect(densityButtonRules.length).toBeGreaterThan(0);
    for (const rule of densityButtonRules) {
      expect(rule).toContain(':not(.atlas-focus-nav-item)');
      expect(rule).toContain(':not(.atlas-focus-collapse-btn)');
    }

    // FocusSidebar fits all Settings tabs in one panel and locks IA badge contrast
    expect(focusCss).toContain('min-height: 29px !important;');
    expect(focusCss).toMatch(/\.atlas-focus-badge--accent[\s\S]*-webkit-text-fill-color:\s*#1e293b\s*!important;/);

    // Render Settings on ?tab=audit and verify Dashboard Bento structure
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { headers: { 'Content-Type': 'application/json' } })));
    vi.spyOn(api, 'getSettings').mockResolvedValue({ data: { company_name: 'Atlas', currency: 'MAD', tax_rate: 20 } } as any);
    vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getMe').mockResolvedValue({ data: { is_owner: true, role: 'owner', username: 'admin' } } as any);
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ data: { owner: null, users: [] } } as any);
    vi.spyOn(api, 'getAdminConfig').mockResolvedValue({ data: {} } as any);
    const auditSpy = vi.spyOn(api, 'getAuditLog').mockResolvedValue({
      data: [
        {
          id: 1,
          created_at: '2026-10-20 10:00:00',
          action: 'invoice.create',
          entity: 'invoice',
          entity_id: 'FA-101',
          username: 'admin',
          role: 'owner',
          ip: '127.0.0.1',
          detail: 'Facture créée',
        },
      ],
      meta: {
        has_more: false,
        next_cursor: null,
        stats: {
          total: 12,
          unique_actors: 3,
          by_day: [{ day: '2026-10-19', n: 5 }, { day: '2026-10-20', n: 7 }],
          top_actions: [{ action: 'invoice.create', n: 7 }, { action: 'settings.update', n: 5 }],
        },
      },
    } as any);

    const apiSpy = vi.spyOn(api, 'getApiLog').mockResolvedValue({ data: [{ id: 17, created_at: '2026-10-20 10:00:00', method: 'GET', path: '/api/test', status: 200, ms: 12 }], meta: { has_more: false, stats: { total: 4, errors: 1, unique_ips: 2, avg_ms: 12, by_day: [{ day: '2026-10-20', n: 4 }], top_paths: [{ method: 'GET', path: '/api/test', n: 4 }] } } } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/settings?tab=audit'] },
          createElement(Settings),
        ),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(host.querySelector('.ac-dash-hero')).toBeNull();
    expect(host.querySelector('.ac-audit-header-panel')).toBeNull();
    expect(host.querySelectorAll('.ac-audit-range-pills')).toHaveLength(1);
    expect(host.querySelector('.ac-audit-kpis')).not.toBeNull();
    expect(host.querySelector('.ac-apilog-panel')).not.toBeNull();
    expect(host.querySelector('#journal-audit')).not.toBeNull();
    expect(host.querySelector('#journal-api')?.textContent).toContain('/api/test');
    expect(host.querySelector('.journal-quick-nav')).not.toBeNull();
    expect(host.querySelector('.ac-apilog-charts .ac-audit-bar-val')?.textContent).toBe('4');
    expect(host.querySelector('[aria-label="Type de journal"] button[aria-pressed="true"]')?.textContent).toBe('Tous les journaux');
    expect(host.querySelector('.ac-audit-charts-grid')).not.toBeNull();
    expect(host.querySelector('.ac-audit-table-panel')).not.toBeNull();
    expect(host.querySelector('.ac-dash-period-pills')).not.toBeNull();
    expect(host.textContent).toContain('Journal des appels API');
    expect(host.textContent).toContain('invoice.create');
    expect(host.textContent).toContain('FA-101');

    // Clicking an action breakdown bar toggles the action filter
    const hbarBtn = host.querySelector<HTMLButtonElement>('button.ac-audit-hbar-btn');
    expect(hbarBtn).not.toBeNull();
    await act(async () => {
      hbarBtn!.click();
    });
    expect(hbarBtn!.classList.contains('is-selected')).toBe(true);
    expect(auditSpy).toHaveBeenCalled();

    const switchButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Journal des appels API')!;
    await act(async () => { switchButton.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(host.querySelectorAll('.ac-audit-range-pills')).toHaveLength(1);
    expect(host.querySelector('.ac-audit-kpis')).toBeNull();
    expect(apiSpy).toHaveBeenCalledWith(expect.objectContaining({ range: '7d', stats: true }));
    const successful = Array.from(host.querySelectorAll<HTMLButtonElement>('.ac-apilog-status button')).find((b) => b.textContent === 'Réussis')!;
    await act(async () => { successful.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(apiSpy).toHaveBeenLastCalledWith(expect.objectContaining({ range: '7d', status: 'ok', stats: false }));
    const dayButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button.ac-seg-btn')).find((b) => b.textContent === '24 h')!;
    await act(async () => { dayButton.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(apiSpy).toHaveBeenLastCalledWith(expect.objectContaining({ range: '24h' }));

    const historyButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Historique détaillé')!;
    await act(async () => { historyButton.click(); });
    expect(host.querySelector('.ac-apilog-panel')).toBeNull();
    expect(host.querySelector('.ac-audit-kpis')).not.toBeNull();
    const allButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Tous les journaux')!;
    await act(async () => { allButton.click(); });
    expect(host.querySelector('.ac-apilog-panel')).not.toBeNull();
    expect(host.querySelector('.ac-audit-kpis')).not.toBeNull();
    expect(host.querySelector('button.ac-audit-hbar-btn.is-selected')).toBeNull();
    expect(host.querySelector('.ac-apilog-status button[aria-pressed="true"]')?.textContent).toBe('Tous');

    // Visible first pages refresh after five minutes, without waiting for a tab switch.
    const oldCount = auditSpy.mock.calls.length;
    const oldApiCount = apiSpy.mock.calls.length;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 20)); });
    expect(auditSpy.mock.calls.length).toBeGreaterThan(oldCount);
    expect(apiSpy.mock.calls.length).toBeGreaterThan(oldApiCount);

    auditSpy.mockRejectedValueOnce(new Error('D1 unavailable'));
    const filter = host.querySelector<HTMLButtonElement>('.ac-audit-action-btn')!;
    await act(async () => { filter.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(host.querySelector('.ac-audit-table-panel [role=alert]')?.textContent).toContain('Impossible de charger le journal');
    expect(host.querySelector('.ac-audit-kpis')?.textContent).not.toContain('12');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('aligns Payroll, CashShifts, Reports hero/pills, and sidebar Finance icons with Dashboard & Balance Bento UI', async () => {
    const reportsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Reports.tsx'), 'utf8');
    const payrollSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Payroll.tsx'), 'utf8');
    const shiftsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/CashShifts.tsx'), 'utf8');
    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    // 1. Reports matches Dashboard period pills & clean hero without verbose eyebrow/subtitle
    expect(reportsSrc).not.toContain('Finance &amp; conformité');
    expect(reportsSrc).not.toContain('coût des ventes COGS / FIFO');
    expect(reportsSrc).not.toContain('ac-dash-presets');
    expect(reportsSrc).not.toContain('ac-dash-preset');
    expect(reportsSrc).toContain('ac-dash-period-pills');
    expect(reportsSrc).toContain('className="ac-seg-btn"');

    // 2. Sidebar Finance & Ops icons are all distinct (no duplicate $ icon between /balance and /payroll)
    const balanceIcon = appSrc.match(/to="\/balance"[\s\S]*?<NavIcon([^>]+)\/>/)?.[1] ?? '';
    const cashShiftsIcon = appSrc.match(/to="\/cash-shifts"[\s\S]*?<NavIcon([^>]+)\/>/)?.[1] ?? '';
    const payrollIcon = appSrc.match(/to="\/payroll"[\s\S]*?<NavIcon([^>]+)\/>/)?.[1] ?? '';
    const reportsIcon = appSrc.match(/to="\/reports"[\s\S]*?<NavIcon([^>]+)\/>/)?.[1] ?? '';
    const opsIcon = appSrc.match(/to="\/inventory-ops"[\s\S]*?<NavIcon([^>]+)\/>/)?.[1] ?? '';
    const icons = [balanceIcon, cashShiftsIcon, payrollIcon, reportsIcon, opsIcon].map((s) => s.trim());
    expect(icons.every((s) => s.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(5);

    // 3. Payroll & CashShifts use Dashboard/Balance Bento UI without redundant .ac-dash-hero title header,
    //    and relocate status pills ("Aucun lot sélectionné" / "Aucune session ouverte") inside panel headers
    for (const src of [payrollSrc, shiftsSrc]) {
      expect(src).toContain('atlas-page ac-dash');
      expect(src).not.toContain('ac-dash-hero');
      expect(src).toContain('ac-metric-grid');
      expect(src).toContain('ac-panel');
      expect(src).not.toContain('className="page-head"');
    }
    expect(payrollSrc).toContain('Aucun lot sélectionné');
    expect(shiftsSrc).toContain('Aucune session ouverte');
    expect(reportsSrc).not.toContain('<h2 className="ac-dash-hello">Rapports &amp; clôture</h2>');

    // 4. Render Payroll & CashShifts and verify Bento structure + accessible dock headings + relocated status pills
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
    vi.spyOn(api, 'listPayrollRuns').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'listCashShifts').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/payroll'] }, createElement(Payroll)));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('.atlas-page.ac-dash.payroll-page')).not.toBeNull();
    expect(host.querySelector('.ac-dash-hero')).toBeNull();
    expect(host.querySelectorAll('.ac-metric-grid .ac-metric').length).toBe(4);
    expect(host.querySelector('.ac-panel-head .ac-status-pill')?.textContent).toContain('Aucun lot sélectionné');
    expect(host.querySelector('h1.sr-only')?.textContent).toBe('Paie CNSS / AMO');

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/cash-shifts'] }, createElement(CashShifts)));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('.atlas-page.ac-dash.cash-shifts-page')).not.toBeNull();
    expect(host.querySelector('.ac-dash-hero')).toBeNull();
    expect(host.querySelectorAll('.ac-metric-grid .ac-metric').length).toBe(4);
    expect(host.querySelector('.ac-panel-head .ac-status-pill')?.textContent).toContain('Aucune session ouverte');
    expect(host.querySelector('h1.sr-only')?.textContent).toBe('Clôtures de caisse (X / Z)');

    // 5. Attendance toolbar/modal/banner parity & InventoryOps single-line warehouse actions
    const attSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Attendance.tsx'), 'utf8');
    const opsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/InventoryOps.tsx'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    expect(attSrc).toContain('ac-att-toolbar');
    expect(attSrc).toContain('ac-att-modal');
    expect(attSrc).toContain('statusLabel(d.status)');
    expect(attSrc).not.toContain('<td>{d.status}</td>');
    expect(opsSrc).toContain('row-actions row-actions--inline ac-ops-row-actions');
    expect(focusCss).not.toContain('background: #fffbeb !important;');
    expect(focusCss).toContain('.ac-att-modal-metrics');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rewrites Actions page in Bento UI, swaps TopPageActions icons, stretches Balance search, locks wizard step skipping, and surfaces Qwen OCR failure inside Bill dialog', async () => {
    const actionsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Actions.tsx'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const billsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Bills.tsx'), 'utf8');
    const billsWorkerSrc = readFileSync(path.resolve(process.cwd(), 'worker/routes/billsReceipts.ts'), 'utf8');

    // 1. Actions.tsx: no "Espace partagé", Bento UI, RefreshIconButton before Produits link
    expect(actionsSrc).not.toContain('Espace partagé');
    expect(actionsSrc).not.toContain('Scans et demandes du téléphone');
    expect(actionsSrc).toContain('atlas-page ac-dash actions-page');
    expect(actionsSrc).toContain('ac-metric-grid');
    const tpaBlock = actionsSrc.match(/<TopPageActions>[\s\S]*?<\/TopPageActions>/)?.[0] || '';
    expect(tpaBlock.indexOf('<RefreshIconButton')).toBeGreaterThan(-1);
    expect(tpaBlock.indexOf('to="/products"')).toBeGreaterThan(tpaBlock.indexOf('<RefreshIconButton'));

    // Render Actions and verify Bento structure + no Espace partagé
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
    vi.spyOn(api, 'listMobileActions').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] } as any);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/actions'] }, createElement(Actions)));
    });
    expect(host.querySelector('.atlas-page.ac-dash.actions-page')).not.toBeNull();
    expect(host.querySelectorAll('.ac-metric-grid .ac-metric').length).toBe(4);
    expect(host.textContent).not.toContain('ESPACE PARTAGÉ');
    expect(host.textContent).not.toContain('Scans et demandes du téléphone');

    // 2. Balance search bar stretches freely instead of capping at 240px
    const balSearchRule = appCss.match(/\.bal-tx-search\s*\{[^}]*\}/)?.[0] || '';
    expect(balSearchRule).toContain('max-width: none');
    expect(balSearchRule).not.toContain('max-width: 240px');

    // 3. Bill OCR uses Workers AI Qwen vision (never Groq) and emits step trace + failing_step
    expect(billsWorkerSrc).toContain('@cf/qwen/qwen2.5-vl-32b-instruct');
    expect(billsWorkerSrc).toContain('failing_step');
    expect(billsWorkerSrc).not.toContain('groqChat');
    expect(billsSrc).toContain('wz-ocr-panel');
    expect(billsSrc).toContain('onBeforeJump');
    expect(billsSrc).toContain('wz-recap-card');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes Settings hero header, stacks About creator/contributors, styles cookie preference control as a pill button, and modernizes Welcome Bento UI', async () => {
    const settingsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf8');
    const aboutSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/About.tsx'), 'utf8');
    const privacySrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Privacy.tsx'), 'utf8');
    const darkCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const welcomeSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Welcome.tsx'), 'utf8');
    const welcomeLibSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/welcome.ts'), 'utf8');
    const tourSrc = readFileSync(path.resolve(process.cwd(), 'src/components/GuidedOnboarding.tsx'), 'utf8');

    // 1. Settings.tsx: no top .ac-dash-hero block while preserving sr-only h1
    expect(settingsSrc).not.toContain('className="ac-dash-hero"');
    expect(settingsSrc).toContain('<h1 className="sr-only">');

    // 2. About.tsx: Créateur & Remerciements stack vertically full-width one after another
    expect(aboutSrc).toContain('<div className="ac-bento-stack" id="about-creator">');
    expect(focusCss).toMatch(/\.ac-bento-stack\s*\{[\s\S]*width:\s*100%/);

    // 3. Privacy cookie preferences button renders as a pill button without link underline (even without data-theme)
    expect(privacySrc).toContain('className="secondary privacy-link-btn"');
    expect(overridesCss).toContain(':not(.privacy-link-btn)');
    const privacyBtnBlock = darkCss.match(/html body \.privacy-link-btn[\s\S]*?\}/)?.[0] || '';
    expect(privacyBtnBlock).toContain('html[data-theme] body .privacy-link-btn');
    expect(privacyBtnBlock).toContain('text-decoration: none !important');
    expect(privacyBtnBlock).toContain('border-radius: 999px !important');

    // 4. Welcome.tsx & WELCOME_PREVIEWS: light-only Bento screenshots, Bento chrome, explicit non-black control styles
    expect(welcomeLibSrc).not.toContain('-dark.png');
    expect(welcomeSrc).toContain('welcome-top-bar');
    expect(welcomeSrc).toContain('welcome-density-row');
    expect(welcomeSrc).toContain('welcome-summary-bento');
    expect(welcomeSrc).toContain('welcome-seg-btn');
    expect(welcomeSrc).toContain('Visite rapide des modules');
    expect(welcomeSrc).toContain('welcome-tour-note');
    expect(welcomeSrc).toContain('restartOnboarding()');
    expect(tourSrc).toContain('ac-onboard-dot');
    for (const cls of [
      '.welcome-skip-btn',
      '.welcome-density-pill',
      '.welcome-seg-btn',
    ]) {
      expect(overridesCss).toContain(`:not(${cls})`);
      expect(darkCss).toContain(`:not(${cls})`);
    }
  });

  it('records invoice deletion actor for stock movements with unknown-author fallback, enables authenticated Étiquette modal, and unifies Settings Bento + dark palette', () => {
    const ledgerSrc = readFileSync(path.resolve(process.cwd(), 'worker/lib/ledgerHelpers.ts'), 'utf8');
    const invWriteSrc = readFileSync(path.resolve(process.cwd(), 'worker/routes/invoicesWrite.ts'), 'utf8');
    const prodHistSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/ProductHistory.tsx'), 'utf8');
    const productsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Products.tsx'), 'utf8');
    const apiSrc = readFileSync(path.resolve(process.cwd(), 'src/api.ts'), 'utf8');
    const settingsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');

    // 1. Movement deletion actor & unknown-author fallback
    expect(ledgerSrc).toContain('cascadeDeleteInvoice(\n  db: D1Database,\n  invoiceId: string | number,\n  opts?: { createdBy?: string }');
    expect(ledgerSrc).toContain("createdBy: opts?.createdBy || undefined");
    expect(invWriteSrc).toContain('cascadeDeleteInvoice(c.env.DB, id, { createdBy: gate.username || undefined })');
    expect(prodHistSrc).not.toContain('non renseigné');
    expect(prodHistSrc).toContain("actor(m.created_by, 'Auteur inconnu')");

    // 2. Étiquette uses authenticated ProductLabelModal (not unauthenticated window.open)
    expect(apiSrc).toContain('fetchLabelSvg:');
    expect(productsSrc).toContain('ProductLabelModal');
    expect(productsSrc).not.toContain('window.open(api.labelUrl(');
    expect(prodHistSrc).toContain('ProductLabelModal');

    // 3. Settings Bento & unified Dimmed Charcoal dark palette
    expect(settingsSrc).not.toContain("var(--stone)");
    expect(settingsSrc).toContain('ac-settings-panel-head');
    expect(focusCss).not.toMatch(/#171a24|#13151d|#1f2330|#1f2433/i);
    expect(overridesCss).not.toContain('html .settings-main button:not(.danger)');
  });

  it('scopes Welcome/FeatureTour light rules out of dark mode and uses responsive desktop-table shimmer skeletons across Settings, About, and WhatsNew', () => {
    const darkCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const skeletonSrc = readFileSync(path.resolve(process.cwd(), 'src/components/PageSkeleton.tsx'), 'utf8');
    const settingsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf8');
    const aboutSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/About.tsx'), 'utf8');
    const whatsNewSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/WhatsNew.tsx'), 'utf8');
    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    // No unscoped html body welcome/feature-tour button color overrides leaking into dark mode
    expect(darkCss).not.toMatch(/^html body (?:\.welcome-(?:skip-btn|density-pill|seg-btn|tour-trigger)|\.ac-feature-tour-)/m);
    expect(darkCss).toContain('html:not([data-theme="dark"]) body .welcome-density-pill:hover:not(.is-active)');
    expect(darkCss).toContain('html[data-theme="dark"] body .welcome-density-pill:hover:not(.is-active)');

    // Responsive desktop-table & Bento shimmer skeletons
    expect(skeletonSrc).toContain('DesktopTableSkeleton');
    expect(skeletonSrc).toContain("variant === 'settings'");
    expect(skeletonSrc).toContain("variant === 'about'");
    expect(skeletonSrc).toContain("variant === 'changelog'");
    expect(focusCss).toContain('.ac-skeleton-table-wrap');
    expect(focusCss).toContain('.ac-skeleton-thead');
    expect(settingsSrc).toContain('<PageSkeleton variant="settings" />');
    expect(settingsSrc).toContain('<DesktopTableSkeleton rows={3} cols={5} />');
    expect(settingsSrc).not.toContain('Chargement du journal…');
    expect(aboutSrc).toContain('ghLoading');
    expect(aboutSrc).toContain('contribLoading');
    expect(whatsNewSrc).toContain('contribLoading');
    expect(appSrc).toContain('<PageSkeleton variant="about" />');
    expect(appSrc).toContain('<PageSkeleton variant="changelog" />');
  });

  it('moves Attendance disabled-module CTAs to top, removes Balance duplicate hero title, spans full-width page-faithful skeletons, and shimmers desktop Atlas Agent', () => {
    const attSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Attendance.tsx'), 'utf8');
    const balSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Balance.tsx'), 'utf8');
    const skeletonSrc = readFileSync(path.resolve(process.cwd(), 'src/components/PageSkeleton.tsx'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const agentSrc = readFileSync(path.resolve(process.cwd(), 'src/components/AtlasAgent.tsx'), 'utf8');
    const billsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Bills.tsx'), 'utf8');
    const clientsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Clients.tsx'), 'utf8');
    const productsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Products.tsx'), 'utf8');
    const actionsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Actions.tsx'), 'utf8');

    // 1. Attendance disabled module puts Activer maintenant + Ouvrir les paramètres Présence in TopPageActions
    const disabledBlock = attSrc.match(/if\s*\(!enabled\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
    expect(disabledBlock).toContain('<TopPageActions>');
    expect(disabledBlock).toContain('Activer maintenant');
    expect(disabledBlock).toContain('Ouvrir les paramètres Présence');
    expect(disabledBlock).not.toContain('ac-disabled-module-actions');
    expect(attSrc).toContain('<PageSkeleton variant="attendance" />');
    expect(attSrc).toContain('<DesktopTableSkeleton rows={5} cols={6} />');

    // 2. Balance removes duplicate Trésorerie / Solde & mouvements visible hero text while keeping bal-reports-trigger aligned right
    expect(balSrc).not.toContain('Pilotage temps réel de la caisse');
    expect(balSrc).not.toContain('ac-dash-hero-text');
    expect(balSrc).toContain('bal-reports-trigger');
    expect(balSrc).toContain("width: '100%', justifyContent: 'flex-end'");
    expect(balSrc).toContain("marginLeft: 'auto'");
    expect(balSrc).toContain('<PageSkeleton variant="balance" />');

    // 3. Full-width, page-faithful skeleton variants (no identical 4-KPI list skeleton everywhere)
    expect(focusCss).toMatch(/\.page-skeleton\s*\{[^}]*width:\s*100%/);
    expect(focusCss).toMatch(/\.page-skeleton\s*\{[^}]*max-width:\s*none\s*!important/);
    expect(appCss).toMatch(/\.page-skeleton\s*\{[^}]*max-width:\s*none/);
    for (const v of ['products', 'kpis3-list', 'kpis4-list', 'table-only', 'balance', 'reports', 'inventory-ops', 'payroll', 'cash-shifts', 'attendance', 'actions', 'landing', 'welcome']) {
      expect(skeletonSrc).toContain(`variant === '${v}'`);
    }
    expect(productsSrc).toContain('<PageSkeleton variant="products" />');
    expect(clientsSrc).toContain('<PageSkeleton variant="kpis3-list" />');
    expect(billsSrc).toContain('<PageSkeleton variant="table-only" />');
    expect(actionsSrc).toContain('<ActionListRowsSkeleton rows={5} />');
    expect(actionsSrc).not.toContain('Chargement des actions…');

    // 4. App.tsx maps routes to matching skeletons and removes raw Chargement… Suspense text
    expect(appSrc).toContain('skeletonVariantForPath(location.pathname)');
    expect(appSrc).not.toContain('>Chargement…<');

    // 5. Desktop Atlas Agent uses shimmer skeleton for thread loading, busy reply, and lazy fallback
    expect(agentSrc).toContain('AtlasAgentShimmerBody');
    expect(agentSrc).toContain('atlas-agent-shimmer-reply');
    expect(agentSrc).not.toContain('Chargement de la conversation…');
    expect(appSrc).toContain('AtlasAgentDesktopFallback');
  });
});
