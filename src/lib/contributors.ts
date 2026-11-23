export type Contributor = {
  login: string;
  name: string;
  handle: string;
  url: string;
  avatarUrl?: string;
  role: string;
};

const HIDDEN_CONTRIBUTORS = new Set(['arena-agent']);

export const REPO_CONTRIBUTORS: Contributor[] = [
  {
    login: 'loxdpsy',
    name: 'Haytam',
    handle: '@loxdpsy',
    url: 'https://github.com/loxdpsy',
    avatarUrl: 'https://avatars.githubusercontent.com/u/291979392?v=4',
    role: 'Créateur & contributeur principal',
  },
  {
    login: 'Etherealmber',
    name: 'Etherealmber',
    handle: '@Etherealmber',
    url: 'https://github.com/Etherealmber',
    avatarUrl: 'https://avatars.githubusercontent.com/u/318825377?v=4',
    role: 'Organisation & dépôt',
  },
];

export function getContributorsForRelease(_version: string): Contributor[] {
  return [REPO_CONTRIBUTORS[0]];
}

export async function fetchRepoContributors(): Promise<Contributor[]> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/Etherealmber/atlas-commerce/contributors?per_page=30',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return REPO_CONTRIBUTORS;
    const raw = await res.json();
    if (!Array.isArray(raw)) return REPO_CONTRIBUTORS;
    const known = new Map(REPO_CONTRIBUTORS.map((c) => [c.login.toLowerCase(), c]));
    const merged: Contributor[] = [...REPO_CONTRIBUTORS];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const login = String(item.login || '').trim();
      const type = String(item.type || '');
      if (!login || type === 'Bot' || login.endsWith('[bot]')) continue;
      if (HIDDEN_CONTRIBUTORS.has(login.toLowerCase())) continue;
      if (known.has(login.toLowerCase())) continue;
      const c: Contributor = {
        login,
        name: login,
        handle: `@${login}`,
        url: String(item.html_url || `https://github.com/${login}`),
        avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : undefined,
        role: 'Contributeur',
      };
      known.set(login.toLowerCase(), c);
      merged.push(c);
    }
    return merged;
  } catch {
    return REPO_CONTRIBUTORS;
  }
}
