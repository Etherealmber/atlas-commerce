import { useMemo, useState } from 'react';
import { publicationDate } from '../lib/releaseDate';

type Release = { tag_name?: string; name?: string; body?: string; published_at?: string; html_url?: string };

/** Search and progressively reveal the published releases without modifying their contents. */
export default function ReleaseTimeline({ releases, renderMarkdown }: { releases: Release[]; renderMarkdown: (body: string) => string }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(6);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? releases.filter(r => [r.name, r.tag_name, r.body].some(value => value?.toLocaleLowerCase().includes(term))) : releases;
  }, [query, releases]);
  return <div className="dl-timeline-wrap">
    <div className="dl-timeline-intro"><div><p className="dl-ed-kicker">JOURNAL DES VERSIONS</p><h3>Historique des publications</h3></div><label className="dl-timeline-search"><span aria-hidden="true">⌕</span><input aria-label="Rechercher une version ou une modification" type="search" placeholder="Rechercher une version…" value={query} onChange={e => { setQuery(e.target.value); setLimit(6); }} /></label></div>
    <p className="dl-timeline-count" aria-live="polite">{releases.length ? `${filtered.length} publication${filtered.length === 1 ? '' : 's'}` : 'Historique indisponible pour le moment.'}</p>
    <div className="dl-timeline">
      {filtered.slice(0, limit).map((r, i) => <article className="dl-timeline-item" key={String(r.tag_name || r.name || i)}>
        <div className="dl-timeline-marker" aria-hidden="true" />
        <div className="dl-timeline-meta"><span>{publicationDate(r.published_at) || 'Date indisponible'}</span>{i === 0 && !query && <span className="dl-timeline-latest">Dernière publication</span>}</div>
        <h4>{r.name || r.tag_name || 'Version'}</h4>
        {r.name && r.tag_name && r.name !== r.tag_name && <span className="dl-timeline-tag">{r.tag_name}</span>}
        {r.body?.trim() && <details><summary>Notes de version</summary><div className="dl-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.body.trim()) }} /></details>}
        {r.html_url && <a href={r.html_url} target="_blank" rel="noopener noreferrer">Voir la publication ↗</a>}
      </article>)}
    </div>
    {releases.length > 0 && filtered.length === 0 && <p className="dl-timeline-empty">Aucune publication ne correspond à votre recherche.</p>}
    {filtered.length > limit && <button type="button" className="secondary dl-timeline-more" onClick={() => setLimit(n => n + 6)}>Afficher plus de versions</button>}
  </div>;
}
