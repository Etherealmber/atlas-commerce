import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = dirname(fileURLToPath(import.meta.url));
const scripts = ['smoke-p0-api-shape.mjs', 'smoke-auth.mjs', 'smoke-partner-v1.mjs', 'smoke-client-risk.mjs', 'smoke-invoice-kinds.mjs', 'smoke-invoice-vr-fa.mjs', 'smoke-numbering-stock.mjs'];
let code = 0;
for (const s of scripts) {
  const r = spawnSync(process.execPath, [join(dir, s)], { stdio: 'inherit' });
  if (r.status) code = r.status;
}
process.exit(code);
