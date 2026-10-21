/* v2 posters — real app screens in device frames (desktop + phone),
   12 Instagram 1:1 slides, zipped to marketing/atlas-instagram-posters.zip.
   Slides are served by the local preview so <img src="/shots/..."> resolves. */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = 'http://169.254.0.21:36521';
const SLIDES = 'public/_slides';
const OUT = 'marketing/posters';
fs.mkdirSync(SLIDES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const P = [
  { tag: 'ASSISTANTS', title: 'Chaque document,<br>pas à pas', bullets: ['Devis, factures, reçus : un assistant guidé', 'Erreurs affichées dans la popup, jamais perdues'], pc: 'devis-modal-dark', ph: 'phone-quotes-dark', cap: 'Création de devis · thème sombre' },
  { tag: 'THÈME', title: 'Sombre intégral,<br>zinc partout', bullets: ['Un seul langage visuel clair / sombre', 'Aucune surface blanche oubliée, aucun texte invisible'], pc: 'dashboard-dark', ph: 'phone-dashboard-dark', cap: 'Tableau de bord · desktop & téléphone' },
  { tag: 'SCAN OCR', title: 'Le terrain scanne,<br>le bureau valide', bullets: ['Photo du téléphone → produit ou dépense pré-rempli', 'Boîte d’actions : une file claire, zéro papier'], pc: 'pc-bills-dark', ph: 'phone-actions-dark', cap: 'Factures d’achat & boîte d’actions' },
  { tag: 'CAISSE', title: 'Vendre en<br>trois taps', bullets: ['Ticket rapide espèces / banque / carte', 'Stock décrémenté en temps réel'], pc: 'pc-quicksale-dark', ph: 'phone-products-dark', cap: 'Caisse rapide & catalogue mobile' },
  { tag: 'STOCK', title: 'Le stock qui<br>prévient', bullets: ['Seuils mini, alertes dashboard', 'Ajustements tracés, historiques par produit'], pc: 'pc-products-dark', ph: 'phone-products-dark', cap: 'Catalogue desktop & mobile' },
  { tag: 'IA', title: 'Atlas Agent,<br>copilote intégré', bullets: ['Répond, calcule, prépare vos documents', 'Permissions fines par utilisateur'], pc: 'pc-agent-dark', ph: 'phone-dashboard-dark', cap: 'Panneau Agent & dashboard mobile' },
  { tag: 'RAPPORTS', title: 'Balance & TVA,<br>imprimables', bullets: ['Rapports PDF propres, pied de page société', 'Entrées / sorties / résultat par période'], pc: 'pc-balance-dark', ph: 'phone-dashboard-dark', cap: 'Trésorerie & synthèse mobile' },
  { tag: 'SYNC', title: 'Un seul compte,<br>tous les écrans', bullets: ['Même base D1 du téléphone au desktop', 'Le PC garde toutes les fonctions'], pc: 'dashboard-light', ph: 'phone-actions-dark', cap: 'Thème clair desktop · mobile sombre' },
  { tag: 'FACTURATION', title: 'Facturation<br>complète', bullets: ['Acomptes, avoirs, créances clients', 'Numérotation et mentions légales'], pc: 'pc-invoices-dark', ph: 'phone-quotes-dark', cap: 'Journal des factures & devis mobile' },
  { tag: 'ÉQUIPE', title: 'Employés &<br>pointage', bullets: ['Rôles et permissions par métier', 'Présences et remboursements sans papier'], pc: 'pc-employees-dark', ph: 'phone-dashboard-dark', cap: 'Rh desktop & synthèse mobile' },
  { tag: 'BOÎTE', title: 'Une file,<br>zéro oubli', bullets: ['Chaque scan devient une action traitable', 'Historique complet des décisions'], pc: 'pc-actions-dark', ph: 'phone-actions-dark', cap: 'Boîte d’actions desktop & mobile' },
  { tag: 'OPEN SOURCE', title: 'Forkez-le.<br>C’est MIT.', bullets: ['Disponible sur GitHub maintenant', 'Screenshots réels : aucune maquette'], pc: 'dashboard-dark', ph: 'phone-dashboard-dark', cap: 'Atlas Commerce 1.4.5-beta · © 2026 loxdpsy', fork: true },
];

const SLUGS = ['wizards','dark-theme','scan-ocr','caisse','stock','agent-ia','rapports','sync','facturation','equipe','boite-actions','open-source'];
const slide = (i, p) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box; font-family:'Inter','Segoe UI',system-ui,sans-serif; }
  html,body { width:1080px; height:1080px; }
  body { background:#101012; color:#f4f4f5; position:relative; overflow:hidden; }
  body::before { content:''; position:absolute; inset:0;
    background: radial-gradient(720px 480px at 88% 6%, rgba(184,115,51,0.16), transparent 62%),
                radial-gradient(560px 420px at 4% 96%, rgba(184,115,51,0.10), transparent 60%); }
  .grid { position:absolute; inset:0; background-image:linear-gradient(rgba(244,244,245,0.035) 1px, transparent 1px),linear-gradient(90deg, rgba(244,244,245,0.035) 1px, transparent 1px); background-size:54px 54px; mask-image:radial-gradient(700px 500px at 30% 30%, #000, transparent 75%); }
  .txt { position:absolute; left:64px; top:96px; width:430px; z-index:3; }
  .kicker { display:inline-flex; align-items:center; gap:10px; font-size:21px; letter-spacing:0.26em; color:#b87333; font-weight:700; }
  .kicker::before { content:''; width:26px; height:2px; background:#b87333; }
  h1 { margin-top:26px; font-size:64px; line-height:1.06; font-weight:800; letter-spacing:-0.015em; }
  ul { margin-top:30px; list-style:none; }
  li { font-size:25px; line-height:1.35; color:#a1a1aa; padding-left:26px; position:relative; margin-bottom:14px; }
  li::before { content:''; position:absolute; left:0; top:12px; width:9px; height:9px; border-radius:50%; background:#b87333; }
  .cap { position:absolute; left:64px; bottom:150px; width:430px; font-size:19px; color:#71717a; z-index:3; }
  .foot { position:absolute; left:64px; right:64px; bottom:64px; display:flex; align-items:center; justify-content:space-between; z-index:3; }
  .repo { font-size:25px; font-weight:700; } .repo b { color:#b87333; }
  .cta { font-size:22px; font-weight:700; color:#101012; background:#e4e4e7; padding:13px 26px; border-radius:999px; }
  .num { position:absolute; right:64px; top:52px; font-size:22px; letter-spacing:0.3em; color:#52525b; font-weight:700; z-index:3; }
  .desk { position:absolute; right:44px; top:120px; width:560px; z-index:2; border:1px solid #3f3f46; border-radius:16px; overflow:hidden; box-shadow:0 40px 80px rgba(0,0,0,0.55); background:#1c1c1f; }
  .desk .bar { height:32px; display:flex; align-items:center; gap:6px; padding:0 12px; background:#1c1c1f; border-bottom:1px solid #27272a; }
  .desk .bar i { width:9px; height:9px; border-radius:50%; background:#3f3f46; }
  .desk .bar span { margin-left:10px; font-size:13px; color:#52525b; background:#141416; border:1px solid #27272a; border-radius:6px; padding:2px 10px; }
  .desk img { display:block; width:100%; height:352px; object-fit:cover; object-position:top; }
  .pho { position:absolute; right:70px; bottom:132px; width:236px; z-index:3; border:5px solid #27272a; outline:1px solid #3f3f46; border-radius:34px; overflow:hidden; box-shadow:0 34px 70px rgba(0,0,0,0.6); background:#141416; }
  .pho img { display:block; width:100%; height:430px; object-fit:cover; object-position:top; }
  .pho .notch { position:absolute; left:50%; transform:translateX(-50%); top:8px; width:74px; height:14px; border-radius:999px; background:#101012; border:1px solid #27272a; }
</style></head><body>
  <div class="grid"></div>
  <div class="num">${String(i + 1).padStart(2, '0')}/12</div>
  <div class="txt">
    <div class="kicker">${p.tag}</div>
    <h1>${p.title}</h1>
    <ul>${p.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
  </div>
  <div class="cap">${p.cap} — captures réelles de l’app.</div>
  <div class="desk"><div class="bar"><i></i><i></i><i></i><span>stock.afmarbre.com</span></div><img src="/shots/${p.pc}.png" alt=""></div>
  <div class="pho"><div class="notch"></div><img src="/shots/${p.ph}.png" alt=""></div>
  <div class="foot"><div class="repo">github.com/<b>Etherealmber</b>/atlas-commerce</div><div class="cta">${p.fork ? 'Fork it ★' : 'Dispo sur GitHub'}</div></div>
</body></html>`;

for (let i = 0; i < P.length; i++) fs.writeFileSync(path.join(SLIDES, `${String(i + 1).padStart(2, '0')}.html`), slide(i, P[i]));

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1080, height: 1080 },
});
const page = await browser.newPage();
for (let i = 0; i < P.length; i++) {
  await page.goto(`${BASE}/_slides/${String(i + 1).padStart(2, '0')}.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));
  const file = path.join(OUT, `${String(i + 1).padStart(2, '0')}-${SLUGS[i]}.png`);
  await page.screenshot({ path: file });
  console.log('poster', file);
}
await browser.close();
for (const f of fs.readdirSync(SLIDES)) fs.unlinkSync(path.join(SLIDES, f));
fs.rmdirSync(SLIDES);
console.log('POSTERS V2 DONE');
