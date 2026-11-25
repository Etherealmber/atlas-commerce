// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailBackTarget } from '../lib/detailBack';
import { installUnsavedGuards, isDiscardConfirmOpen } from '../lib/unsavedGuard';
import { AtlasLockup } from '../components/brand/AtlasLockup';
import { BRAND_INTRO_MS } from '../components/brand/useBrandIntro';

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('detail pages: back pill target', () => {
  it('maps product history, invoice and quick-sale details to their list', () => {
    expect(detailBackTarget('/products/12/historique')).toEqual({ to: '/products', label: 'Produits' });
    expect(detailBackTarget('/invoices/FA-0007')).toEqual({ to: '/invoices', label: 'Factures' });
    expect(detailBackTarget('/quick-sale/44/')).toEqual({ to: '/quick-sale', label: 'Ventes rapides' });
  });

  it('shows nothing on list pages and focus pages', () => {
    for (const p of ['/products', '/invoices', '/quick-sale', '/employees', '/settings', '/dashboard', '/products/12']) {
      expect(detailBackTarget(p)).toBeNull();
    }
  });

  it('only renders the dashboard pill on focus routes, and the back pill elsewhere', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/\{isFocusRoute && \(\s*<Link className=\{`ac-home-pill\$\{actionsCompact \? '' : ' is-expanded'\}`\}/);
    expect(app).toMatch(/!isFocusRoute && detailBack && \(/);
    expect(app).toContain('ac-back-pill');
  });
});

describe('wizard guard: « Abandonner la saisie ? »', () => {
  let rects: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    installUnsavedGuards();
    document.body.innerHTML = '';
    // happy-dom has no layout: report every element as rendered.
    rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  });
  afterEach(() => {
    document.querySelector<HTMLElement>('[data-guard-act="stay"]')?.click();
    document.body.innerHTML = '';
    rects.mockRestore();
  });

  const wizard = (extra = '') => `
    <div class="modal-overlay" id="ov">
      <div class="modal" role="dialog">
        <ol><li aria-current="step"><button class="step-wizard__step-btn">1</button></li><li><button class="step-wizard__step-btn">2</button></li></ol>
        ${extra}
        <button type="button" id="cancel">Annuler</button>
      </div>
    </div>`;

  it('asks before « Annuler » closes a wizard, and replays it on « Abandonner »', () => {
    document.body.innerHTML = wizard();
    const onCancel = vi.fn();
    document.getElementById('cancel')!.addEventListener('click', onCancel);
    document.getElementById('cancel')!.click();
    expect(onCancel).not.toHaveBeenCalled();
    expect(isDiscardConfirmOpen()).toBe(true);
    document.querySelector<HTMLElement>('[data-guard-act="leave"]')!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(isDiscardConfirmOpen()).toBe(false);
  });

  it('asks before a backdrop click closes a wizard', () => {
    document.body.innerHTML = wizard();
    const onOverlay = vi.fn();
    const ov = document.getElementById('ov')!;
    ov.addEventListener('click', onOverlay);
    ov.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onOverlay).not.toHaveBeenCalled();
    expect(isDiscardConfirmOpen()).toBe(true);
    document.querySelector<HTMLElement>('[data-guard-act="stay"]')!.click();
    expect(isDiscardConfirmOpen()).toBe(false);
    expect(document.querySelector('.modal')).not.toBeNull();
  });

  it('never treats a timed-delete « Annuler » (undo) as cancelling the dialog', () => {
    document.body.innerHTML = wizard('<div class="ac-timed-delete"><button type="button" id="undo">Annuler</button></div>');
    const onUndo = vi.fn();
    document.getElementById('undo')!.addEventListener('click', onUndo);
    document.getElementById('undo')!.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(isDiscardConfirmOpen()).toBe(false);
  });

  it('locked FormWizard chips stay clickable (aria-disabled) so every attempt bounces', () => {
    const fw = read('src/components/ui/FormWizard.tsx');
    expect(fw).toContain('aria-disabled');
    expect(fw).toContain('bounceDialogOf(');
  });
});

describe('Atlas lockup', () => {
  it('renders the sunburst with its beam and the wordmark, sized by CSS unless a height is given', () => {
    const html = renderToStaticMarkup(createElement(AtlasLockup, { play: 'none' }));
    expect(html).toContain('atlas-mark-beam');
    expect(html).toContain('atlas-lockup-word');
    expect(html).not.toContain('--lk-h');
    const sized = renderToStaticMarkup(createElement(AtlasLockup, { height: 19, play: 'none' }));
    expect(sized).toContain('--lk-h:19px');
  });

  it('mark-only hero marks are decorative and keep the beam', () => {
    const html = renderToStaticMarkup(createElement(AtlasLockup, { markOnly: true, idle: true, label: '', play: 'none' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('is-idle');
    expect(html).toContain('atlas-mark-beam');
    expect(html).not.toContain('atlas-lockup-word');
  });

  it('keeps the inner beam at full length in the collapsed sidebar, with a visible intro', () => {
    const css = stripComments(read('src/components/brand/atlas-brand.css'));
    expect(css).not.toMatch(/scaleX\(0\.376\)/);
    for (const k of ['atlas-draw', 'atlas-word-clip', 'atlas-letter', 'atlas-wave']) {
      expect(css).toContain(`@keyframes ${k}`);
    }
    expect(css).toContain('.atlas-intro-play');
    expect(BRAND_INTRO_MS).toBeGreaterThanOrEqual(1000);
  });

  it('is used on the homepage, Support, Bureau and Android pages and in the public nav', () => {
    for (const p of ['src/pages/Home.tsx', 'src/pages/Support.tsx', 'src/pages/Desktop.tsx', 'src/pages/Download.tsx', 'src/components/PublicChrome.tsx']) {
      expect(read(p)).toContain('<AtlasLockup');
    }
  });
});
