import { useEffect, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Boxes,
  Bug,
  Building2,
  Check,
  Clock,
  Cookie,
  Compass,
  FileCheck2,
  FileText,
  Filter,
  Github,
  Info,
  Layers,
  Link2,
  ListFilter,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Scale,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  User,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react';
import {
  canAccessAdminSettings,
  canAccessCompanySettings,
  isLoggedIn,
} from '../auth';
import { openConsentSettings } from '../lib/cookieConsent';
import { resetWelcome } from '../lib/welcome';
import { hasUnreadWhatsNew } from '../lib/whatsNew';

type IconCmp = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;

type FocusItem = {
  id: string;
  label: string;
  icon: IconCmp;
  active?: boolean;
  badge?: string;
  badgeTone?: 'accent' | 'neutral' | 'alert';
  dot?: boolean;
  onClick: () => void;
};

type FocusGroup = {
  id: string;
  title?: string;
  titleIcon?: IconCmp;
  items: FocusItem[];
};

type FocusSidebarProps = {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  /** True when user is inside authenticated DesktopShell */
  authenticated?: boolean;
};

const STORAGE_KEY = 'atlas-focus-sidebar-collapsed';

function scrollToAnchor(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export default function FocusSidebar({
  mobileOpen = false,
  onCloseMobile,
  authenticated,
}: FocusSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const loggedIn = authenticated ?? (typeof isLoggedIn === 'function' ? isLoggedIn() : false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [copiedLink, setCopiedLink] = useState(false);
  const [whatsNewUnread, setWhatsNewUnread] = useState(() => hasUnreadWhatsNew());

  useEffect(() => {
    const sync = () => setWhatsNewUnread(hasUnreadWhatsNew());
    window.addEventListener('atlas-whats-new-sync', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('atlas-whats-new-sync', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch { /* ignore */ }
  }, [collapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  const isSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
  const isWhatsNew = location.pathname === '/whats-new';
  const isAbout = location.pathname === '/about';

  const searchParams = new URLSearchParams(location.search);
  const settingsTab = searchParams.get('tab') || 'profile';
  const wnFilter = searchParams.get('f') || 'all';

  const canCompany = typeof canAccessCompanySettings === 'function' ? canAccessCompanySettings() : false;
  const canAdmin = typeof canAccessAdminSettings === 'function' ? canAccessAdminSettings() : false;

  const go = (to: string, opts?: { hard?: boolean }) => {
    onCloseMobile?.();
    if (opts?.hard) {
      window.location.assign(to);
      return;
    }
    navigate(to);
  };

  let sidebarTitle = 'Navigation';
  let groups: FocusGroup[] = [];

  if (isSettings) {
    sidebarTitle = 'Paramètres';
    const accountItems: FocusItem[] = [
      {
        id: 'profile',
        label: 'Mon profil',
        icon: User,
        active: settingsTab === 'profile',
        onClick: () => go('/settings?tab=profile'),
      },
    ];
    if (canCompany) {
      accountItems.push(
        {
          id: 'company',
          label: 'Société',
          icon: Building2,
          active: settingsTab === 'company',
          onClick: () => go('/settings?tab=company'),
        },
        {
          id: 'attendance',
          label: 'Présence',
          icon: Clock,
          active: settingsTab === 'attendance',
          onClick: () => go('/settings?tab=attendance'),
        },
      );
    }

    const opsItems: FocusItem[] = canCompany
      ? [
          {
            id: 'invoicing',
            label: 'Facturation',
            icon: Receipt,
            active: settingsTab === 'invoicing',
            onClick: () => go('/settings?tab=invoicing'),
          },
          {
            id: 'legal',
            label: 'Légal & TVA',
            icon: Scale,
            active: settingsTab === 'legal',
            onClick: () => go('/settings?tab=legal'),
          },
          {
            id: 'documents',
            label: 'Documents PDF',
            icon: FileText,
            active: settingsTab === 'documents',
            onClick: () => go('/settings?tab=documents'),
          },
          {
            id: 'warehouse',
            label: 'Entrepôts',
            icon: Warehouse,
            active: settingsTab === 'warehouse',
            onClick: () => go('/settings?tab=warehouse'),
          },
          {
            id: 'categories',
            label: 'Catégories',
            icon: Tag,
            active: settingsTab === 'categories',
            onClick: () => go('/settings?tab=categories'),
          },
        ]
      : [];

    const sysItems: FocusItem[] = [
      {
        id: 'agent',
        label: 'Atlas Agent',
        icon: Bot,
        active: settingsTab === 'agent',
        badge: 'IA',
        badgeTone: 'accent',
        onClick: () => go('/settings?tab=agent'),
      },
    ];
    if (canAdmin) {
      sysItems.push(
        {
          id: 'integrations',
          label: 'API & Clés',
          icon: Link2,
          active: settingsTab === 'integrations',
          onClick: () => go('/settings?tab=integrations'),
        },
        {
          id: 'app',
          label: 'Mise à jour app',
          icon: Smartphone,
          active: settingsTab === 'app',
          onClick: () => go('/settings?tab=app'),
        },
        {
          id: 'admin',
          label: 'Administration',
          icon: SettingsIcon,
          active: settingsTab === 'admin',
          onClick: () => go('/settings?tab=admin'),
        },
        {
          id: 'audit',
          label: 'Journal d’audit',
          icon: ShieldCheck,
          active: settingsTab === 'audit',
          onClick: () => go('/settings?tab=audit'),
        },
      );
    }

    groups = [
      { id: 'account', title: 'Compte & Société', items: accountItems },
      ...(opsItems.length ? [{ id: 'ops', title: 'Facturation & Stock', items: opsItems }] : []),
      { id: 'system', title: 'Système & IA', items: sysItems },
    ];
  } else if (isWhatsNew) {
    sidebarTitle = 'Nouveautés';
    groups = [
      {
        id: 'wn-filters',
        title: 'Filtrer le journal',
        titleIcon: Filter,
        items: [
          {
            id: 'all',
            label: 'Tout afficher',
            icon: ListFilter,
            active: wnFilter === 'all',
            onClick: () => go('/whats-new'),
          },
          {
            id: 'added',
            label: 'Ajouté',
            icon: Plus,
            active: wnFilter === 'added',
            onClick: () => go('/whats-new?f=added'),
          },
          {
            id: 'improved',
            label: 'Amélioré',
            icon: TrendingUp,
            active: wnFilter === 'improved',
            onClick: () => go('/whats-new?f=improved'),
          },
          {
            id: 'fixed',
            label: 'Corrigé',
            icon: Wrench,
            active: wnFilter === 'fixed',
            onClick: () => go('/whats-new?f=fixed'),
          },
        ],
      },
      {
        id: 'wn-actions',
        title: 'Partage',
        items: [
          {
            id: 'copy-link',
            label: copiedLink ? 'Lien copié !' : 'Copier le lien',
            icon: copiedLink ? Check : Link2,
            active: copiedLink,
            badge: copiedLink ? 'OK' : undefined,
            badgeTone: 'accent',
            onClick: async () => {
              try {
                await navigator.clipboard?.writeText(window.location.href);
                setCopiedLink(true);
                window.setTimeout(() => setCopiedLink(false), 1600);
              } catch { /* ignore */ }
              onCloseMobile?.();
            },
          },
        ],
      },
    ];
  } else if (isAbout) {
    sidebarTitle = 'À propos';
    const sectionItems: FocusItem[] = [
      {
        id: 'overview',
        label: 'Présentation',
        icon: Layers,
        active: true,
        onClick: () => {
          onCloseMobile?.();
          scrollToAnchor('about-overview');
        },
      },
    ];
    if (loggedIn) {
      sectionItems.push({
        id: 'signaler',
        label: 'Signaler un bug',
        icon: Bug,
        onClick: () => {
          onCloseMobile?.();
          scrollToAnchor('signaler');
        },
      });
    }
    sectionItems.push(
      {
        id: 'features',
        label: 'Fonctionnalités',
        icon: Boxes,
        onClick: () => {
          onCloseMobile?.();
          scrollToAnchor('about-features');
        },
      },
      {
        id: 'creator',
        label: 'Créateur & Équipe',
        icon: Users,
        onClick: () => {
          onCloseMobile?.();
          scrollToAnchor('about-creator');
        },
      },
      {
        id: 'projects',
        label: 'Dépôts & Projets',
        icon: Github,
        onClick: () => {
          onCloseMobile?.();
          scrollToAnchor('about-projects');
        },
      },
    );

    const legalItems: FocusItem[] = [
      {
        id: 'privacy',
        label: 'Confidentialité',
        icon: Shield,
        onClick: () => go('/privacy'),
      },
      {
        id: 'terms',
        label: 'Conditions',
        icon: FileCheck2,
        onClick: () => go('/terms'),
      },
      {
        id: 'cookies',
        label: 'Cookies',
        icon: Cookie,
        onClick: () => {
          onCloseMobile?.();
          openConsentSettings();
        },
      },
    ];
    if (loggedIn) {
      legalItems.push({
        id: 'welcome',
        label: 'Guide d’accueil',
        icon: Compass,
        onClick: () => {
          onCloseMobile?.();
          resetWelcome();
          window.location.assign('/welcome');
        },
      });
    }

    groups = [
      { id: 'about-sections', title: 'Sur cette page', items: sectionItems },
      { id: 'about-legal', title: 'Légal & Confidentialité', items: legalItems },
    ];
  }

  const footerItems: FocusItem[] = [];
  if (!isWhatsNew) {
    footerItems.push({
      id: 'go-whats-new',
      label: 'Nouveautés',
      icon: Sparkles,
      dot: whatsNewUnread,
      badge: whatsNewUnread ? '1' : undefined,
      badgeTone: 'alert',
      onClick: () => go('/whats-new', { hard: !loggedIn }),
    });
  }
  if (!isAbout) {
    footerItems.push({
      id: 'go-about',
      label: 'À propos',
      icon: Info,
      onClick: () => go('/about', { hard: !loggedIn }),
    });
  }
  if (loggedIn && !isSettings) {
    footerItems.push({
      id: 'go-settings',
      label: 'Paramètres',
      icon: SettingsIcon,
      onClick: () => go('/settings'),
    });
  }
  if (loggedIn) {
    footerItems.push({
      id: 'go-dashboard',
      label: 'Tableau de bord',
      icon: ArrowLeft,
      onClick: () => go('/dashboard'),
    });
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="atlas-focus-backdrop"
          aria-label="Fermer le menu"
          onClick={() => onCloseMobile?.()}
        />
      )}
      <aside
        className={`atlas-focus-sidebar${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}
        aria-label={`Navigation ${sidebarTitle}`}
      >
        <div className="atlas-focus-sidebar-head">
          <button
            type="button"
            className="atlas-focus-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}
            aria-label={collapsed ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={17} strokeWidth={1.9} /> : <PanelLeftClose size={17} strokeWidth={1.9} />}
          </button>
          {!collapsed && <span className="atlas-focus-sidebar-title">{sidebarTitle}</span>}
        </div>

        <div className="atlas-focus-sidebar-scroll">
          {groups.map((group, gi) => {
            const TitleIcon = group.titleIcon;
            return (
              <div key={group.id} className="atlas-focus-group">
                {gi > 0 && <div className="atlas-focus-divider" aria-hidden />}
                {!collapsed && group.title && (
                  <div className="atlas-focus-group-label">
                    <span>{group.title}</span>
                    {TitleIcon ? <TitleIcon size={13} strokeWidth={1.9} aria-hidden /> : null}
                  </div>
                )}
                <div className="atlas-focus-group-items">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`atlas-focus-nav-item${item.active ? ' is-active' : ''}`}
                        aria-current={item.active ? 'page' : undefined}
                        title={item.label}
                        data-tooltip={collapsed ? item.label : undefined}
                        onClick={item.onClick}
                      >
                        <span className="atlas-focus-nav-ico">
                          <Icon size={17} strokeWidth={1.9} aria-hidden />
                        </span>
                        {!collapsed && <span className="atlas-focus-nav-label">{item.label}</span>}
                        {!collapsed && item.badge ? (
                          <span className={`atlas-focus-badge atlas-focus-badge--${item.badgeTone || 'neutral'}`}>
                            {item.badge}
                          </span>
                        ) : null}
                        {item.dot && collapsed ? <span className="atlas-focus-dot" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {footerItems.length > 0 && (
          <div className="atlas-focus-sidebar-foot">
            <div className="atlas-focus-divider" aria-hidden />
            <div className="atlas-focus-group-items">
              {footerItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="atlas-focus-nav-item atlas-focus-nav-item--foot"
                    title={item.label}
                    data-tooltip={collapsed ? item.label : undefined}
                    onClick={item.onClick}
                  >
                    <span className="atlas-focus-nav-ico">
                      <Icon size={17} strokeWidth={1.9} aria-hidden />
                    </span>
                    {!collapsed && <span className="atlas-focus-nav-label">{item.label}</span>}
                    {!collapsed && item.badge ? (
                      <span className={`atlas-focus-badge atlas-focus-badge--${item.badgeTone || 'neutral'}`}>
                        {item.badge}
                      </span>
                    ) : null}
                    {item.dot && collapsed ? <span className="atlas-focus-dot" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
