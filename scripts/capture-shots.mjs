/* Real in-app capture: screenshots (light/dark) + a scripted session
   recording encoded as GIF (public/shots/). Runs headless Chromium
   (@sparticuz/chromium) against the local vite preview. */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import gifencPkg from 'gifenc';
import UPNG from 'upng-js';

const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const BASE = 'http://169.254.0.21:36521';
const OUT = 'public/shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 120)));
// Seed localStorage BEFORE the app bundle runs (document-level injection),
// so the app adopts our trusted fingerprint and skips the welcome gate.
await page.setRequestInterception(true);
page.on('request', async (req) => {
  try {
    if (req.resourceType() === 'document') {
      const res = await fetch(req.url(), { headers: req.headers() });
      let body = await res.text();
      if (body.includes('<head>')) {
        body = body.replace(
          '<head>',
          '<head><script>try{localStorage.setItem("stock_device_fp","capture-fp-0001-v220");localStorage.setItem("atlas_welcome_completed","true");localStorage.setItem("atlas_cookie_consent_v1",JSON.stringify({version:1,necessary:true,preferences:true,analytics:false,decidedAt:new Date().toISOString(),method:"accept_all"}));localStorage.setItem("atlas-whats-new-modal-seen","1.4.5-beta");}catch(e){}</script>'
        );
      }
      return req.respond({
        status: res.status,
        contentType: res.headers.get('content-type') || 'text/html',
        body,
      });
    }
    return req.continue();
  } catch {
    return req.continue();
  }
});

async function login() {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
  const fp = 'capture-fp-0001-v220';
  const ok = await page.evaluate(async (fp) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
      body: JSON.stringify({
        username: 'admin',
        password: 'SmokeTest123!',
        fingerprint: fp,
        device_type: 'desktop',
      }),
    });
    const j = await r.json();
    if (j?.token) {
      localStorage.setItem('stock_auth_token', j.token);
      localStorage.setItem('stock_auth_user', j.username || 'admin');
      localStorage.setItem('stock_role', j.role || 'owner');
      if (j.ip) localStorage.setItem('stock_session_ip', j.ip);
    }
    return !!j?.token && j.needs_otp === false;
  }, fp);
  if (!ok) throw new Error('headless login failed');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.atlas-hello, .ac-panel, .atlas-page, .topbar', { timeout: 30000 });
  await sleep(1200);
}

async function setTheme(mode) {
  await page.evaluate((m) => localStorage.setItem('atlas-theme', m), mode);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
}

const clickText = (sel, text) =>
  page.evaluate(
    (s, t) => {
      const el = [...document.querySelectorAll(s)].find((n) => (n.textContent || '').trim().includes(t));
      if (el) el.click();
      return !!el;
    },
    sel,
    text
  );

await login();

/* ── screenshots ─────────────────────────────────────────────── */
await setTheme('dark');
await page.screenshot({ path: `${OUT}/dashboard-dark.png` });
console.log('shot dashboard-dark');

await page.goto(BASE + '/quotes', { waitUntil: 'networkidle2' });
await sleep(900);
const opened = await clickText('button', 'Nouveau devis');
if (opened) await sleep(900);
await page.screenshot({ path: `${OUT}/devis-modal-dark.png` });
console.log('shot devis-modal-dark (opened=' + opened + ')');
await page.keyboard.press('Escape');
await sleep(400);

await page.goto(BASE + '/settings', { waitUntil: 'networkidle2' });
await sleep(900);
await page.screenshot({ path: `${OUT}/settings-dark.png` });
console.log('shot settings-dark');

await setTheme('light');
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await sleep(1000);
await page.screenshot({ path: `${OUT}/dashboard-light.png` });
console.log('shot dashboard-light');

/* ── scripted recording → GIF (900×560) ──────────────────────── */
await page.setViewport({ width: 900, height: 560 });
await setTheme('dark');
const frames = [];
async function grab(n = 1, gap = 200) {
  for (let i = 0; i < n; i++) {
    const buf = await page.screenshot({ encoding: 'binary' });
    frames.push(Buffer.from(buf));
    await sleep(gap);
  }
}
await grab(3);
await page.evaluate(() => {
  const a = [...document.querySelectorAll('a')].find((x) => (x.getAttribute('href') || '') === '/quotes');
  if (a) a.click();
});
await sleep(700);
await grab(3);
await clickText('button', 'Nouveau devis');
await sleep(800);
await grab(3);
const typed = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('.modal input')].find((i) => (i.placeholder || '').includes('client'));
  if (inp) inp.focus();
  return !!inp;
});
if (typed) {
  for (const ch of ['h', 'a', 'y']) {
    await page.keyboard.type(ch, { delay: 120 });
    await grab(1, 260);
  }
}
await grab(3);
await page.keyboard.press('Escape');
await sleep(500);
await grab(3);
console.log('frames:', frames.length);

const gif = GIFEncoder();
for (const f of frames) {
  const img = UPNG.decode(f);
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, img.width, img.height, { palette, delay: 240 });
}
gif.finish();
fs.writeFileSync(`${OUT}/demo.gif`, Buffer.from(gif.bytes()));
console.log('gif bytes:', fs.statSync(`${OUT}/demo.gif`).size);

await browser.close();
console.log('CAPTURE DONE');
