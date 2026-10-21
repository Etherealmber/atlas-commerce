import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Sparkles, Settings, Info } from 'lucide-react';
import { AvatarImage } from '../ui/AvatarImage';

type Props = {
  displayName: string;
  roleLabel: string;
  initials: string;
  onLogout: () => void;
};

/** Top-bar account menu — portalled to <body> so no ancestor can clip,
 *  stack under page content or reposition it (v242 fix). */
export const TopbarUserMenu: FC<Props> = ({
  displayName,
  roleLabel,
  initials,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('atlas-overlay-open');
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
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

  // Pin the dropdown under the trigger, clamped to the viewport.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 288;
      const right = Math.min(
        Math.max(window.innerWidth - r.right, 8),
        Math.max(window.innerWidth - width - 8, 8),
      );
      const top = Math.min(r.bottom + 8, Math.max(window.innerHeight - 120, 8));
      setPos({ top, right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    window.location.assign(path);
  };

  const avatarFallback = (
    <span className="ac-topbar-avatar ac-topbar-avatar--ini">{initials}</span>
  );

  return (
    <div className="ac-topbar-user-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ac-topbar-user-btn"
        ref={btnRef}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <AvatarImage className="ac-topbar-avatar" loading="lazy" fallback={avatarFallback} />
      </button>
      {open &&
        createPortal(
          <>
            <div
              className="ac-topbar-menu-backdrop"
              role="presentation"
              aria-hidden
              style={{ zIndex: 1195 }}
              onClick={() => setOpen(false)}
            />
            <div
              className="ac-user-dropdown"
              role="menu"
              ref={menuRef}
              style={{
                position: 'fixed',
                top: pos?.top ?? -9999,
                right: pos?.right ?? 8,
                zIndex: 1200,
              }}
            >
              <div className="ac-user-dropdown-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AvatarImage className="ac-topbar-avatar" fallback={avatarFallback} />
                  <div style={{ minWidth: 0 }}>
                    <p className="ac-user-dropdown-hello">Bonjour</p>
                    <p className="ac-user-dropdown-name">{displayName}</p>
                    <p className="ac-user-dropdown-role">{roleLabel}</p>
                  </div>
                </div>
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
          </>,
          document.body,
        )}
    </div>
  );
};

export default TopbarUserMenu;
