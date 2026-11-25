import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BellRing,
  Bot,
  Boxes,
  BookOpen,
  Bug,
  Building2,
  Check,
  Clock,
  Coins,
  Cookie,
  Compass,
  FileCheck2,
  FileText,
  Filter,
  Github,
  Info,
  Layers,
  LifeBuoy,
  Link2,
  ListFilter,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  RefreshCw,
  Scale,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
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
  onOpenMobile?: () => void;
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
  onOpenMobile,
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
  const isPrivacy = location.pathname === '/privacy';
  const isTerms = location.pathname === '/terms';
  const isLicenses = location.pathname === '/licenses';
  const isLegal = isPrivacy || isTerms || isLicenses;

  const searchParams = new URLSearchParams(location.search);
  const urlSettingsTab = searchParams.get('tab') || 'profile';
  const [pendingSettingsTab, setPendingSettingsTab] = useState<string | null>(null);
  const settingsTab = pendingSettingsTab ?? urlSettingsTab;
  const wnFilter = searchParams.get('f') || 'all';

  const [activeAboutSection, setActiveAboutSection] = useState<string>('overview');
  const aboutClickLockRef = useRef<{ key: string; until: number } | null>(null);

  useEffect(() => {
    setPendingSettingsTab(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isAbout || typeof window === 'undefined') return;
    const ids: Array<{ key: string; elId: string }> = [
      { key: 'overview', elId: 'about-overview' },
      ...(loggedIn ? [{ key: 'signaler', elId: 'signaler' }] : []),
      { key: 'features', elId: 'about-features' },
      { key: 'creator', elId: 'about-creator' },
      { key: 'projects', elId: 'about-projects' },
    ];
    const isNearScrollBottom = (target?: EventTarget | null) => {
      if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight + 8) {
        return target.scrollTop + target.clientHeight >= target.scrollHeight - 48;
      }
      const doc = document.documentElement;
      return window.innerHeight + window.scrollY >= doc.scrollHeight - 48;
    };
    const computeActive = (target?: EventTarget | null) => {
      const lock = aboutClickLockRef.current;
      if (lock && Date.now() < lock.until) {
        setActiveAboutSection((prev) => (prev === lock.key ? prev : lock.key));
        return;
      }
      aboutClickLockRef.current = null;
      const lastItem = ids[ids.length - 1];
      const lastEl = lastItem ? document.getElementById(lastItem.elId) : null;
      if (lastEl && (isNearScrollBottom(target) || lastEl.getBoundingClientRect().top <= Math.max(240, Math.round(window.innerHeight * 0.45)))) {
        setActiveAboutSection((prev) => (prev === lastItem.key ? prev : lastItem.key));
        return;
      }
      const threshold = Math.max(200, Math.round(window.innerHeight * 0.34));
      let current = 'overview';
      for (const item of ids) {
        const el = document.getElementById(item.elId);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) current = item.key;
      }
      setActiveAboutSection((prev) => (prev === current ? prev : current));
    };
    const onScroll = (e?: Event) => computeActive(e?.target);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    computeActive();
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [isAbout, loggedIn]);

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

  const goSettingsTab = (tab: string) => {
    setPendingSettingsTab(tab);
    go(`/settings?tab=${tab}`);
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
        onClick: () => goSettingsTab('profile'),
      },
    ];
    if (canCompany) {
      accountItems.push(
        {
          id: 'company',
          label: 'Société',
          icon: Building2,
          active: settingsTab === 'company',
          onClick: () => goSettingsTab('company'),
        },
        {
          id: 'attendance',
          label: 'Présence',
          icon: Clock,
          active: settingsTab === 'attendance',
          onClick: () => goSettingsTab('attendance'),
        },
      );
      if (canAdmin) {
        accountItems.push({
          id: 'payroll',
          label: 'Paie CNSS / AMO',
          icon: Coins,
          active: settingsTab === 'payroll',
          onClick: () => goSettingsTab('payroll'),
        });
      }
    }

    const opsItems: FocusItem[] = canCompany
      ? [
          {
            id: 'invoicing',
            label: 'Facturation',
            icon: Receipt,
            active: settingsTab === 'invoicing',
            onClick: () => goSettingsTab('invoicing'),
          },
          {
            id: 'legal',
            label: 'Légal & TVA',
            icon: Scale,
            active: settingsTab === 'legal',
            onClick: () => goSettingsTab('legal'),
          },
          {
            id: 'fec',
            label: 'Plan comptable (FEC)',
            icon: BookOpen,
            active: settingsTab === 'fec',
            onClick: () => goSettingsTab('fec'),
          },
          {
            id: 'dunning',
            label: 'Relances impayés',
            icon: BellRing,
            active: settingsTab === 'dunning',
            onClick: () => goSettingsTab('dunning'),
          },
          {
            id: 'documents',
            label: 'Documents PDF',
            icon: FileText,
            active: settingsTab === 'documents',
            onClick: () => goSettingsTab('documents'),
          },
          {
            id: 'warehouse',
            label: 'Entrepôts',
            icon: Warehouse,
            active: settingsTab === 'warehouse',
            onClick: () => goSettingsTab('warehouse'),
          },
          {
            id: 'categories',
            label: 'Catégories',
            icon: Tag,
            active: settingsTab === 'categories',
            onClick: () => goSettingsTab('categories'),
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
        onClick: () => goSettingsTab('agent'),
      },
    ];
    if (canAdmin) {
      sysItems.push(
        {
          id: 'integrations',
          label: 'API & Clés',
          icon: Link2,
          active: settingsTab === 'integrations',
          onClick: () => goSettingsTab('integrations'),
        },
        {
          id: 'app',
          label: 'Mise à jour app',
          icon: RefreshCw,
          active: settingsTab === 'app',
          onClick: () => goSettingsTab('app'),
        },
        {
          id: 'admin',
          label: 'Administration',
          icon: SettingsIcon,
          active: settingsTab === 'admin',
          onClick: () => goSettingsTab('admin'),
        },
        {
          id: 'audit',
          label: 'Journal d’audit',
          icon: ShieldCheck,
          active: settingsTab === 'audit',
          onClick: () => goSettingsTab('audit'),
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
    const selectAboutSection = (key: string, elId: string) => {
      aboutClickLockRef.current = { key, until: Date.now() + 650 };
      setActiveAboutSection(key);
      onCloseMobile?.();
      scrollToAnchor(elId);
    };
    const sectionItems: FocusItem[] = [
      {
        id: 'overview',
        label: 'Présentation',
        icon: Layers,
        active: activeAboutSection === 'overview',
        onClick: () => selectAboutSection('overview', 'about-overview'),
      },
    ];
    if (loggedIn) {
      sectionItems.push({
        id: 'signaler',
        label: 'Signaler un bug',
        icon: Bug,
        active: activeAboutSection === 'signaler',
        onClick: () => selectAboutSection('signaler', 'signaler'),
      });
    }
    sectionItems.push(
      {
        id: 'features',
        label: 'Fonctionnalités',
        icon: Boxes,
        active: activeAboutSection === 'features',
        onClick: () => selectAboutSection('features', 'about-features'),
      },
      {
        id: 'creator',
        label: 'Créateur & Équipe',
        icon: Users,
        active: activeAboutSection === 'creator',
        onClick: () => selectAboutSection('creator', 'about-creator'),
      },
      {
        id: 'projects',
        label: 'Dépôts & Projets',
        icon: Github,
        active: activeAboutSection === 'projects',
        onClick: () => selectAboutSection('projects', 'about-projects'),
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
        id: 'licenses',
        label: 'Licences',
        icon: Scale,
        onClick: () => go('/licenses'),
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
  } else if (isLegal) {
    sidebarTitle = isPrivacy ? 'Confidentialité' : isTerms ? 'Conditions' : 'Licences';
    const legalPages: FocusItem[] = [
      {
        id: 'privacy',
        label: 'Confidentialité',
        icon: Shield,
        active: isPrivacy,
        onClick: () => go('/privacy'),
      },
      {
        id: 'terms',
        label: 'Conditions',
        icon: FileCheck2,
        active: isTerms,
        onClick: () => go('/terms'),
      },
      {
        id: 'licenses',
        label: 'Licences',
        icon: Scale,
        active: isLicenses,
        onClick: () => go('/licenses'),
      },
    ];
    const prefItems: FocusItem[] = [
      {
        id: 'cookies',
        label: 'Gérer les cookies',
        icon: Cookie,
        onClick: () => {
          onCloseMobile?.();
          openConsentSettings();
        },
      },
    ];
    if (loggedIn) {
      prefItems.push({
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
      { id: 'legal-docs', title: 'Documents légaux', items: legalPages },
      { id: 'legal-prefs', title: 'Préférences', items: prefItems },
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
  footerItems.push({
    id: 'go-support',
    label: 'Support',
    icon: LifeBuoy,
    onClick: () => go('/support'),
  });
  if (loggedIn && !isSettings) {
    footerItems.push({
      id: 'go-settings',
      label: 'Paramètres',
      icon: SettingsIcon,
      onClick: () => go('/settings'),
    });
  }

  // The phone drawer always shows labels: the desktop « rail » state (icons
  // only) made it a wide panel of lone icons.
  const railCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {onOpenMobile && (
        <div className="atlas-focus-mobile-bar">
          <button
            type="button"
            className="atlas-focus-mobile-trigger secondary"
            onClick={onOpenMobile}
          >
            <Menu size={16} strokeWidth={2} aria-hidden />
            <span>Menu · {sidebarTitle}</span>
          </button>
        </div>
      )}
      {mobileOpen && (
        <button
          type="button"
          className="atlas-focus-backdrop"
          aria-label="Fermer le menu"
          onClick={() => onCloseMobile?.()}
        />
      )}
      <aside
        className={`atlas-focus-sidebar${railCollapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}
        aria-label={`Navigation ${sidebarTitle}`}
      >
        <div className="atlas-focus-sidebar-head">
          <button
            type="button"
            className="atlas-focus-collapse-btn"
            onClick={() => (mobileOpen ? onCloseMobile?.() : setCollapsed((v) => !v))}
            title={mobileOpen ? 'Fermer le menu' : railCollapsed ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}
            aria-label={mobileOpen ? 'Fermer le menu' : railCollapsed ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}
            aria-expanded={mobileOpen ? true : !railCollapsed}
          >
            {railCollapsed ? <PanelLeftOpen size={17} strokeWidth={1.9} /> : <PanelLeftClose size={17} strokeWidth={1.9} />}
          </button>
          {!railCollapsed && <span className="atlas-focus-sidebar-title">{sidebarTitle}</span>}
        </div>

        <div className="atlas-focus-sidebar-scroll">
          {groups.map((group, gi) => {
            const TitleIcon = group.titleIcon;
            return (
              <div key={group.id} className="atlas-focus-group">
                {gi > 0 && <div className="atlas-focus-divider" aria-hidden />}
                {!railCollapsed && group.title && (
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
                        data-tooltip={railCollapsed ? item.label : undefined}
                        onClick={item.onClick}
                      >
                        <span className="atlas-focus-nav-ico">
                          <Icon size={17} strokeWidth={1.9} aria-hidden />
                        </span>
                        {!railCollapsed && <span className="atlas-focus-nav-label">{item.label}</span>}
                        {!railCollapsed && item.badge ? (
                          <span className={`atlas-focus-badge atlas-focus-badge--${item.badgeTone || 'neutral'}`}>
                            {item.badge}
                          </span>
                        ) : null}
                        {item.dot && railCollapsed ? <span className="atlas-focus-dot" aria-hidden /> : null}
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
                    data-tooltip={railCollapsed ? item.label : undefined}
                    onClick={item.onClick}
                  >
                    <span className="atlas-focus-nav-ico">
                      <Icon size={17} strokeWidth={1.9} aria-hidden />
                    </span>
                    {!railCollapsed && <span className="atlas-focus-nav-label">{item.label}</span>}
                    {!railCollapsed && item.badge ? (
                      <span className={`atlas-focus-badge atlas-focus-badge--${item.badgeTone || 'neutral'}`}>
                        {item.badge}
                      </span>
                    ) : null}
                    {item.dot && railCollapsed ? <span className="atlas-focus-dot" aria-hidden /> : null}
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
