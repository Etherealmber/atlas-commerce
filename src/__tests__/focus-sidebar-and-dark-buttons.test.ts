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

  it('removes horizontal icon-row tabs from PublicSettingsTopbar and App.tsx focus header', async () => {
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
    expect(host.querySelector('.settings-topbar-searchtab')).not.toBeNull();

    const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).not.toContain('SETTINGS_TOP_TABS');
    expect(appSrc).not.toContain('settings-topbar');
    expect(appSrc).toContain('<FocusSidebar');
    expect(appSrc).toContain('ac-desktop-dock');
  });

  it('locks dark-mode button contrast on hover/focus/active and segmented pills without purple', () => {
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const focusCss = readFileSync(path.resolve(process.cwd(), 'src/styles/focus-sidebar.css'), 'utf8');
    expect(focusCss).not.toMatch(/#4f46e5|#6366f1|#4338ca/i);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+\.content\s+\.ac-dash-period-pills\s+button\.ac-seg-btn\[aria-pressed="true"\][\s\S]*-webkit-text-fill-color:\s*#0f172a\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+aside\.atlas-focus-sidebar\s+button\.atlas-focus-nav-item\.is-active[\s\S]*background:\s*#f4f4f5\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+body\s+\.content\s+button:hover:not\(:disabled\):not\(\.secondary\):not\(\.danger\):not\(\.ghost\):not\(\.ac-seg-btn\)[\s\S]*-webkit-text-fill-color:\s*#18181b\s*!important;/);
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
    expect(shellCss).toContain('display: inline-flex !important;');
    expect(shellCss).toContain('white-space: nowrap;');
    expect(overridesCss).toContain('white-space: nowrap !important;');
    expect(appCss).toContain('.atlas-dl-teaser-link');

    const cleanedFiles = [
      'src/styles/theme.css',
      'src/styles/login-auth.css',
      'src/components/SaveFeedback.tsx',
      'src/components/mailbox/ComposeEmailCard.tsx',
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

    expect(formatCompactNum(0, 'MAD')).toBe('0 MAD');
    expect(formatCompactNum(12500, 'MAD', 100_000)).toMatch(/12[\s\u202f\u00a0]?500 MAD/);
    expect(formatCompactNum(12500, 'MAD', 10_000)).toBe('12.5k MAD');
    expect(formatCompactNum(150_000, 'MAD')).toBe('150k MAD');
    expect(formatCompactNum(2_500_000, 'MAD')).toBe('2.5M MAD');
    expect(formatCompactNum(1_200_000_000, 'MAD')).toBe('1.2B MAD');

    expect(formatAxisVal(1_500_000_000, 2_000_000_000)).toBe('1.5B');
    expect(formatAxisVal(2_000_000, 4_000_000)).toBe('2M');
    expect(formatAxisVal(45_000, 50_000)).toBe('45k');
  });
});
