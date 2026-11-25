/* Real screenshots for the README, `/`, `/desktop` and the welcome theme step.
 *
 * Source images are real renders of the production web bundle, never SVG or
 * CSS mock-ups:
 *   - docs/desktop-shell-reference/*.png (measured reference captures,
 *     1280×800, DM Sans, light + dark) → dashboard, wizards, widgets;
 *   - docs/site-shot-sources/*.png (Atlas Agent panel captured the same way).
 * Wizard dialogs are cropped to the dialog box recorded in measurements.json,
 * so the blurred page behind them is not shown.
 *
 *   node scripts/make-site-shots.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const REF = 'docs/desktop-shell-reference';
const SRC = 'docs/site-shot-sources';
const OUT = 'public/shots';
mkdirSync(OUT, { recursive: true });
const measurements = JSON.parse(readFileSync(`${REF}/measurements.json`, 'utf8'));

/** Bounding box of the wizard dialog (`.modal`) in a reference capture, padded. */
function dialogBox(name, pad = 0) {
  const nodes = measurements[name];
  const modal = Array.isArray(nodes) ? nodes.find((n) => /(^|\s)modal(\s|$)/.test(n.cls || '')) : null;
  if (!modal) throw new Error(`no .modal in ${name}`);
  const left = Math.max(0, Math.floor(modal.x - pad));
  const top = Math.max(0, Math.floor(modal.y - pad));
  return { left, top, width: Math.min(1280 - left, Math.ceil(modal.w + pad * 2)), height: Math.min(800 - top, Math.ceil(modal.h + pad * 2)) };
}

const jobs = [];
for (const theme of ['light', 'dark']) {
  // Full window captures.
  jobs.push({ src: `${REF}/dashboard-${theme}.png`, out: `site-dashboard-${theme}.webp` });
  // Welcome theme picker thumbnails (480×300).
  jobs.push({ src: `${REF}/dashboard-${theme}.png`, out: `site-theme-${theme}.webp`, resize: 480 });
  jobs.push({ src: `${REF}/topbar-notifications-${theme}.png`, out: `site-notifications-${theme}.webp` });
  // Widgets: receivables, payables and stock-health donuts (scrolled dashboard).
  jobs.push({ src: `${REF}/dashboard-scroll3-y1200-${theme}.png`, out: `site-widgets-${theme}.webp`, crop: { left: 100, top: 462, width: 832, height: 338 } });
  // Wizards cropped to the dialog.
  for (const [ref, out] of [
    ['wizard-stock-adjust-step1', 'site-stock'],
    ['wizard-quick-sale-step2', 'site-quick-sale'],
    ['wizard-invoice-step3', 'site-invoice'],
    ['wizard-product-step1', 'site-product'],
  ]) jobs.push({ src: `${REF}/${ref}-${theme}.png`, out: `${out}-${theme}.webp`, crop: dialogBox(`${ref}-${theme}`) });
  // Atlas Agent side panel (380 px wide, conversation area).
  jobs.push({ src: `${SRC}/agent-${theme}.png`, out: `site-agent-${theme}.webp`, crop: { left: 900, top: 0, width: 380, height: 700 } });
}

for (const job of jobs) {
  if (!existsSync(job.src)) { console.warn(`skip (missing) ${job.src}`); continue; }
  let img = sharp(job.src);
  if (job.crop) img = img.extract(job.crop);
  if (job.resize) img = img.resize(job.resize);
  await img.webp({ quality: 84, effort: 6 }).toFile(`${OUT}/${job.out}`);
  console.log(`${job.out}${job.crop ? ` ← ${job.crop.width}×${job.crop.height}` : ''}`);
}
