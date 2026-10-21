import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1280, height: 800 } });
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
await page.goto('http://169.254.0.21:36521/login', { waitUntil: 'networkidle2', timeout: 60000 });
const ok = await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': 'capture-fp-0001-v220' }, body: JSON.stringify({ username: 'admin', password: 'SmokeTest123!', fingerprint: 'capture-fp-0001-v220', device_type: 'desktop' }) });
  const j = await r.json();
  if (j?.token) { localStorage.setItem('stock_auth_token', j.token); localStorage.setItem('stock_auth_user', j.username); localStorage.setItem('stock_role', j.role); if (j.ip) localStorage.setItem('stock_session_ip', j.ip); }
  return { ok: !!j?.token, otp: j.needs_otp };
});
console.log('LOGIN', JSON.stringify(ok));
await page.goto('http://169.254.0.21:36521/settings', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3500));
const info = await page.evaluate(() => {
  const seg = [...document.querySelectorAll('.ac-theme-seg .ac-seg-btn, .ac-scale-seg .ac-seg-btn')].map(b => ({
    cls: b.className, pressed: b.getAttribute('aria-pressed'),
    bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color,
  }));
  const btn = document.querySelector('.ac-theme-seg .ac-seg-btn');
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (rs) => { for (const r of rs) { if (r.cssRules) { walk(r.cssRules); continue; } if (!r.selectorText || !r.style) continue;
      const bg = r.style.getPropertyValue('background') || r.style.getPropertyValue('background-color');
      if (!bg) continue; let m = false; try { m = btn.matches(r.selectorText); } catch {}
      if (m) hits.push({ sel: r.selectorText.slice(0, 110), bg: bg.trim(), imp: r.style.getPropertyPriority('background') || r.style.getPropertyPriority('background-color') });
    } };
    walk(rules);
  }
  const mail = document.querySelector('.party-email-link');
  return { hits: hits.slice(-14), seg, mail: mail ? getComputedStyle(mail).color : 'none', theme: document.documentElement.getAttribute('data-theme') };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
