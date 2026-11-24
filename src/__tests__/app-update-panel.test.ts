// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import AppUpdatePanel from '../components/settings/AppUpdatePanel';

describe('AppUpdatePanel 4-way split & zero-skeleton', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/admin/desktop-update')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              manifest: {
                platform: 'windows',
                arch: 'universal',
                channel: 'stable',
                version: '0.9.3',
                mandatory: false,
                minimum_version: '0.9.0',
                sha256: 'a'.repeat(64),
                sizeBytes: 42_000_000,
                downloadUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe',
                latestUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe',
                cdn1Url: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe',
                checksumsUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/checksums.txt',
                githubUrl: null,
                notes: 'Multi-OS release',
                publishedAt: '2026-10-20T00:00:00Z',
                assets: [
                  {
                    platform: 'windows',
                    arch: 'universal',
                    kind: 'installer',
                    filename: 'atlas-commerce-desktop-0.9.3-windows-universal-setup.exe',
                    key: 'app-updates/desktop/atlas-commerce-desktop-0.9.3-windows-universal-setup.exe',
                    aliasKey: 'app-updates/desktop/latest-setup.exe',
                    downloadUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-0.9.3-windows-universal-setup.exe',
                    latestUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe',
                    sha256: 'a'.repeat(64),
                    sizeBytes: 42_000_000,
                  },
                  {
                    platform: 'macos',
                    arch: 'universal',
                    kind: 'dmg',
                    filename: 'atlas-commerce-desktop-0.9.3-macos-universal.dmg',
                    key: 'app-updates/desktop/atlas-commerce-desktop-0.9.3-macos-universal.dmg',
                    aliasKey: 'app-updates/desktop/latest-macos.dmg',
                    downloadUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-0.9.3-macos-universal.dmg',
                    latestUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-macos.dmg',
                    sha256: 'b'.repeat(64),
                    sizeBytes: 38_000_000,
                  },
                  {
                    platform: 'linux',
                    arch: 'x86_64',
                    kind: 'appimage',
                    filename: 'atlas-commerce-desktop-0.9.3-linux-x86_64.AppImage',
                    key: 'app-updates/desktop/atlas-commerce-desktop-0.9.3-linux-x86_64.AppImage',
                    aliasKey: 'app-updates/desktop/latest-linux-x86_64.AppImage',
                    downloadUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-0.9.3-linux-x86_64.AppImage',
                    latestUrl: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-linux-x86_64.AppImage',
                    sha256: 'c'.repeat(64),
                    sizeBytes: 48_000_000,
                  },
                ],
              },
              source: 'r2',
              json: { key: 'app-updates/desktop/latest.json', url: 'https://cdn1.afmarbre.com/app-updates/desktop/latest.json', size: 1200, uploaded: '2026-10-20T00:00:00Z' },
              installer: { key: 'app-updates/desktop/latest-setup.exe', url: 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe', size: 42_000_000, uploaded: '2026-10-20T00:00:00Z' },
              files: [{ key: 'app-updates/desktop/latest.json', size: 1200, uploaded: '2026-10-20T00:00:00Z' }],
              maxBytes: 350 * 1024 * 1024,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            minimumVersionEnabled: false,
            minimumSupportedVersionCode: 100,
            manifest: { versionCode: 200, versionName: '0.9.2', apkUrl: 'https://cdn1.afmarbre.com/app-updates/android/latest.apk', mandatory: false, notes: '' },
            source: 'r2',
            json: { key: 'app-updates/android/latest.json', url: 'https://cdn1.afmarbre.com/app-updates/android/latest.json', size: 400, uploaded: '2026-10-20T00:00:00Z' },
            apk: { key: 'app-updates/android/latest.apk', url: 'https://cdn1.afmarbre.com/app-updates/android/latest.apk', size: 18_000_000, uploaded: '2026-10-20T00:00:00Z' },
            apkUrlExists: true,
            maxApkBytes: 150 * 1024 * 1024,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }));
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('renders 4 OS tabs without shimmer skeleton boxes and switches cleanly across Windows, macOS, and Linux', async () => {
    await act(async () => {
      root!.render(createElement(AppUpdatePanel));
    });
    expect(host!.querySelectorAll('.skeleton').length).toBe(0);

    const tabs = Array.from(host!.querySelectorAll('[role="group"] button'));
    expect(tabs.map((b) => b.textContent?.trim())).toEqual(['Android (APK)', 'Windows', 'macOS', 'Linux']);
    expect(host!.textContent).toContain('Mise à jour application Android');

    for (const label of ['Windows', 'macOS', 'Linux'] as const) {
      const btn = Array.from(host!.querySelectorAll('[role="group"] button')).find((b) => b.textContent?.trim() === label)!;
      await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(host!.querySelectorAll('.skeleton').length).toBe(0);
      expect(host!.textContent).toContain(`Mise à jour application ${label} (CDN1)`);
      expect(host!.textContent).toContain(`Éditer latest.json (${label})`);
      expect(host!.textContent).toContain(`Uploader un installateur ${label}`);
    }
  });
});
