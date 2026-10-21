/* Extra real captures: desktop pages + phone-viewport screens (dark). */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

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
await page.setRequestInterception(true);
page.on('request', async (req) => {
  try {
    if (req.resourceType() === 'document') {
      const res = await fetch(req.url(), { headers: req.headers() });
      let body = await res.text();
      if (body.includes('<head>')) body = body.replace('<head>', '<head><script>try{localStorage.setItem("stock_device_fp","capture-fp-0001-v220");localStorage.setItem("atlas_welcome_completed","true");localStorage.setItem("atlas_cookie_consent_v1",JSON.stringify({version:1,necessary:true,preferences:true,analytics:false,decidedAt:new Date().toISOString(),method:"accept_all"}));localStorage.setItem("atlas-whats-new-modal-seen","1.4.5-beta");localStorage.setItem("atlas-theme","dark");}catch(e){}</script>');
      return req.respond({ status: res.status, contentType: res.headers.get('content-type') || 'text/html', body });
    }
    return req.continue();
  } catch { return req.continue(); }
});

async function login() {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
  const ok = await page.evaluate(async (fp) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp }, body: JSON.stringify({ username: 'admin', password: 'SmokeTest123!', fingerprint: fp, device_type: 'desktop' }) });
    const j = await r.json();
    if (j?.token) { localStorage.setItem('stock_auth_token', j.token); localStorage.setItem('stock_auth_user', j.username); localStorage.setItem('stock_role', j.role); if (j.ip) localStorage.setItem('stock_session_ip', j.ip); }
    return !!j?.token && j.needs_otp === false;
  }, 'capture-fp-0001-v220');
  if (!ok) throw new Error('login failed');
}

const shoot = async (path, name, wait = 2200) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

await login();
for (const [p, n] of [
  ['/products', 'pc-products-dark'],
  ['/invoices', 'pc-invoices-dark'],
  ['/bills', 'pc-bills-dark'],
  ['/actions', 'pc-actions-dark'],
  ['/balance', 'pc-balance-dark'],
  ['/quick-sale', 'pc-quicksale-dark'],
  ['/employees', 'pc-employees-dark'],
]) await shoot(p, n);

/* agent panel open */
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await sleep(1500);
await page.evaluate(() => document.querySelector('.atlas-agent-fab')?.click());
await sleep(1600);
await page.screenshot({ path: `${OUT}/pc-agent-dark.png` });
console.log('shot pc-agent-dark');

/* phone viewport */
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
for (const [p, n] of [
  ['/', 'phone-dashboard-dark'],
  ['/quotes', 'phone-quotes-dark'],
  ['/products', 'phone-products-dark'],
  ['/actions', 'phone-actions-dark'],
]) await shoot(p, n, 2600);

await browser.close();
console.log('PAGES DONE');
