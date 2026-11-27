// Only selected PNGs from the isolated demo are staged for public Pages.
import { readdirSync, mkdirSync, readFileSync, copyFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

// Keep the step output and GitHub summary well below their size limits.
export function selectPreviews(names, limit = 500) {
  return [...new Set(names.filter(name => /^[A-Za-z0-9-]{1,100}--(?:ar|en|fr)--(?:desktop|mobile)--light\.png$/.test(name)))].sort().slice(0, limit);
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
