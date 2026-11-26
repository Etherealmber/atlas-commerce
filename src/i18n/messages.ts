/** French source catalog plus community-editable English and Arabic catalogs.
 * Missing target entries fall back to French. The key is the normalized French
 * source text, preserving compatibility with the DOM translator and templates. */
import fr from './catalogs/fr.json';
import en from './catalogs/en.json';
import ar from './catalogs/ar.json';

const english: Record<string, string> = en;
const arabic: Record<string, string> = ar;
export const MESSAGES: ReadonlyArray<readonly [string, string, string]> = Object.keys(fr).map(
  key => [key, english[key] || key, arabic[key] || key] as const,
);
