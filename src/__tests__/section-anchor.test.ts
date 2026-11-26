// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { openSection } from '../lib/sectionAnchor';

afterEach(() => { document.body.innerHTML = ''; window.location.hash = ''; });
describe('public section links', () => {
  it.each(['fr', 'ar', 'en'])('scrolls and focuses the target in %s, even when already at the same hash', lang => {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const target = document.createElement('section'); target.id = 'demande'; target.tabIndex = -1;
    target.scrollIntoView = vi.fn(); document.body.appendChild(target);
    window.location.hash = '#demande';
    const preventDefault = vi.fn();
    openSection({ button: 0, preventDefault } as any, 'demande');
    expect(preventDefault).toHaveBeenCalledOnce(); expect(target.scrollIntoView).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(target);
  });
  it('does not intercept modified clicks or missing targets', () => {
    const preventDefault = vi.fn();
    openSection({ button: 0, ctrlKey: true, preventDefault } as any, 'demande');
    openSection({ button: 0, preventDefault } as any, 'missing');
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
