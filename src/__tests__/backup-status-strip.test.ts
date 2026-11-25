// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import BackupStatusStrip from '../components/settings/BackupStatusStrip';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('backup status strip (v0.9.3 backup page redesign)', () => {
  it('summarises the already-loaded R2 listing without any request', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const now = Date.parse('2026-10-20T12:00:00Z');
    const list = [
      { key: 'backups/latest.abk', size: 1834567, uploaded: '2026-10-20T09:00:00Z' },
      { key: 'backups/30m/atlas-2026-10-19T12-00-00.abk', size: 1800000, uploaded: null },
      { key: 'backups/30m/atlas-2026-10-19T00-00-00.abk', size: 1800000, uploaded: null },
    ];
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(BackupStatusStrip, { list, now })));
    expect(host.textContent).toContain('il y a 3 h');
    expect(host.textContent).toContain('1,7 Mo');
    expect(host.textContent).toContain('Points de restauration2');
    expect(host.querySelector('.bk-dot--ok')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => root.render(React.createElement(BackupStatusStrip, { list: [], now })));
    expect(host.textContent).toContain('Aucune');
    await act(async () => root.unmount());
  });
  it('the Settings panel keeps its handlers and adds no new backup endpoint', () => {
    const src = readFileSync('src/pages/Settings.tsx', 'utf8');
    expect(src).toContain('<BackupStatusStrip list={backupList} />');
    for (const call of ['api.backupNow()', 'api.backupStatus()', 'api.backupRestore({ key: selectedBackupKey })']) expect(src).toContain(call);
    const strip = readFileSync('src/components/settings/BackupStatusStrip.tsx', 'utf8');
    expect(strip).not.toMatch(/\bapi\.|fetch\(/);
  });
});
