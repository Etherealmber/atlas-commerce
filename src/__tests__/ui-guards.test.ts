// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Balance from '../pages/Balance';
import { AppDialogsProvider } from '../components/AppDialogs';
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
});
