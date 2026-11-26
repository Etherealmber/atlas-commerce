import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Sparkles, Settings, Info, Plus, ChevronRight, LayoutDashboard, Languages } from 'lucide-react';
import { LanguageSoonDialog } from '../LanguageSoonDialog';
import { langMeta, useLang } from '../../i18n/core';
import { ConfirmDialog } from '../ConfirmDialog';
import { AvatarImage } from '../ui/AvatarImage';
import { listSavedAccounts, switchSavedAccount, getUsername, clearToken, type SavedAccount } from '../../auth';

type Props = {
  displayName: string;
  roleLabel: string;
  initials: string;
  onLogout: () => void;
  showDashboardLink?: boolean;
};

/** Top-bar account menu — portalled to <body> so no ancestor can clip,
 *  stack under page content or reposition it (v242 fix). */
export const TopbarUserMenu: FC<Props> = ({
  displayName,
  roleLabel,
  initials,
  onLogout,
  showDashboardLink = false,
}) => {
  const navigate = useNavigate();
  const pathname = useLocation().pathname.replace(/\/+$/, '') || '/';
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const uiLang = useLang();
  const [logoutAsk, setLogoutAsk] = useState(false);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setAccounts(listSavedAccounts());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('atlas-overlay-open');
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
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

  // Pin the dropdown neatly beneath the floating dock (or trigger), clamped to the viewport.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const dock = btnRef.current?.closest('.ac-desktop-dock');
      const dockRect = dock && window.innerWidth > 900 ? dock.getBoundingClientRect() : null;
      const width = Math.min(296, window.innerWidth - 16);
      const anchorRight = dockRect ? dockRect.right : r.right;
      const anchorBottom = dockRect ? dockRect.bottom : r.bottom;
      const right = Math.min(
        Math.max(window.innerWidth - anchorRight, 8),
        Math.max(window.innerWidth - width - 8, 8),
      );
      const top = Math.min(anchorBottom + 10, Math.max(window.innerHeight - 140, 8));
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
    navigate(path);
  };

  const avatarFallback = (
    <span className="ac-topbar-avatar ac-topbar-avatar--ini">{initials}</span>
  );
  const currentUsername = getUsername().toLowerCase();
  const otherAccounts = accounts.filter((a) => a.username.toLowerCase() !== currentUsername);

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
        <AvatarImage className="ac-topbar-avatar" loading="eager" fallback={avatarFallback} />
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
                <div className="ac-user-dropdown-identity">
                  <AvatarImage className="ac-topbar-avatar ac-user-dropdown-avatar" fallback={avatarFallback} />
                  <div className="ac-user-dropdown-meta">
                    <p className="ac-user-dropdown-hello">Bonjour</p>
                    <p className="ac-user-dropdown-name">{displayName}</p>
                    <p className="ac-user-dropdown-role">{roleLabel}</p>
                  </div>
                </div>
              </div>
              {otherAccounts.length > 0 && (
                <div className="ac-user-dropdown-list ac-user-dropdown-accounts">
                  <p className="ac-user-dropdown-label">Comptes enregistrés</p>
                  {otherAccounts.map((a) => (
                    <button
                      key={a.username}
                      type="button"
                      role="menuitem"
                      className="ac-user-dropdown-item"
                      onClick={() => switchSavedAccount(a.username)}
                    >
                      <span className="ac-user-dropdown-ico ac-user-dropdown-ico--avatar" aria-hidden>
                        {(a.display_name || a.username).slice(0, 2).toUpperCase()}
                      </span>
                      <span><b>{a.display_name || a.username}</b><i>@{a.username} · Basculer</i></span>
                      <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                    </button>
                  ))}
                </div>
              )}
              <div className="ac-user-dropdown-list">
                {showDashboardLink && pathname !== '/dashboard' && (
                  <button
                    type="button"
                    role="menuitem"
                    className="ac-user-dropdown-item"
                    onClick={() => go('/dashboard')}
                  >
                    <span className="ac-user-dropdown-ico" aria-hidden>
                      <LayoutDashboard size={16} strokeWidth={1.9} />
                    </span>
                    <span><b>Tableau de bord</b><i>Ouvrir l’espace de travail</i></span>
                    <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="ac-user-dropdown-item"
                  onClick={() => { setOpen(false); clearToken(); window.location.assign('/login'); }}
                >
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <Plus size={16} strokeWidth={2} />
                  </span>
                  <span><b>Ajouter un compte</b><i>Se connecter avec un autre compte</i></span>
                  <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                </button>
                <div className="ac-user-dropdown-sep" role="separator" />
                {pathname !== '/settings' && <button type="button" role="menuitem" className="ac-user-dropdown-item" onClick={() => go('/settings')}>
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <Settings size={16} strokeWidth={1.9} />
                  </span>
                  <span><b>Paramètres</b><i>Compte et préférences</i></span>
                  <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                </button>}
                <button
                  type="button"
                  role="menuitem"
                  className="ac-user-dropdown-item ac-user-dropdown-lang"
                  onClick={() => { setOpen(false); setLangOpen(true); }}
                >
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <Languages size={16} strokeWidth={1.9} />
                  </span>
                  <span><b>Langue</b><i className="notranslate" lang={uiLang} dir={langMeta(uiLang).dir}>{langMeta(uiLang).native}</i></span>
                  <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                </button>
                {pathname !== '/whats-new' && <button type="button" role="menuitem" className="ac-user-dropdown-item" onClick={() => go('/whats-new')}>
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <Sparkles size={16} strokeWidth={1.9} />
                  </span>
                  <span><b>Nouveautés</b><i>Journal des versions</i></span>
                  <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                </button>}
                {pathname !== '/about' && <button type="button" role="menuitem" className="ac-user-dropdown-item" onClick={() => go('/about')}>
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <Info size={16} strokeWidth={1.9} />
                  </span>
                  <span><b>À propos</b><i>Version et légal</i></span>
                  <ChevronRight className="ac-user-dropdown-chev" size={14} aria-hidden />
                </button>}
                <div className="ac-user-dropdown-sep" role="separator" />
                <button type="button" role="menuitem" className="ac-user-dropdown-item ac-user-dropdown-item--danger ac-user-dropdown-logout" onClick={() => { setOpen(false); setLogoutAsk(true); }}>
                  <span className="ac-user-dropdown-ico" aria-hidden>
                    <LogOut size={16} strokeWidth={1.9} />
                  </span>
                  <span><b>Déconnexion</b><i>Terminer la session</i></span>
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
      <LanguageSoonDialog open={langOpen} onClose={() => setLangOpen(false)} />
      <ConfirmDialog
        open={logoutAsk}
        title="Se déconnecter ?"
        message="La session actuelle sera fermée. Les données du serveur ne seront pas supprimées."
        confirmLabel="Se déconnecter"
        icon={<LogOut size={17} strokeWidth={1.9} />}
        onCancel={() => setLogoutAsk(false)}
        onConfirm={() => { setLogoutAsk(false); onLogout(); }}
      />
    </div>
  );
};

export default TopbarUserMenu;
