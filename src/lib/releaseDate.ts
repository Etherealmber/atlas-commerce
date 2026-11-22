/** Format a supplied ISO publication date without inventing a date or shifting its day. */
export function publicationDate(value?: string): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function sameReleaseVersion(tag?: string, version?: string): boolean {
  if (!tag || !version) return false;
  const normalise = (s: string) => s.trim().replace(/^v/i, '').toLowerCase();
  return normalise(tag) === normalise(version);
}
