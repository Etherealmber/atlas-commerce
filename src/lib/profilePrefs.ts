import type { ProfileData } from '../components/ui/EditProfile';

/** Time zones offered in « Modifier le profil » (value = IANA id saved in the database). */
export const PROFILE_TIME_ZONES: { id: string; label: string }[] = [
  { id: 'Africa/Casablanca', label: 'Maroc (Casablanca)' },
  { id: 'Europe/Paris', label: 'France (Paris)' },
  { id: 'Europe/Madrid', label: 'Espagne (Madrid)' },
  { id: 'Europe/London', label: 'Royaume-Uni (Londres)' },
  { id: 'Africa/Algiers', label: 'Algérie (Alger)' },
  { id: 'Africa/Tunis', label: 'Tunisie (Tunis)' },
  { id: 'Asia/Dubai', label: 'Émirats (Dubaï)' },
  { id: 'America/New_York', label: 'États-Unis (New York)' },
  { id: 'UTC', label: 'UTC' },
];

export function timeZoneOptions(current: string) {
  if (!current || PROFILE_TIME_ZONES.some((z) => z.id === current)) return PROFILE_TIME_ZONES;
  return [...PROFILE_TIME_ZONES, { id: current, label: current }];
}

/** D1 `updated_at` ("YYYY-MM-DD HH:MM:SS", UTC) → « 25 nov. 2026, 14:05 ». */
export function formatProfileUpdatedAt(raw: unknown): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Map GET/PATCH /api/auth/me data to the « Modifier le profil » form. */
export function profileDataFromServer(m: any, prev: ProfileData | null): ProfileData {
  return {
    fullName: String(m?.display_name ?? prev?.fullName ?? ''),
    email: String(m?.email ?? prev?.email ?? ''),
    timezone: String(m?.timezone || prev?.timezone || 'Africa/Casablanca'),
    workingHours: String(m?.working_hours ?? prev?.workingHours ?? ''),
    title: String(m?.job_title ?? prev?.title ?? ''),
    avatarUrl: String(m?.avatar_url ?? prev?.avatarUrl ?? ''),
    lastUpdated: m?.profile_updated_at ? formatProfileUpdatedAt(m.profile_updated_at) : (prev?.lastUpdated || ''),
  };
}
