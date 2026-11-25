// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { bounce, installUnsavedGuards, isPageGuarded, setPageGuard } from '../lib/unsavedGuard';
import DatePicker, { MonthPicker } from '../components/DatePicker';

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('unsaved-changes guard', () => {
  beforeEach(() => {
    installUnsavedGuards();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    setPageGuard(null);
    document.body.innerHTML = '';
  });

  it('marks the dialog dirty when a field inside it is edited', () => {
    document.body.innerHTML = '<div class="modal"><input id="f" /></div><input id="outside" />';
    const modal = document.querySelector('.modal')!;
    document.getElementById('outside')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(modal.hasAttribute('data-ac-dirty')).toBe(false);
    document.getElementById('f')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(modal.hasAttribute('data-ac-dirty')).toBe(true);
  });

  it('ignores search boxes and [data-guard-ignore] fields', () => {
    document.body.innerHTML = '<div class="modal"><input type="search" id="s" /><div data-guard-ignore><input id="i" /></div></div>';
    document.getElementById('s')!.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('i')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.modal')!.hasAttribute('data-ac-dirty')).toBe(false);
  });

  it('blocks links and sidebar navigation while a page guard is active', () => {
    document.body.innerHTML = `
      <aside><button id="nav">Facturation</button><button id="toggle" aria-expanded="false">Replier</button></aside>
      <a id="away" href="/dashboard">Tableau de bord</a>
      <div data-unsaved-allow><a id="allowed" href="/dashboard">ok</a></div>`;
    const onBlocked = vi.fn();
    setPageGuard(onBlocked);
    expect(isPageGuarded()).toBe(true);

    const away = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('away')!.dispatchEvent(away);
    expect(away.defaultPrevented).toBe(true);

    const nav = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('nav')!.dispatchEvent(nav);
    expect(nav.defaultPrevented).toBe(true);
    expect(onBlocked).toHaveBeenCalledTimes(2);

    // Toggles and explicitly allowed zones pass through.
    const toggle = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('toggle')!.dispatchEvent(toggle);
    expect(toggle.defaultPrevented).toBe(false);
    const allowed = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('allowed')!.addEventListener('click', (e) => e.preventDefault()); // keep happy-dom on the page
    document.getElementById('allowed')!.dispatchEvent(allowed);
    expect(onBlocked).toHaveBeenCalledTimes(2);

    setPageGuard(null);
    const free = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('nav')!.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });

  it('bounce() is safe on missing elements', () => {
    expect(() => bounce(null)).not.toThrow();
    expect(() => bounce(document.createElement('div'))).not.toThrow();
  });
});

describe('date pickers', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    installUnsavedGuards();
    host = document.createElement('div');
    host.className = 'modal';
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  it('renders a field-style trigger, month/year grids and marks the dialog dirty on pick', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(DatePicker, { value: '2026-11-25', onChange })));
    const trigger = host.querySelector<HTMLButtonElement>('.ac-dp-trigger')!;
    expect(trigger.classList.contains('ac-pick')).toBe(true);
    expect(trigger.textContent).toContain('25 nov. 2026');
    await act(async () => trigger.click());
    const pop = document.querySelector('.ac-dp-pop')!;
    expect(pop).not.toBeNull();
    expect(pop.querySelector('select')).toBeNull(); // no native selects any more
    expect(pop.querySelectorAll('.ac-dp-day')).toHaveLength(42);
    expect(pop.querySelector('.ac-dp-day.is-selected')?.textContent).toBe('25');

    await act(async () => pop.querySelector<HTMLButtonElement>('.ac-dp-title')!.click());
    expect(document.querySelectorAll('.ac-dp-pop .ac-dp-month')).toHaveLength(12);
    await act(async () => document.querySelector<HTMLButtonElement>('.ac-dp-pop .ac-dp-month[aria-label="Mars 2026"]')!.click());
    const day12 = [...document.querySelectorAll<HTMLButtonElement>('.ac-dp-pop .ac-dp-day:not(.is-outside)')].find((d) => d.textContent === '12')!;
    await act(async () => day12.click());
    expect(onChange).toHaveBeenCalledWith('2026-03-12');
    expect(document.querySelector('.ac-dp-pop')).toBeNull();
    expect(host.hasAttribute('data-ac-dirty')).toBe(true);
  });

  it('MonthPicker returns YYYY-MM', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(MonthPicker, { value: '2026-11', onChange })));
    expect(host.querySelector('.ac-dp-trigger')!.textContent).toContain('Novembre 2026');
    await act(async () => host.querySelector<HTMLButtonElement>('.ac-dp-trigger')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('.ac-dp-pop .ac-dp-month[aria-label="Février 2026"]')!.click());
    expect(onChange).toHaveBeenCalledWith('2026-02');
  });
});

describe('static wiring', () => {
  it('Settings saves from the top-right actions and no longer renders the bottom bar', () => {
    const settings = read('src/pages/Settings.tsx');
    expect(settings).toContain('settings-page-actions');
    expect(settings).toContain('settings-top-save');
    expect(settings).toContain('setPageGuard(');
    expect(settings).not.toContain('settings-tab-save-bar');
    expect(settings).toContain('Enregistrez ou annulez avant de quitter');
  });

  it('web pages use the shared pickers instead of native date / month inputs', () => {
    for (const page of ['Attendance', 'Balance', 'Payroll', 'InvoiceDetail', 'QuickSaleDetail', 'Scan', 'Settings']) {
      expect(read(`src/pages/${page}.tsx`)).not.toMatch(/type=["'](date|month)["']/);
    }
  });

  it('old atlas-dp / atlas-tp picker styles are gone and the new layer is boosted', () => {
    for (const f of ['src/App.css', 'src/index.css', 'src/styles/dark-force.css', 'src/styles/overrides-final.css', 'src/styles/shell.css']) {
      expect(stripComments(read(f))).not.toMatch(/atlas-(dp|tp)/);
    }
    const fc = stripComments(read('src/styles/form-controls.css'));
    expect(fc).toMatch(/\.ac-dp \.ac-dp-trigger:not\(#pk-g\):not\(#pk-h\):not\(#pk-i\):not\(#pk-j\) \{[^}]*height: 50px !important/);
    expect(fc).toMatch(/\.ac-dp-day\.is-selected[^{]*\{[^}]*background: var\(--pk-sel-bg\) !important/);
    expect(read('src/main.tsx').indexOf("form-controls.css")).toBeLessThan(read('src/main.tsx').indexOf('dark-force.css'));
  });

  it('wizard grids also apply to the 9-step employee sheet', () => {
    expect(read('src/components/ui/form-wizard.css')).toContain(':is(.step-wizard, .employee-wizard) .wz-step > .grid.grid-2');
  });
});

describe('mobile web gets the same pickers, wizard steps and sheet footers', () => {
  it('no mobile screen uses a native date / month input', () => {
    for (const f of readdirSync('src/mobile').filter((n) => n.endsWith('.tsx'))) {
      expect(read(`src/mobile/${f}`), f).not.toMatch(/type=["'](date|month)["']/);
    }
    expect(read('src/mobile/PhoneBalance.tsx')).toContain('<DatePicker value={date} onChange={setDate} />');
    expect(read('src/mobile/PhoneReportBundle.tsx')).toMatch(/<DatePicker max=\{today\} value=\{from\}/);
  });

  it('pickers stack above phone sheets', () => {
    const css = stripComments(read('src/styles/form-controls.css'));
    expect(css).toMatch(/html\.phone-shell body \.ac-dp-pop[^{]*\{ z-index: 2147483646 !important; \}/);
    expect(css).toMatch(/html\.phone-shell body \.ac-dp-scrim[^{]*\{ z-index: 2147483645 !important; \}/);
  });

  it('the phone product sheet is a stepped wizard that bounces on invalid steps', () => {
    const src = read('src/mobile/PhoneProductCreate.tsx');
    expect(src).toContain("const STEPS = ['Produit', 'Stock', direct ? 'Prix' : 'Photo'];");
    expect(src).toContain('bounceDialogOf(formRef.current)');
    expect(src.match(/<fieldset data-step="\d"/g)).toHaveLength(3);
  });

  it('phone dialogs bounce when an error message appears', () => {
    const src = read('src/mobile/PhoneDialog.tsx');
    expect(src).toContain("import { bounce } from '../lib/unsavedGuard';");
    expect(src).toMatch(/if \(text && text !== lastAlert\) bounce\(modal\)/);
  });

  it('sheet footers are one row of 44px pills with a filled primary and a red danger', () => {
    const css = stripComments(read('src/mobile/phone.css'));
    expect(css).toMatch(/\.pb-form-actions\) > button:not\(#ph-ft-g\)[^{]*\{[^}]*height: 44px !important;[^}]*border-radius: 999px !important;/);
    expect(css).toMatch(/button\.is-danger:not\(#ph-ft-g\)[^{]*\{[^}]*background: #dc2626 !important;/);
    expect(read('src/mobile/PhoneProfile.tsx')).toContain('className="is-danger"');
  });
});
