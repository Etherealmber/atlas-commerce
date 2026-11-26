import { readFileSync } from 'node:fs';

// Match the app's actual release marker, not a hardcoded previous version.
const source = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8');
const match = /^export const WHATS_NEW_VERSION = '([^']+)';/m.exec(source);
if (!match) throw new Error('Cannot find WHATS_NEW_VERSION');
export const whatsNewVersion = match[1];
