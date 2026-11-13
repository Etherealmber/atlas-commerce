import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Update project-owned notices only; preserve the license text and first year. */
export function syncLicenseYears(root) {
  // SOURCE_DATE_EPOCH supports deterministic builds/tests; normal scheduled runs use UTC today.
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch)))) {
    throw new Error('sync-license: SOURCE_DATE_EPOCH invalide');
  }
  const date = epoch === undefined ? new Date() : new Date(Number(epoch) * 1000);
  const currentYear = date.getUTCFullYear();
  if (!Number.isInteger(currentYear) || currentYear < 2026 || currentYear > 9999) {
    throw new Error('sync-license: année invalide');
  }

  const files = ['LICENSE', 'LICENSE-APACHE'].map((file) => {
    const path = join(root, file);
    const text = readFileSync(path, 'utf8');
    const matches = [...text.matchAll(/^Copyright \(c\) 2026(?:-(\d{4}))? Etherealmber$/gm)];
    if (matches.length !== 1) throw new Error(`sync-license: notice manquante ou dupliquée dans ${file}`);
    const endYear = matches[0][1] ? Number(matches[0][1]) : 2026;
    if (endYear < 2026) throw new Error(`sync-license: année finale invalide dans ${file}`);
    return { file, path, text, endYear };
  });
  // Never shorten a previously published range when the clock is behind.
  const endYear = Math.max(currentYear, ...files.map((file) => file.endYear));
  const years = endYear === 2026 ? '2026' : `2026-${endYear}`;
  let changed = false;
  for (const { file, path, text } of files) {
    const out = text.replace(/^Copyright \(c\) 2026(?:-\d{4})? Etherealmber$/m, `Copyright (c) ${years} Etherealmber`);
    if (out !== text) {
      writeFileSync(path, out);
      console.log(`sync-license: ${file} — copyright ${years}`);
      changed = true;
    }
  }
  if (!changed) console.log('sync-license: notices déjà à jour');
  return changed;
}
