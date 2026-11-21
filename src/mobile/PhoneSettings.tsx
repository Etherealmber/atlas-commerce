import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Globe, Palette, Sparkles } from 'lucide-react';
import { DISPLAY_VERSION } from '../version';
import type { UiScale } from '../lib/density';
import PhoneDialog from './PhoneDialog';
import { getRole } from '../auth';
import { phoneDockItems } from './PhoneDock';

type Props = { theme: string; onTheme: (t: 'light' | 'dark' | 'system') => void; animations: boolean; onAnimations: (v: boolean) => void; compact: boolean; onCompact: (v: boolean) => void; scale: UiScale; onScale: (v: UiScale) => void; startTab: string; onStartTab: (path: string) => void };
export default function PhoneSettings({ theme, onTheme, animations, onAnimations, compact, onCompact, scale, onScale, startTab, onStartTab }: Props) {
  const nav = useNavigate(); const [language, setLanguage] = useState(false);
  return <div className="ph-settings ph-native-settings">
    <p className="ph-settings-lead">Personnalisez votre expérience sur cet appareil.</p>
    <section className="ph-settings-card"><h2><Palette size={19} /> Apparence, navigation &amp; animations</h2>
      <div className="ph-setting-block"><strong>Thème</strong><small>Choisissez l’apparence de l’application.</small><div className="ph-seg" role="group" aria-label="Thème de l’application">{([['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']] as const).map(([value, label]) => <button type="button" key={value} className={`theme-toggle${theme === value ? ' on' : ''}`} aria-pressed={theme === value} onClick={() => onTheme(value)}>{label}</button>)}</div></div>
      <button type="button" className="ph-setting-link" onClick={() => setLanguage(true)}><Globe size={20} /><span><strong>Langue</strong><small>Français · autres langues bientôt disponibles</small></span><ChevronRight size={18} /></button>
      <div className="ph-setting-block"><strong>Taille du texte</strong><small>Adaptée aux préférences de votre navigateur.</small><div className="ph-seg" role="group" aria-label="Taille du texte">{([['sm', 'Petite'], ['md', 'Normale'], ['lg', 'Grande']] as const).map(([value, label]) => <button type="button" key={value} className={`theme-toggle${scale === value ? ' on' : ''}`} aria-pressed={scale === value} onClick={() => onScale(value)}>{label}</button>)}</div></div>
      <div className="ph-setting-block"><strong>Densité d’affichage</strong><small>Espacement des cartes sur mobile.</small><div className="ph-seg" role="group" aria-label="Densité d’affichage"><button type="button" className={`theme-toggle${!compact ? ' on' : ''}`} aria-pressed={!compact} onClick={() => onCompact(false)}>Confort</button><button type="button" className={`theme-toggle${compact ? ' on' : ''}`} aria-pressed={compact} onClick={() => onCompact(true)}>Compact</button></div></div>
      <label className="ph-setting-block"><strong>Onglet d’ouverture au lancement</strong><small>Utilisé à l’ouverture de l’accueil mobile.</small><select aria-label="Onglet d’ouverture au lancement" value={phoneDockItems(getRole()).some(item => item.path === startTab) ? startTab : '/m'} onChange={e => onStartTab(e.target.value)}>{phoneDockItems(getRole()).map(item => <option key={item.id} value={item.path}>{item.label}</option>)}</select></label>
      <label className="ph-setting-toggle"><span><strong>Animations fluides</strong><small>Transitions et effets de mouvement.</small></span><input type="checkbox" checked={animations} onChange={e => onAnimations(e.target.checked)} /></label>
      <p className="ph-settings-hint">Le navigateur respecte aussi la préférence système de réduction des animations.</p>
    </section>
    <section className="ph-settings-card"><h2><Sparkles size={19} /> Application</h2><div className="ph-settings-row"><span>Version web</span><strong>{DISPLAY_VERSION}</strong></div><button type="button" className="ph-setting-link" onClick={() => nav('/m/settings/whats-new')}><Sparkles size={20} /><span><strong>Nouveautés des versions</strong><small>Historique des changements publiés sur le web</small></span><ChevronRight size={18} /></button></section>
    {language && <PhoneDialog titleId="ph-language-title" onClose={() => setLanguage(false)}><h2 id="ph-language-title">Langue</h2><p>Les autres langues arrivent bientôt sur la version web.</p><button type="button" className="ph-primary" onClick={() => setLanguage(false)}>Compris</button></PhoneDialog>}
  </div>;
}
