// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Balance from '../pages/Balance';
import { AppDialogsProvider } from '../components/AppDialogs';
import TopbarUserMenu from '../components/shell/TopbarUserMenu';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('UI guards: Rapports modal close button & floating pill stability', () => {
  it('Balance Rapports modal renders .modal-x directly inside .bal-reports-modal without .secondary and with visible SVG', async () => {
    vi.spyOn(api, 'getExpenses').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: {} } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AppDialogsProvider, null, createElement(Balance)),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const trigger = host.querySelector<HTMLButtonElement>('button.bal-reports-trigger');
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger!.click();
    });

    const modal = document.body.querySelector<HTMLElement>('.bal-reports-modal');
    expect(modal).toBeTruthy();
    const closeButtons = modal!.querySelectorAll('button.modal-x');
    expect(closeButtons).toHaveLength(1);
    const closeBtn = closeButtons[0] as HTMLButtonElement;
    expect(closeBtn.parentElement).toBe(modal);
    expect(closeBtn.classList.contains('secondary')).toBe(false);
    expect(closeBtn.getAttribute('aria-label')).toBe('Fermer');
    expect(closeBtn.querySelector('svg')).toBeTruthy();

    await act(async () => {
      closeBtn.click();
    });
    expect(document.body.querySelector('.bal-reports-modal')).toBeNull();
  });

  it('floating pill CSS and ResizeObserver do not introduce container hover-scale flicker', () => {
    const shellCss = readFileSync(path.resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const tpa = readFileSync(path.resolve(process.cwd(), 'src/components/TopPageActions.tsx'), 'utf8');

    expect(shellCss).not.toMatch(/\.desktop-catalog-actions-slot[^{]*>\s*\.top-page-actions\s*\{[^}]*transform\s*:\s*scale\s*\(/);
    expect(darkForce).toMatch(/button\.modal-x[\s\S]*padding:\s*0\s*!important/);
    expect(darkForce).toMatch(/button\.modal-x\s+svg[\s\S]*stroke:\s*currentColor\s*!important/);
    expect(tpa).not.toMatch(/observer\??\.observe\(\s*(?:item|actions|dock)\s*\)/);
  });

  it('topbar and avatar buttons stay circular and light-mode clean across stylesheets', () => {
    const overridesCss = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');
    const shellCss = readFileSync(path.resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const phoneCss = readFileSync(path.resolve(process.cwd(), 'src/mobile/phone.css'), 'utf8');

    expect(overridesCss).not.toMatch(/html\s+body\s+\.ac-topbar-user-btn\s*,/);
    expect(overridesCss).not.toMatch(/html\s+body\s+\.ac-topbar-notif\s*,/);
    expect(shellCss).toMatch(/\.ac-topbar-user-btn\s*\{[^}]*width:\s*40px\s*!important[^}]*min-width:\s*40px\s*!important/s);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.ac-topbar-user-btn\s*\{[^}]*width:\s*40px\s*!important[^}]*flex:\s*0\s+0\s+40px\s*!important/s);
    expect(darkForce).toMatch(/html:not\(\[data-theme="dark"\]\)\s+body\s+\.ac-topbar-user-btn\s*\{[^}]*background:\s*transparent\s*!important/s);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.ac-topbar-user-btn\s+\.ac-topbar-avatar\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1\s*!important/s);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.settings-topbar-avatar--ini\s*\{[^}]*display:\s*inline-flex\s*!important/s);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.sidebar-avatar[\s\S]*aspect-ratio:\s*1\s*\/\s*1\s*!important/);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.pn-chip-avatar[\s\S]*aspect-ratio:\s*1\s*\/\s*1\s*!important/);
    expect(darkForce).toMatch(/button:not\(\.wz-chip\):not\(\.atlas-typeahead-item\):not\(\.phone-avatar\)/);
    expect(phoneCss).toMatch(/\.ph-profile-avatar\s*\{[^}]*width:\s*64px;[^}]*aspect-ratio:\s*1\s*\/\s*1;/);
  });

  it('TopbarUserMenu renders circular trigger with initials fallback', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(TopbarUserMenu, {
            displayName: 'Oualid Elh',
            roleLabel: 'Gérant',
            initials: 'OE',
            onLogout: () => {},
          }),
        ),
      );
    });

    const btn = host.querySelector<HTMLButtonElement>('.ac-topbar-user-wrap > button.ac-topbar-user-btn');
    expect(btn).toBeTruthy();
    const avatar = btn!.querySelector('.ac-topbar-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar!.textContent).toBe('OE');
  });

  it('TopbarUserMenu dropdown matches floating deck styling without .secondary bleed and highlights logout as danger', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(TopbarUserMenu, {
            displayName: 'MY Marbre',
            roleLabel: 'Propriétaire',
            initials: 'MM',
            onLogout: () => {},
          }),
        ),
      );
    });

    const btn = host.querySelector<HTMLButtonElement>('button.ac-topbar-user-btn')!;
    await act(async () => {
      btn.click();
    });

    const dropdown = document.body.querySelector<HTMLElement>('.ac-user-dropdown');
    expect(dropdown).toBeTruthy();
    expect(dropdown!.querySelector('.ac-user-dropdown-identity')).toBeTruthy();
    expect(dropdown!.querySelector('.ac-user-dropdown-name')?.textContent).toBe('MY Marbre');
    expect(dropdown!.querySelector('.ac-user-dropdown-role')?.textContent).toBe('Propriétaire');

    const items = Array.from(dropdown!.querySelectorAll<HTMLButtonElement>('button.ac-user-dropdown-item'));
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.classList.contains('secondary')).toBe(false);
      expect(item.querySelector('.ac-user-dropdown-ico')).toBeTruthy();
    }

    const logoutBtn = dropdown!.querySelector<HTMLButtonElement>('button.ac-user-dropdown-logout');
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn!.classList.contains('ac-user-dropdown-item--danger')).toBe(true);
    expect(dropdown!.querySelectorAll('.ac-user-dropdown-sep').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['/whats-new', 'Nouveautés'], ['/about', 'À propos'], ['/settings?tab=audit', 'Paramètres'], ['/dashboard', 'Tableau de bord'],
  ])('hides only the current destination from the user menu on %s', async (route, current) => {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [route] }, createElement(TopbarUserMenu, {
        displayName: 'Atlas', roleLabel: 'Owner', initials: 'AT', onLogout: () => {}, showDashboardLink: true,
      })));
    });
    await act(async () => { host.querySelector<HTMLButtonElement>('.ac-topbar-user-btn')!.click(); });
    const names = Array.from(document.body.querySelectorAll('.ac-user-dropdown-item b')).map(el => el.textContent);
    expect(names).not.toContain(current);
    expect(names).toContain('Langue');
    for (const other of ['Nouveautés', 'À propos', 'Paramètres', 'Tableau de bord'].filter(item => item !== current)) expect(names).toContain(other);
  });

  it('scopes desktop hover micro-animations away from mobile shell and keeps mobile theme transitions unified', () => {
    const darkForceCss = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const phoneCss = readFileSync(path.resolve(process.cwd(), 'src/mobile/phone.css'), 'utf8');

    expect(darkForceCss).toContain('@media (min-width: 901px) and (hover: hover) and (pointer: fine)');
    expect(darkForceCss).toContain('html:not(.phone-shell) body .content button');
    expect(darkForceCss).not.toContain('circle(78% at 50% 50%)');
    expect(phoneCss).toContain('html.phone-theme-transition .phone-root *');
  });
});
