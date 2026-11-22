import { useEffect, useState } from 'react';
import { KIND_META, PLAT_LABEL, RELEASES } from '../pages/WhatsNew';
import { RELEASE_VISIBLE_CAP, semverAtMost } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';
import {
  REPO_CONTRIBUTORS,
  fetchRepoContributors,
  getContributorsForRelease,
  type Contributor,
} from '../lib/contributors';

export default function PhoneWhatsNew() {
  const [contributors, setContributors] = useState<Contributor[]>(REPO_CONTRIBUTORS);
  useEffect(() => {
    markWhatsNewSeen();
    let alive = true;
    fetchRepoContributors().then((list) => {
      if (alive) setContributors(list);
    });
    return () => { alive = false; };
  }, []);
  const releases = RELEASES.filter(r => semverAtMost(r.version, RELEASE_VISIBLE_CAP));
  return (
    <div className="ph-version-history">
      <p>Historique des changements publiés et des plateformes concernées.</p>
      <section className="ph-settings-card wn-thanks-card" aria-label="Remerciements et contributeurs">
        <h2 className="wn-thanks-title">Remerciements &amp; contributeurs</h2>
        <p className="wn-thanks-sub">Merci aux personnes ayant contribué à Atlas Commerce :</p>
        <div className="wn-contributors">
          {contributors.map((c) => (
            <a key={c.login} href={c.url} target="_blank" rel="noreferrer noopener" className="wn-contributor-pill">
              {c.avatarUrl ? <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" /> : null}
              <span>{c.name !== c.login ? `${c.name} (${c.handle})` : c.handle}</span>
            </a>
          ))}
        </div>
      </section>
      {releases.map((release, index) => {
        const relContributors = getContributorsForRelease(release.version);
        return (
        <section className="ph-settings-card ph-release-card" key={release.version}>
          <h2>Atlas Commerce {release.version}</h2>
          <div className="ph-release-badges"><span>{release.version}</span>{index === 0 && <span>Dernière</span>}</div>
          <small>Publié le {release.date}</small><hr />
          {release.sections.map((section, i) => {
            const meta = KIND_META[section.kind];
            const Icon = meta.icon;
            return (
              <div key={`${section.kind}-${i}`}>
                <div className="ph-release-section-head">
                  <span className={`wn-sec-ico wn-sec-ico--${meta.tone}`} style={{ background: meta.bg, color: meta.color }} aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>
                  <h3>{meta.title}</h3>
                </div>
                <ul>{section.items.map(item => (
                  <li key={item.id}>
                    <span>{item.text}</span>
                    {item.platforms && item.platforms.length > 0 && <span className="wn-plats" aria-label="Plateformes concernées">{item.platforms.map(platform => <em key={platform} className={`wn-plat wn-plat--${platform}`}>{PLAT_LABEL[platform]}</em>)}</span>}
                  </li>
                ))}</ul>
              </div>
            );
          })}
          <div className="wn-release-contributors" aria-label={`Contributeurs de la version ${release.version}`}>
            <span className="wn-contributors-label">Merci à</span>
            {relContributors.map((c) => (
              <a key={`${release.version}-${c.login}`} href={c.url} target="_blank" rel="noreferrer noopener" className="wn-contributor-pill">
                {c.avatarUrl ? <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" /> : null}
                <span>{c.handle}</span>
              </a>
            ))}
          </div>
        </section>
        );
      })}
      {!releases.length && <p>Aucune version publiée pour le moment.</p>}
    </div>
  );
}
