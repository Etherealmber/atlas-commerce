import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronRight, Compass, ExternalLink, FileText, Globe, Heart, Info, Palette, RefreshCw, Share2, Smartphone, Users } from 'lucide-react';
import { DISPLAY_VERSION } from '../version';
import type { UiScale } from '../lib/density';
import PhoneDialog from './PhoneDialog';
import { getRole } from '../auth';
import { restartPhoneOnboarding } from '../lib/onboarding';
import { phoneDockItems } from './PhoneDock';
import { getScanPreference, setScanPreference, type ScanPreference } from './phoneScanPreferences';
import { REPO_CONTRIBUTORS, fetchRepoContributors, type Contributor } from '../lib/contributors';

export type PhonePreferenceProps = { theme: string; onTheme: (t: 'light' | 'dark' | 'system') => void; animations: boolean; onAnimations: (v: boolean) => void; compact: boolean; onCompact: (v: boolean) => void; scale: UiScale; onScale: (v: UiScale) => void; startTab: string; onStartTab: (path: string) => void };
function SettingSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="ph-setting-toggle"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} /></label>;
}
function ExternalSetting({ href, icon, title, description }: { href: string; icon: ReactNode; title: string; description: string }) {
  return <a className="ph-setting-link" href={href} target="_blank" rel="noopener noreferrer">{icon}<span><strong>{title}</strong><small>{description} · nouvel onglet</small></span><ExternalLink size={18} aria-hidden="true" /></a>;
}
export function PhoneAppearanceSettings({ theme, onTheme, animations, onAnimations, compact, onCompact, scale, onScale, startTab, onStartTab }: PhonePreferenceProps) {
  const [language, setLanguage] = useState(false);
  return <>
    <section className="ph-settings-card"><h2><Palette size={19} aria-hidden="true" /> Apparence et navigation</h2>
      <div className="ph-setting-block"><strong>Thème</strong><small>Choisissez l’apparence de l’application.</small><div className="ph-seg" role="group" aria-label="Thème de l’application">{([['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']] as const).map(([value, label]) => <button type="button" key={value} data-theme-toggle className={`theme-toggle${theme === value ? ' on' : ''}`} aria-pressed={theme === value} onClick={() => onTheme(value)}>{label}</button>)}</div></div>
      <button type="button" className="ph-setting-link" onClick={() => setLanguage(true)}><Globe size={20} aria-hidden="true" /><span><strong>Langue</strong><small>Français · arabe et anglais bientôt</small></span><ChevronRight size={18} aria-hidden="true" /></button>
      <div className="ph-setting-block"><strong>Taille du texte</strong><small>Adaptée aux préférences de votre navigateur.</small><div className="ph-seg" role="group" aria-label="Taille du texte">{([['sm', 'Petite'], ['md', 'Normale'], ['lg', 'Grande']] as const).map(([value, label]) => <button type="button" key={value} className={`theme-toggle${scale === value ? ' on' : ''}`} aria-pressed={scale === value} onClick={() => onScale(value)}>{label}</button>)}</div></div>
      <div className="ph-setting-block"><strong>Densité d’affichage</strong><small>Espacement des cartes sur mobile.</small><div className="ph-seg ph-seg--two" role="group" aria-label="Densité d’affichage"><button type="button" className={`theme-toggle${!compact ? ' on' : ''}`} aria-pressed={!compact} onClick={() => onCompact(false)}>Confort</button><button type="button" className={`theme-toggle${compact ? ' on' : ''}`} aria-pressed={compact} onClick={() => onCompact(true)}>Compact</button></div></div>
      <label className="ph-setting-block"><strong>Onglet d’ouverture au lancement</strong><small>Utilisé à l’ouverture de l’accueil mobile.</small><select aria-label="Onglet d’ouverture au lancement" value={phoneDockItems(getRole()).some(item => item.path === startTab) ? startTab : '/m'} onChange={e => onStartTab(e.target.value)}>{phoneDockItems(getRole()).map(item => <option key={item.id} value={item.path}>{item.label}</option>)}</select></label>
      <SettingSwitch title="Animations fluides" description="Transitions et effets de mouvement." checked={animations} onChange={onAnimations} />
      <p className="ph-settings-hint">Le navigateur respecte aussi la préférence système de réduction des animations.</p>
    </section>
    {language && <PhoneDialog titleId="ph-language-title" onClose={() => setLanguage(false)}><h2 id="ph-language-title">Langue</h2><p>Bientôt disponible — l’arabe et l’anglais arrivent.</p><button type="button" className="ph-primary" onClick={() => setLanguage(false)}>Compris</button></PhoneDialog>}
  </>;
}
export default function PhoneSettings({ theme, onTheme, animations, onAnimations, compact, onCompact, scale, onScale, startTab, onStartTab }: PhonePreferenceProps) {
  const nav = useNavigate();
  const [scan, setScan] = useState(() => ({ autoCamera: getScanPreference('autoCamera'), vibrate: getScanPreference('vibrate'), sound: getScanPreference('sound') }));
  const [scanNotice, setScanNotice] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [contributors, setContributors] = useState<Contributor[]>(REPO_CONTRIBUTORS);
  useEffect(() => {
    let alive = true;
    fetchRepoContributors().then((list) => {
      if (alive) setContributors(list);
    });
    return () => { alive = false; };
  }, []);
  const updateScan = (key: ScanPreference, value: boolean) => {
    if (!setScanPreference(key, value)) { setScanNotice('Impossible de sauvegarder cette préférence dans ce navigateur.'); return; }
    setScanNotice(''); setScan(current => ({ ...current, [key]: value }));
  };
  const share = async () => {
    const url = `${window.location.origin}/m`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Atlas Commerce', url }); setShareNotice(''); }
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setShareNotice('Lien copié.'); }
      else setShareNotice('Le partage n’est pas disponible dans ce navigateur.');
    } catch (error) { if ((error as Error)?.name !== 'AbortError') setShareNotice('Impossible de partager le lien.'); }
  };
  return <div className="ph-settings ph-native-settings">
    <div className="ph-settings-intro"><span className="ph-settings-intro-icon"><Palette size={22} aria-hidden="true" /></span><div><strong>À votre façon</strong><p>Personnalisez Atlas sur cet appareil.</p></div></div>
    <PhoneAppearanceSettings theme={theme} onTheme={onTheme} animations={animations} onAnimations={onAnimations} compact={compact} onCompact={onCompact} scale={scale} onScale={onScale} startTab={startTab} onStartTab={onStartTab} />
    <section className="ph-settings-card"><h2><Camera size={19} aria-hidden="true" /> Caméra et scanner</h2>
      <SettingSwitch title="Ouvrir la caméra automatiquement" description="Au lancement du scanner produit ou QR appareil. Le navigateur peut demander l’autorisation." checked={scan.autoCamera} onChange={v => updateScan('autoCamera', v)} />
      <SettingSwitch title="Vibration au scan" description="Après la lecture d’un code compatible, si l’appareil le permet." checked={scan.vibrate} onChange={v => updateScan('vibrate', v)} />
      <SettingSwitch title="Signal sonore au scan" description="Un court son après la lecture. Selon les règles audio du navigateur." checked={scan.sound} onChange={v => updateScan('sound', v)} />
      <p className="ph-settings-hint">Ces préférences restent dans ce navigateur. Vous pouvez toujours arrêter la caméra depuis le scanner.</p>{scanNotice && <p role="status" className="ph-settings-notice">{scanNotice}</p>}
    </section>
    <section className="ph-settings-card"><h2><Smartphone size={19} aria-hidden="true" /> Application</h2><div className="ph-settings-row"><span>Version web</span><strong>{DISPLAY_VERSION}</strong></div><button type="button" className="ph-setting-link" onClick={() => nav('/m/settings/whats-new')}><RefreshCw size={20} aria-hidden="true" /><span><strong>Nouveautés des versions</strong><small>Historique des changements publiés sur le web</small></span><ChevronRight size={18} aria-hidden="true" /></button><button type="button" className="ph-setting-link ph-setting-tour" onClick={() => { restartPhoneOnboarding(); nav('/m'); }}><Compass size={20} aria-hidden="true" /><span><strong>Visite guidée</strong><small>Revoir la démonstration : rien n’est ajouté à vos données</small></span><ChevronRight size={18} aria-hidden="true" /></button><button type="button" className="ph-setting-link" onClick={() => void share()}><Share2 size={20} aria-hidden="true" /><span><strong>Partager Atlas Commerce</strong><small>Partager ou copier le lien de l’application</small></span><ChevronRight size={18} aria-hidden="true" /></button>{shareNotice && <p role="status" className="ph-settings-notice">{shareNotice}</p>}</section>
    <section className="ph-settings-card"><h2><Info size={19} aria-hidden="true" /> Informations et aide</h2>
      <ExternalSetting href="/about" icon={<Info size={20} aria-hidden="true" />} title="À propos et assistance" description="Informations sur le projet et aide" />
      <ExternalSetting href="/privacy" icon={<FileText size={20} aria-hidden="true" />} title="Confidentialité" description="Politique de confidentialité" />
      <ExternalSetting href="/terms" icon={<FileText size={20} aria-hidden="true" />} title="Conditions d’utilisation" description="Conditions du service" />
      <ExternalSetting href="/licenses" icon={<FileText size={20} aria-hidden="true" />} title="Licences open source" description="Logiciels et licences" />
    </section>
    <section className="ph-settings-card wn-thanks-card" aria-label="Remerciements et contributeurs">
      <h2><Users size={19} aria-hidden="true" /> Remerciements &amp; contributeurs</h2>
      <p className="wn-thanks-sub">Merci à toutes les personnes qui contribuent à Atlas Commerce :</p>
      <div className="wn-contributors">
        {contributors.map((c, idx) => (
          <a
            key={c.login}
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="wn-contributor-pill"
            style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
            title={`${c.name} — ${c.role}`}
          >
            {c.avatarUrl ? <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" /> : <span className="wn-contributor-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>}
            <span className="wn-contributor-name">{c.name !== c.login ? `${c.name} (${c.handle})` : c.handle}</span>
          </a>
        ))}
      </div>
      <div className="wn-release-contributors">
        <span className="wn-contributors-label"><Heart size={13} strokeWidth={2.2} aria-hidden="true" /> Merci à</span>
        <span className="wn-thanks-sub" style={{ margin: 0 }}>l’équipe et aux contributeurs · voir chaque version dans Nouveautés</span>
      </div>
    </section>
  </div>;
}
