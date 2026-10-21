import { useEffect, useRef, useState, type FC } from 'react';
import { LogOut, Sparkles, Settings, Sun, Moon, Monitor, Info } from 'lucide-react';
import { hasAvatarUrl } from '../../auth';
import { AvatarImage } from '../ui/AvatarImage';

type Props = {
  displayName: string;
  roleLabel: string;
  initials: string;
  onLogout: () => void;
};

/** Top-bar account menu — no react-router hooks (avoids dual-router context crash). */
export const TopbarUserMenu: FC<Props> = ({
  displayName,
  roleLabel,
  initials,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('atlas-overlay-open');
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('atlas-overlay-open');
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    window.location.assign(path);
  };

  return (
    <div className="ac-topbar-user-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ac-topbar-user-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {hasAvatarUrl() ? (
          <AvatarImage className="ac-topbar-avatar" loading="lazy" />
        ) : (
          <span className="ac-topbar-avatar ac-topbar-avatar--ini">{initials}</span>
        )}
      </button>
      {open && (
        <>
          <div className="ac-topbar-menu-backdrop" role="presentation" aria-hidden onClick={() => setOpen(false)} />
          <div className="ac-user-dropdown" role="menu">
            <div className="ac-user-dropdown-head">
              <p className="ac-user-dropdown-hello">Bonjour</p>
              <p className="ac-user-dropdown-name">{displayName}</p>
              <p className="ac-user-dropdown-role">{roleLabel}</p>
            </div>
            <div className="ac-user-dropdown-list">
              <button type="button" role="menuitem" className="ac-user-dropdown-item secondary" onClick={() => go('/settings')}>
                <Settings className="ac-user-dropdown-ico" size={16} />
                <span><b>Paramètres</b><i>Compte et préférences</i></span>
              </button>
              <button type="button" role="menuitem" className="ac-user-dropdown-item secondary" onClick={() => go('/whats-new')}>
                <Sparkles className="ac-user-dropdown-ico" size={16} />
                <span><b>Nouveautés</b><i>Journal des versions</i></span>
              </button>
              <button type="button" role="menuitem" className="ac-user-dropdown-item secondary" onClick={() => go('/about')}>
                <Info className="ac-user-dropdown-ico" size={16} />
                <span><b>À propos</b><i>Version et légal</i></span>
              </button>
              <button type="button" role="menuitem" className="ac-user-dropdown-item ac-user-dropdown-logout secondary" onClick={() => { setOpen(false); onLogout(); }}>
                <LogOut className="ac-user-dropdown-ico" size={16} />
                <span><b>Déconnexion</b><i>Terminer la session</i></span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TopbarUserMenu;
