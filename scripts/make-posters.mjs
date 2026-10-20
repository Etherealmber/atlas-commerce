/* Renders 12 Instagram 1:1 posters (1080×1080) for Atlas Commerce and zips
   them into marketing/atlas-instagram-posters.zip. Pure HTML/CSS slides
   captured by headless Chromium — same engine as capture-shots.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const OUT = 'marketing/posters';
fs.mkdirSync(OUT, { recursive: true });

const POSTERS = [
  ['Devis & factures', 'Des assistants pas à pas guident chaque étape — zéro formulaire géant.', 'wizards'],
  ['Thème sombre zinc', 'Un dark mode integral : chaque bouton, chaque menu, chaque popup.', 'dark'],
  ['Scan OCR téléphone', 'Photographiez une facture : le produit ou la dépense est pré-rempli.', 'ocr'],
  ['Caisse express', 'Vente en 3 taps : client, articles, encaissement espèces ou banque.', 'pos'],
  ['Stock sans surprise', 'Seuils mini, alertes dashboard, ajustements tracés.', 'stock'],
  ['Atlas Agent IA', 'Un copilote qui répond, calcule et prépare vos documents.', 'agent'],
  ['Rapports PDF', 'Balance, ventes, TVA — imprimables et partageables.', 'pdf'],
  ['Terrain ↔ bureau', 'Le téléphone scanne, le desktop valide. Une seule base.', 'sync'],
  ['Facturation complète', 'Acomptes, avoirs, multi-devises, numérotation légale.', 'billing'],
  ['Équipe & pointage', 'Employés, présences, remboursements — sans papier.', 'team'],
  ['Boîte d’actions', 'Chaque demande du terrain atterrit dans une file claire.', 'inbox'],
  ['Open source MIT', 'Disponible sur GitHub maintenant. Forkez-le, citez-nous.', 'fork'],
];

const slide = (i, [title, sub, tag]) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box; font-family: 'Inter','Segoe UI',system-ui,sans-serif; }
  html,body { width:1080px; height:1080px; }
  body { background:#141416; color:#f4f4f5; position:relative; overflow:hidden; }
  body::before { content:''; position:absolute; inset:-20%;
    background:
      radial-gradient(600px 420px at 82% 12%, rgba(184,115,51,0.20), transparent 60%),
      radial-gradient(700px 520px at 12% 88%, rgba(184,115,51,0.12), transparent 60%),
      conic-gradient(from 210deg at 70% 30%, rgba(255,255,255,0.05), transparent 25%);
  }
  .frame { position:absolute; inset:56px; border:1px solid rgba(244,244,245,0.14); border-radius:36px; }
  .num { position:absolute; top:96px; left:112px; font-size:30px; letter-spacing:0.32em; color:#b87333; font-weight:700; }
  .logo { position:absolute; top:88px; right:112px; display:flex; align-items:center; gap:14px; }
  .logo .m { width:56px; height:56px; border-radius:14px; background:linear-gradient(135deg,#2a2a2e,#1c1c1f);
    border:1px solid rgba(184,115,51,0.5); display:flex; align-items:center; justify-content:center;
    font-weight:800; font-size:26px; color:#b87333; }
  .logo .n { font-size:24px; font-weight:600; color:#a1a1aa; }
  .mid { position:absolute; left:112px; right:112px; top:330px; }
  h1 { font-size:86px; line-height:1.04; font-weight:800; letter-spacing:-0.02em; }
  h1 em { font-style:normal; color:#b87333; }
  p { margin-top:34px; font-size:36px; line-height:1.4; color:#a1a1aa; max-width:820px; }
  .tag { position:absolute; left:112px; top:252px; font-size:24px; letter-spacing:0.22em; text-transform:uppercase;
    color:#71717a; border:1px solid rgba(161,161,170,0.3); border-radius:999px; padding:10px 22px; }
  .foot { position:absolute; left:112px; right:112px; bottom:104px; display:flex; align-items:center; justify-content:space-between; }
  .foot .repo { font-size:30px; font-weight:700; color:#f4f4f5; }
  .foot .repo span { color:#b87333; }
  .foot .cta { font-size:26px; color:#141416; background:#e4e4e7; border-radius:999px; padding:16px 30px; font-weight:700; }
  .ver { position:absolute; bottom:56px; left:112px; font-size:20px; color:#52525b; letter-spacing:0.18em; }
</style></head><body>
  <div class="frame"></div>
  <div class="num">${String(i + 1).padStart(2, '0')} / 12</div>
  <div class="logo"><div class="m">A</div><div class="n">Atlas Commerce</div></div>
  <div class="tag">${tag}</div>
  <div class="mid"><h1>${title.replace(/(GitHub|IA|OCR)/, '<em>$1</em>')}</h1><p>${sub}</p></div>
  <div class="foot">
    <div class="repo">github.com/<span>Etherealmber</span>/atlas-commerce</div>
    <div class="cta">${i === 11 ? 'Fork it ★' : 'Dispo sur GitHub'}</div>
  </div>
  <div class="ver">v1.4.5-BETA · MIT © 2026 LOXDPSY</div>
</body></html>`;

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1080, height: 1080 },
});
const page = await browser.newPage();
for (let i = 0; i < POSTERS.length; i++) {
  await page.setContent(slide(i, POSTERS[i]), { waitUntil: 'load' });
  const file = path.join(OUT, `${String(i + 1).padStart(2, '0')}-${POSTERS[i][2]}.png`);
  await page.screenshot({ path: file });
  console.log('poster', file);
}
await browser.close();
console.log('POSTERS DONE');
