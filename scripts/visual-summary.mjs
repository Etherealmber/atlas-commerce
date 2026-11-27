// Only selected PNGs from the isolated demo are staged for public Pages.
import { readdirSync, mkdirSync, readFileSync, copyFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export function selectPreviews(names, limit = 8) {
  const candidates = names.filter(name => /^[A-Za-z0-9-]+--(?:ar|en|fr)--(?:desktop|mobile)--light\.png$/.test(name)).sort();
  const chosen = [];
  // Alternate languages and devices, avoiding multiple views of the same page
  // until all available distinct pages have been represented.
  const groups = ['ar--desktop', 'en--desktop', 'fr--desktop', 'ar--mobile', 'en--mobile', 'fr--mobile'];
  for (let round = 0; chosen.length < limit; round++) {
    let added = false;
    for (const group of groups) {
      const match = candidates.find(name => name.includes(`--${group}--`) && !chosen.includes(name) && !chosen.some(c => c.split('--')[0] === name.split('--')[0]));
      const fallback = round > 0 && candidates.find(name => name.includes(`--${group}--`) && !chosen.includes(name));
      if (match || fallback) { chosen.push(match || fallback); added = true; if (chosen.length === limit) break; }
    }
    if (!added) break;
  }
  return chosen;
}

if (process.argv[1]?.endsWith('/visual-summary.mjs')) {
  const [source, destination, run] = process.argv.slice(2);
  if (!source || !destination || !/^\d+-\d+$/.test(run || '')) throw new Error('Invalid staging arguments');
  const files = selectPreviews(readdirSync(source));
  if (!files.length) throw new Error('No completed demo screenshots available for public preview');
  const target = join(destination, run); mkdirSync(target, { recursive: true });
  for (const file of files) {
    if (!lstatSync(join(source, file)).isFile()) throw new Error('Preview must be a regular file');
    const data = readFileSync(join(source, file));
    if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid PNG');
    copyFileSync(join(source, file), join(target, file));
  }
  console.log(JSON.stringify(files));
}
