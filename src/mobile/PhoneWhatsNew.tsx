import { useEffect } from 'react';
import { KIND_META, PLAT_LABEL, RELEASES } from '../pages/WhatsNew';
import { RELEASE_VISIBLE_CAP, semverAtMost } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';

export default function PhoneWhatsNew() {
  useEffect(() => { markWhatsNewSeen(); }, []);
  const releases = RELEASES.filter(r => semverAtMost(r.version, RELEASE_VISIBLE_CAP));
  return (
    <div className="ph-version-history">
      <p>Historique des changements publiés et des plateformes concernées.</p>
      {releases.map((release, index) => (
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
        </section>
      ))}
      {!releases.length && <p>Aucune version publiée pour le moment.</p>}
    </div>
  );
}
