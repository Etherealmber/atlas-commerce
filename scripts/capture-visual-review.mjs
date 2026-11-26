import { whatsNewVersion } from './visual-current-version.mjs';
// Captures the actual test/test demo against localhost only. Never use real data.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { waitForVisualReady } from './visual-wait.mjs';
import { findVisibleFrenchCandidates } from './visual-i18n-observer.mjs';

const BASE = 'http://127.0.0.1:5173';
const OUT = 'artifacts/visual-review';
// Screenshot-only font substitution: use the same families from local Fontsource
// packages while all other external requests remain blocked.
function localFontCss(packageName, cssFile) {
  const base = `node_modules/${packageName}`;
  return readFileSync(`${base}/${cssFile}`, 'utf8')
    .replaceAll('DM Sans Variable', 'DM Sans')
    .replace(/url\(\.\/files\/([^)]*\.woff2)\)/g, (_, file) => `url(data:font/woff2;base64,${readFileSync(`${base}/files/${file}`).toString('base64')})`)
    .replace(/,\s*url\(\.\/files\/[^)]*\.woff\)\s*format\('woff'\)/g, '');
}
const fontCss = [localFontCss('@fontsource-variable/dm-sans', 'index.css'), localFontCss('@fontsource-variable/dm-sans', 'wght-italic.css'), localFontCss('@fontsource/spline-sans-mono', '500.css'), localFontCss('@fontsource/spline-sans-mono', '600.css')].join('\n');
const fingerprint = `visual-review-${Date.now()}`;
const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-device-fingerprint': fingerprint },
  body: JSON.stringify({ username: 'test', password: 'test', fingerprint, client: 'web' }),
});
const auth = await res.json();
if (!res.ok || !auth.token?.startsWith('atlasdemo.') || !auth.demo?.active) throw new Error(`Local demo login failed: ${auth.code || res.status}`);
mkdirSync(OUT, { recursive: true });
const pages = [
  ['01-dashboard', '/dashboard'], ['02-products', '/products'], ['03-clients', '/clients'],
  ['04-employees', '/employees'], ['05-attendance', '/attendance'], ['06-quotes', '/quotes'],
  ['07-invoices', '/invoices'], ['08-balance', '/balance'], ['09-quick-sale', '/quick-sale'],
  ['10-vendors', '/vendors'], ['11-payroll', '/payroll'], ['12-inventory', '/inventory-ops'],
  ['13-reports', '/reports'], ['14-settings-profile', '/settings?tab=profile'],
  ['15-settings-categories', '/settings?tab=categories'], ['16-settings-users', '/settings?tab=admin'],
  ['17-settings-agent', '/settings?tab=agent'], ['18-whats-new', '/whats-new'], ['19-audit', '/settings?tab=audit'],
];
const mobile = [ ['M01-home', '/m'], ['M02-products', '/m/products'], ['M03-balance', '/m/balance'], ['M04-employees', '/m/employees'], ['M05-settings', '/m/settings'], ['M06-agent', '/m/agent'] ];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: true });
const manifest = [];
const i18nObservations = [];
try {
  for (const lang of ['ar', 'en', 'fr'].filter((v) => !process.env.VISUAL_LANGUAGE || process.env.VISUAL_LANGUAGE === v)) {
    for (const device of ['desktop', 'mobile'].filter((v) => !process.env.VISUAL_DEVICE || process.env.VISUAL_DEVICE === v)) {
      const page = await browser.newPage();
      await page.setViewport(device === 'desktop' ? { width: 1440, height: 900, deviceScaleFactor: 1 } : { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      if (device === 'mobile') await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36');
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('https://fonts.googleapis.com/css2?')) void request.respond({ status: 200, contentType: 'text/css', body: fontCss });
        else if (url.startsWith(`${BASE}/`) || url.startsWith('data:') || url.startsWith('blob:')) void request.continue();
        else void request.abort();
      });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument((session, language, fp, whatsNewVersion) => {
        const values = { stock_auth_token: session.token, stock_auth_user: 'test', stock_role: session.role, stock_display_name: session.display_name, stock_device_fp: fp,
          atlas_demo_session: JSON.stringify({ ...session.demo, intro_seen: true }), atlas_lang: language, 'atlas-theme': 'light', atlas_welcome_completed: 'true',
          atlas_onboarding: JSON.stringify({ status: 'done', step: 0 }), atlas_phone_onboarding: 'done', 'atlas-whats-new-modal-seen': whatsNewVersion, 'atlas-whats-new-seen': whatsNewVersion,
          atlas_cookie_consent_v1: JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, method: 'necessary_only', decidedAt: '2026-01-01T00:00:00Z' }) };
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, String(value));
      }, auth, lang, fingerprint, whatsNewVersion);
      for (const [code, path] of (device === 'desktop' ? pages : mobile).filter(([id]) => !process.env.VISUAL_FILTER || id.includes(process.env.VISUAL_FILTER))) {
        await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
        const fontsReady = await page.evaluate(async () => {
          const faces = await Promise.all([document.fonts.load('400 16px "DM Sans"'), document.fonts.load('500 14px "Spline Sans Mono"')]);
          await document.fonts.ready;
          return faces.every((loaded) => loaded.length > 0);
        });
        if (!fontsReady) throw new Error('Local screenshot fonts failed to load');
        let ready = await waitForVisualReady(page);
        if (!ready) throw new Error(`${code} (${lang}, ${device}): loading did not finish; refusing incomplete screenshot`);
        const current = new URL(page.url());
        if (current.pathname === '/login' || current.pathname === '/welcome') throw new Error(`${code}: redirected to ${current.pathname}; demo session unavailable`);
        // Audit screenshot stays in the viewport: full-page resize remounts Settings.
        if (code === '19-audit') {
          await page.$eval('.ac-audit-table-wrap', (el) => el.scrollIntoView({ block: 'center' }));
          ready = (await waitForVisualReady(page)) && ready;
          if (!ready) throw new Error(`${code}: audit table is still loading`);
        }
        if (lang !== 'fr') i18nObservations.push({ code, lang, device, ready, candidates: await page.evaluate(findVisibleFrenchCandidates) });
        const filename = `${code}--${lang}--${device}--light${ready ? '' : '--loading'}.png`;
        await page.screenshot({ path: `${OUT}/${filename}`, fullPage: code !== '19-audit' });
        manifest.push(`- **${code}** — ${lang}, ${device}: [${filename}](${filename}) (${path})${ready ? '' : ' — loading did not finish'}`);
        console.log(filename);
        if (code === '19-audit') {
          const auditRow = await page.$('.ac-audit-detail-btn');
          if (auditRow) {
            await auditRow.click();
            await page.waitForSelector('#audit-detail-title', { timeout: 10000 });
            const modalReady = await waitForVisualReady(page);
            if (!modalReady) throw new Error(`${code}: detail is still loading`);
            const modalFile = `${code}-detail--${lang}--${device}--light${modalReady ? '' : '--loading'}.png`;
            await page.screenshot({ path: `${OUT}/${modalFile}` });
            manifest.push(`- **${code}-detail** — ${lang}, ${device}: [${modalFile}](${modalFile})${modalReady ? '' : ' — loading did not finish'}`);
            await page.keyboard.press('Escape');
          }
        }
        const dialogs = device !== 'desktop' ? [] : code === '15-settings-categories'
          ? ['category-create', 'category-edit', 'unit-create', 'unit-edit']
          : code === '16-settings-users' ? ['user-create'] : [];
        for (const dialog of dialogs) {
          const selector = `[data-visual-review="${dialog}"]`;
          // fullPage screenshots can trigger responsive re-renders; reload the
          // intended tab before interacting so the dialog belongs to that page.
          await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
          const dialogReady = await waitForVisualReady(page);
          if (!dialogReady) throw new Error(`${code}-${dialog}: page still loading before dialog`);
          await page.waitForSelector(selector, { timeout: 15000 });
          await page.click(selector);
          await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
          const modalReady = dialogReady && await waitForVisualReady(page);
          if (!modalReady) throw new Error(`${code}-${dialog}: dialog loading did not finish`);
          const modalFile = `${code}-${dialog}--${lang}--${device}--light${modalReady ? '' : '--loading'}.png`;
          await page.screenshot({ path: `${OUT}/${modalFile}` });
          manifest.push(`- **${code}-${dialog}** — ${lang}, ${device}: [${modalFile}](${modalFile})${modalReady ? '' : ' — loading did not finish'}`);
          console.log(modalFile);
          await page.keyboard.press('Escape');
          await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 10000 });
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  // Preserve a manifest even if a later capture fails, so partial artifacts are identifiable.
  writeFileSync(`${OUT}/i18n-observations.json`, JSON.stringify({ note: 'Heuristic French clues in the isolated demo; review manually, not a coverage measurement.', pages: i18nObservations }, null, 2));
  writeFileSync(`${OUT}/README.md`, `# Visual review screenshots\n\nIsolated local test/test demo; no production data. Names include page code, language and device. Send the filename and the area needing refinement. Light theme; most captures are full-page, audit is a viewport capture; overlays and every possible state are not covered. Captures fail rather than include visible loading indicators after 45 seconds. i18n-observations.json contains heuristic French-text candidates from Arabic and English demo pages; review manually and do not treat as coverage.\n\n${manifest.join('\n')}\n`);
}
