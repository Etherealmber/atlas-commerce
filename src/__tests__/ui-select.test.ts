// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Select, { collectOptions } from '../components/ui/Select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('<Select> (custom listbox over a native select)', () => {
  it('collects options, groups and fragments', () => {
    const opts = collectOptions([
      h('option', { key: 'a', value: '' }, 'Toutes catégories'),
      h('optgroup', { key: 'g', label: 'Boissons' }, h('option', { value: 'eau' }, 'Eau'), h('option', { value: 'jus', disabled: true }, 'Jus')),
    ]);
    expect(opts).toEqual([
      { value: '', label: 'Toutes catégories', disabled: false, group: undefined },
      { value: 'eau', label: 'Eau', disabled: false, group: 'Boissons' },
      { value: 'jus', label: 'Jus', disabled: true, group: 'Boissons' },
    ]);
  });

  it('opens our listbox instead of the OS one and fires onChange with the picked value', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn((e: { target: { value: string } }) => e.target.value);
    const root = createRoot(host);
    await act(async () => {
      root.render(h(Select, { 'aria-label': 'Catégorie', defaultValue: '', onChange },
        h('option', { value: '' }, 'Toutes catégories'),
        h('option', { value: 'eau' }, 'Eau minérale'),
      ));
    });
    const sel = host.querySelector('select')!;
    expect(sel).toBeTruthy();
    expect(sel.className).toContain('ac-sel');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { sel.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true); // OS dropdown suppressed
    const opts = document.querySelectorAll('.ac-select-pop [role="option"]');
    expect(opts.length).toBe(2);
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    await act(async () => { (opts[1] as HTMLElement).click(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0].value).toBe('eau');
    expect(document.querySelector('.ac-select-pop')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it('every page uses <Select> — no raw <select> left in TSX', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;
        const p = join(dir, name);
        if (entry.isDirectory()) { if (name !== '__tests__') walk(p); continue; }
        if (!p.endsWith('.tsx') || p.endsWith(join('ui', 'Select.tsx'))) continue;
        if (/<select[\s>]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(join(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
});
