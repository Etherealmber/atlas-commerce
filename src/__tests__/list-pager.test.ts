// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListPager, pagerSlots } from '../components/ui/ListPager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (props: Parameters<typeof ListPager>[0]) => act(() => root.render(createElement(ListPager, props)));
const nums = () => [...host.querySelectorAll('.ac-pager-pages li')].map((li) => li.textContent);
const btn = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

describe('pagerSlots', () => {
  it('lists every page when they fit', () => {
    expect(pagerSlots(1, 1)).toEqual([1]);
    expect(pagerSlots(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('keeps first/last and a window around the current page', () => {
    expect(pagerSlots(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20]);
    expect(pagerSlots(10, 20)).toEqual([1, 'gap-start', 9, 10, 11, 'gap-end', 20]);
    expect(pagerSlots(20, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20]);
    expect(pagerSlots(5, 20, 5)).toEqual([1, 'gap-start', 5, 'gap-end', 20]);
  });
  it('never exceeds the slot budget and always includes the current page', () => {
    for (let tp = 1; tp <= 40; tp += 1) {
      for (let cur = 1; cur <= tp; cur += 1) {
        const s = pagerSlots(cur, tp);
        expect(s.length).toBeLessThanOrEqual(7);
        expect(s).toContain(cur);
        expect(s[0]).toBe(1);
        expect(s[s.length - 1]).toBe(tp);
      }
    }
  });
});

describe('ListPager', () => {
  it('renders numbered pages and moves with arrows, numbers and the keyboard', () => {
    const onPageChange = vi.fn();
    render({ page: 0, total: 140, pageSize: 20, onPageChange });
    expect(nums()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('1');
    expect(btn('Page précédente').disabled).toBe(true);
    act(() => btn('Page suivante').click());
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    act(() => btn('Page 5 sur 7').click());
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    act(() => { host.querySelector('nav')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    expect(onPageChange).toHaveBeenLastCalledWith(6);
    expect(host.querySelector('.ac-pager-sr')?.textContent).toBe('Page 1 sur 7');
  });

  it('shows ellipses for long lists and a single disabled pill for one page', () => {
    render({ page: 9, totalPages: 20, onChange: () => {} });
    expect(nums()).toEqual(['1', '…', '9', '10', '11', '…', '20']);
    render({ page: 0, total: 3, pageSize: 50 });
    expect(nums()).toEqual(['1']);
    expect(host.querySelector('.ac-pager')?.classList.contains('is-single')).toBe(true);
    expect(btn('Page suivante').disabled).toBe(true);
  });

  it('supports cursor lists (audit log) with hasMore and a loading lock', () => {
    const onPageChange = vi.fn();
    render({ page: 2, hasMore: true, onPageChange });
    expect(nums()).toEqual(['3']);
    act(() => btn('Page suivante').click());
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    act(() => btn('Page précédente').click());
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    render({ page: 2, hasMore: false, onPageChange });
    expect(btn('Page suivante').disabled).toBe(true);
    render({ page: 2, hasMore: true, disabled: true, onPageChange });
    expect(btn('Page suivante').disabled).toBe(true);
    expect(btn('Page précédente').disabled).toBe(true);
  });

  it('paints only through CSS (no inline colours)', () => {
    render({ page: 0, total: 100, pageSize: 10 });
    for (const b of host.querySelectorAll('button')) expect(b.getAttribute('style')).toBeNull();
  });
});
