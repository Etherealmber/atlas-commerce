// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import FocusSidebar from '../components/FocusSidebar';
import { PublicSettingsTopbar } from '../components/PublicChrome';

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
    expect(appSrc).toContain('<FocusSidebar');
  });

  it('locks dark-mode button contrast on hover/focus/active and segmented pills', () => {
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+\.content\s+\.ac-dash-period-pills\s+button\.ac-seg-btn\[aria-pressed="true"\][\s\S]*-webkit-text-fill-color:\s*#ffffff\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+#root\s+aside\.atlas-focus-sidebar\s+button\.atlas-focus-nav-item\.is-active[\s\S]*background:\s*#4f46e5\s*!important;/);
    expect(darkForce).toMatch(/html\[data-theme="dark"\]\s+body\s+\.content\s+button:hover:not\(:disabled\):not\(\.secondary\):not\(\.danger\):not\(\.ghost\):not\(\.ac-seg-btn\)[\s\S]*-webkit-text-fill-color:\s*#18181b\s*!important;/);
  });
});
