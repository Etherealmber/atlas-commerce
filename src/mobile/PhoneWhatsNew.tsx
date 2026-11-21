import { useEffect } from 'react';
import { RELEASES } from '../pages/WhatsNew';
import { RELEASE_VISIBLE_CAP, semverAtMost } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';

const labels = { features: 'Nouveautés', improvements: 'Améliorations', fixes: 'Corrections', breaking: 'Changements importants' };
export default function PhoneWhatsNew() {
  useEffect(() => { markWhatsNewSeen(); }, []);
  const releases = RELEASES.filter(r => semverAtMost(r.version, RELEASE_VISIBLE_CAP)).map(r => ({ ...r, sections: r.sections.map(s => ({ ...s, items: s.items.filter(item => !item.platforms || item.platforms.includes('web')) })).filter(s => s.items.length) })).filter(r => r.sections.length);
  return <div className="ph-version-history"><p>Historique complet des changements publiés pour le web.</p>{releases.map((release, index) => <section className="ph-settings-card ph-release-card" key={release.version}><h2>Atlas Commerce Web {release.version}</h2><div className="ph-release-badges"><span>{release.version}</span>{index === 0 && <span>Dernière</span>}</div><small>Publié le {release.date}</small><hr />{release.sections.map((section, i) => <div key={`${section.kind}-${i}`}><h3>{labels[section.kind]}</h3><ul>{section.items.map(item => <li key={item.id}>{item.text}</li>)}</ul></div>)}</section>)}{!releases.length && <p>Aucune version web publiée pour le moment.</p>}</div>;
}
