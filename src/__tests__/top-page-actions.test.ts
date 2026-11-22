// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TopPageActions from '../components/TopPageActions';

let host: HTMLDivElement; let root: Root; let column: HTMLDivElement; let slot: HTMLDivElement; let dock: HTMLElement;
let columnWidth: number; let buttonWidth: number; let resizeObserverUpdate: () => void;
function Example({enabled = true}: {enabled?: boolean}) {
  const [clicks, setClicks] = useState(0);
  return createElement('div', {className:'page-header dock-page-header'},
    createElement('h1',{className:'sr-only'},'Example'),
    createElement(TopPageActions,{enabled, children:[createElement('button',{key:'a',onClick:() => setClicks(n => n + 1)}, `Action ${clicks}`), createElement('button',{key:'b'},'Autre')]}));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  columnWidth=1300; buttonWidth=100;
  column=document.createElement('div'); column.className='ac-main-column';
  slot=document.createElement('div'); slot.id='desktop-catalog-actions'; slot.className='desktop-catalog-actions-slot';
  dock=document.createElement('header'); dock.className='ac-desktop-dock';
  host=document.createElement('div'); column.appendChild(slot); column.appendChild(dock); column.appendChild(host); document.body.appendChild(column); root=createRoot(host);
  vi.stubGlobal('innerWidth',1800);
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resizeObserverUpdate=fn; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this === column ? columnWidth : this === dock ? 320 : buttonWidth;
    return {width,height:40,top:0,left:0,right:width,bottom:40,x:0,y:0,toJSON:()=>({})};
  });
});
afterEach(async () => { await act(async () => root.unmount()); column.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the shell slot when actions fit and preserves their handlers', async () => {
  await act(async () => root.render(createElement(Example)));
  expect(slot.textContent).toContain('Action 0');
  expect(host.querySelector('[data-docked="true"]')).not.toBeNull();
  await act(async () => slot.querySelector<HTMLButtonElement>('button')!.click());
  expect(slot.textContent).toContain('Action 1');
});
it('returns actions to the page on small screens or when they would overlap the dock', async () => {
  await act(async () => root.render(createElement(Example)));
  await act(async () => { columnWidth=750; resizeObserverUpdate(); });
  expect(slot.textContent).toBe(''); expect(host.textContent).toContain('Action 0');
  await act(async () => { columnWidth=1300; resizeObserverUpdate(); });
  expect(slot.textContent).toContain('Action 0');
  await act(async () => { vi.stubGlobal('innerWidth',1200); window.dispatchEvent(new Event('resize')); });
  expect(slot.textContent).toBe(''); expect(host.textContent).toContain('Action 0');
});
it('does not move a focused action until focus leaves and respects the disabled option', async () => {
  await act(async () => root.render(createElement(Example)));
  const button=slot.querySelector<HTMLButtonElement>('button')!; button.focus();
  await act(async () => { vi.stubGlobal('innerWidth',1200); window.dispatchEvent(new Event('resize')); });
  expect(slot.contains(button)).toBe(true);
  await act(async () => button.blur());
  expect(slot.textContent).toBe(''); expect(host.textContent).toContain('Action 0');
  await act(async () => { vi.stubGlobal('innerWidth',1800); root.render(createElement(Example,{enabled:false})); });
  expect(slot.textContent).toBe('');
});
