import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, BASE } from '../api';
import { removePasskeyLocally } from '../fingerprint';
import { getToken, canAccessAdminSettings, canAccessCompanySettings, getRole, setProfileCache, getDisplayInitials, isStockRole } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import PasswordConfirm from '../components/PasswordConfirm';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import { useUi } from '../components/AppDialogs';
import { friendlyError, validateWrPrefix } from '../lib/errors';
import { validateSettingsCompany, firstError } from '../lib/formValidate';
import { getDensity, setDensity, getUiScale, setUiScale, subscribeUiPrefs, type Density, type UiScale } from '../lib/density'
import { startAtlasLoading, setAtlasLoading, doneAtlasLoading } from '../components/AtlasLoadingBar';
import { VALUATION_METHOD_OPTIONS } from '../lib/labels';
import IntegrationsPanel from '../components/IntegrationsPanel';
import AgentPermissionsPanel from '../components/AgentPermissionsPanel';
import { isDemoMode, enterDemoMode, exitDemoMode, resetDemoData } from '../lib/demoMode';

export default function Settings() {
  const [uiDensity, setUiDensity] = useState<Density>(() => getDensity());
  const [uiScale, setUiScaleState] = useState<UiScale>(() => getUiScale());
  const { confirm, prompt, toast } = useUi();
  const [settings, setSettings] = useState<any>(null);
  const [assistProvider, setAssistProvider] = useState<'groq'>('groq');
  const [assistMeta, setAssistMeta] = useState<{ mistralConfigured?: boolean; geminiConfigured?: boolean; groqConfigured?: boolean }>({});
  const [assistBusy, setAssistBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({
    display_name: '', email: '', phone: '', avatar_url: '', notes: '', username: '', role: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS = new Set(['profile', 'company', 'legal', 'invoicing', 'documents', 'warehouse', 'categories', 'integrations', 'admin', 'audit']);
  const tabFromUrl = searchParams.get('tab') || 'profile';
  const activeTab = VALID_TABS.has(tabFromUrl) ? tabFromUrl : 'profile';
  // mailbox removed — fall through via VALID_TABS
  const setActiveTab = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };
  const [backupToken, setBackupToken] = useState('');
  const [backupList, setBackupList] = useState<{ key: string; size?: number; uploaded?: string | null }[]>([]);
  const [selectedBackupKey, setSelectedBackupKey] = useState('backups/latest.abk');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreJob, setRestoreJob] = useState<any>(null);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupPhase, setBackupPhase] = useState('');
  const [backupPct, setBackupPct] = useState(0);
  const [backupEtaSec, setBackupEtaSec] = useState<number | null>(null);
  const [opStartedAt, setOpStartedAt] = useState<number>(0);
  // secretaire never stays on admin tab
  const [isOwner, setIsOwner] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [ownerInfo, setOwnerInfo] = useState<any>(null);
  const [adminConfig, setAdminConfig] = useState<any>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', display_name: '', role: 'secretaire' });
  const [pwOpen, setPwOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [pwTitle, setPwTitle] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [unitName, setUnitName] = useState('');
  const [editingCat, setEditingCat] = useState<any>(null);
  const [editingUnit, setEditingUnit] = useState<any>(null);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditCursorStack, setAuditCursorStack] = useState<(string | null)[]>([null]);
  const [auditMeta, setAuditMeta] = useState<{ limit: number; has_more: boolean; next_cursor: string | null; cursor: string | null } | null>(null);
  const [auditQ, setAuditQ] = useState('');
  const [auditRange, setAuditRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [auditAction, setAuditAction] = useState('');
  const [auditStats, setAuditStats] = useState<any>(null);
  const AUDIT_PAGE = 80;

  const roleLabel = (r: string) => {
    if (r === 'owner') return 'Propriétaire';
    if (r === 'admin') return 'Admin';
    if (r === 'secretaire') return 'Secrétaire';
    if (r === 'stock') return 'Magasinier (scan & stock)';
    return 'Utilisateur';
  };

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };


  useEffect(() => {
    if (activeTab === 'audit' && (canAccessAdminSettings() || isOwner)) {
      void loadAuditPage(null, auditQ, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, auditRange, auditAction]);

  useEffect(() => {
    if (activeTab !== 'integrations') return;
    if (!(canAccessAdminSettings() || isOwner)) return;
    api.getAssistProvider()
      .then((r: any) => {
        const raw = String(r?.data?.provider || 'mistral');
        const p = raw === 'gemini' ? 'gemini' : raw === 'groq' ? 'groq' : 'mistral';
        setAssistProvider('groq');
        setAssistMeta({
          mistralConfigured: !!r?.data?.mistralConfigured,
          geminiConfigured: !!r?.data?.geminiConfigured,
          groqConfigured: !!r?.data?.groqConfigured,
        });
      })
      .catch(() => {});
  }, [activeTab]);

  // Force profile tab when role cannot access company settings (stock / user)
  useEffect(() => {
    if (!canAccessCompanySettings() && activeTab !== 'profile') {
      setActiveTab('profile');
    }
  }, [activeTab, isOwner]);


  const loadBackupList = useCallback(async (quiet = false) => {
    try {
      const r = await api.backupList();
      const raw = Array.isArray(r.data) ? r.data : [];
      // Only 30m snapshots + latest pointer — hide pre-revert safety copies from the UI
      const items = raw.filter(
        (x) =>
          x.key === 'backups/latest.abk' ||
          String(x.key || '').startsWith('backups/30m/')
      );
      setBackupList(items);
      if (!quiet) toast(`${items.length} sauvegarde(s)`, 'success');
      // Prefer latest.abk when present
      if (items.some((x) => x.key === 'backups/latest.abk')) {
        setSelectedBackupKey('backups/latest.abk');
      } else if (items[0]?.key) {
        setSelectedBackupKey(items[0].key);
      }
      return items;
    } catch (e: any) {
      if (!quiet) toast(e?.message || 'Liste indisponible', 'error');
      return [];
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'admin' && (canAccessAdminSettings() || isOwner)) {
      void loadBackupList(true);
    }
  }, [activeTab, isOwner]);

  // Persistent restore progress (survives refresh)
  useEffect(() => {
    let alive = true;
    let timer: any;
    const tick = async () => {
      try {
        const jid = localStorage.getItem('atlas_restore_job_id') || '';
        if (!jid && !restoreBusy) return;
        const r = await api.backupRestoreStatus(jid || undefined);
        const job = r?.data;
        if (!alive) return;
        if (job) {
          setRestoreJob(job);
          setRestoreBusy(job.status === 'running' || job.status === 'pending');
          if (job.status === 'ok' || job.status === 'failed') {
            localStorage.removeItem('atlas_restore_job_id');
                        doneAtlasLoading();
            setRestoreMsg(job.message || (job.status === 'ok' ? 'Restauration terminée' : 'Échec'));
            if (job.status === 'ok') toast(job.message || 'Restauration OK', 'success');
            else toast(job.message || 'Restauration échouée — réessayez', 'error');
          } else {
            timer = setTimeout(tick, 2500);
          }
        }
      } catch {
        // Back off harder on network / 429 so we don't hammer the rate limit
        if (alive && localStorage.getItem('atlas_restore_job_id')) timer = setTimeout(tick, 5000);
      }
    };
    if (localStorage.getItem('atlas_restore_job_id')) {
      setRestoreBusy(true);
      void tick();
    }
    return () => { alive = false; clearTimeout(timer); };
  }, []);


  useEffect(() => {
    const empty = {
      company_name: '', legal_form: '', address: '', city: '', postal_code: '',
      country: 'Morocco', phone: '', email: '', website: '', logo_url: '',
      notes: '', pdf_footer: '', ice: '', rc: '', if_fiscal: '', cnss: '',
    };
    const timer = window.setTimeout(() => {
      setSettings((prev: any) => prev || empty);
      setLoading(false);
    }, 8000);
    api.getSettings()
      .then((r) => setSettings({ ...empty, ...(r.data || {}) }))
      .catch(() => setSettings(empty))
      .finally(() => {
        window.clearTimeout(timer);
        setLoading(false);
      });
    api.getCategories().then((r) => setCategories(r.data || [])).catch(() => {});
    api.getUnits().then((r) => setUnits(r.data || [])).catch(() => {});
    api.getMe().then((r) => {
      const m = r.data || {};
      const owner = !!(m.is_owner || m.role === 'owner' || m.role === 'admin');
      setIsOwner(owner);
      setProfileForm({
        display_name: m.display_name || '',
        email: m.email || '',
        phone: m.phone || '',
        avatar_url: m.avatar_url || '',
        notes: m.notes || '',
        username: m.username || '',
        role: m.role || '',
      });
      setProfileCache({
        display_name: m.display_name || '',
        avatar_url: m.avatar_url || '',
        username: m.username,
        role: m.role,
      });
      if (owner) {
        api.getAdminUsers().then((u) => {
          setOwnerInfo(u.data?.owner);
          setAdminUsers(u.data?.users || []);
        }).catch(() => {});
        api.getAdminConfig().then((c) => setAdminConfig(c.data)).catch(() => {});
        loadAuditPage(null, '', true);
      }
    }).catch(() => setIsOwner(false));
  }, []);

  /** Cursor-based audit pages. reset=true clears history (search / first page). */
  const loadAuditPage = async (cursor: string | null = null, q = auditQ, reset = false) => {
    setAuditLoading(true);
    try {
      const a = await api.getAuditLog({
        limit: AUDIT_PAGE,
        cursor: cursor || undefined,
        q: q || undefined,
        action: auditAction || undefined,
        range: auditRange,
        stats: reset || cursor == null,
      });
      setAuditLog(a.data || []);
      setAuditMeta(a.meta || null);
      if (a.meta?.stats) setAuditStats(a.meta.stats);
      if (reset) setAuditCursorStack([null]);
      else if (cursor) setAuditCursor(cursor);
    } catch {
      setAuditLog([]);
      setAuditMeta(null);
    } finally {
      setAuditLoading(false);
    }
  };


  const update = (field: string, value: any) => setSettings((prev: any) => ({ ...(prev || {}), [field]: value }));

  const save = async () => {
    const merged = { ...s, ...settings };
    if (merged.credit_prefix != null) {
      const p = validateWrPrefix(merged.credit_prefix);
      if (!p.ok) {
        flash(p.error, 'error');
        toast(p.error, 'error');
        setActiveTab('invoicing');
        return;
      }
      merged.credit_prefix = p.value;
    }
    if (merged.next_credit_number != null) {
      const n = Number(merged.next_credit_number);
      if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) {
        const msg = 'Le prochain numéro WR doit être un entier ≥ 1.';
        flash(msg, 'error');
        toast(msg, 'error');
        setActiveTab('invoicing');
        return;
      }
    }
    const errs = validateSettingsCompany(merged);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      const msg = firstError(errs) || 'Complétez les champs obligatoires.';
      flash(msg, 'error');
      toast(msg, 'error');
      setActiveTab('company');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await api.updateSettings(merged);
      setSettings(res.data);
      flash('Paramètres enregistrés.');
      toast('Paramètres enregistrés', 'success');
    } catch (e: any) {
      const msg = friendlyError(e, 'Impossible d’enregistrer les paramètres.');
      flash(msg, 'error');
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadPasskeys = async () => {
    setPasskeysLoading(true);
    try {
      const res = await api.listWebAuthnCredentials(true);
      setPasskeys(res.data || []);
    } catch (e: any) {
      flash(e?.message || 'Impossible de charger les clés', 'error');
    } finally {
      setPasskeysLoading(false);
    }
  };

  const renamePasskey = async (id: string, current: string) => {
    const label = await prompt({
      title: 'Renommer la clé / biométrie',
      message: 'Nouveau libellé affiché dans la liste des clés d’accès.',
      defaultValue: current || '',
      placeholder: 'Ex. Téléphone bureau',
      confirmLabel: 'Enregistrer',
    });
    if (label == null || !label.trim()) return;
    try {
      await api.renameWebAuthnCredential(id, label.trim());
      flash('Libellé mis à jour');
      toast('Libellé mis à jour', 'success');
      await loadPasskeys();
    } catch (e: any) {
      const msg = friendlyError(e, 'Impossible de renommer la clé.');
      flash(msg, 'error');
      toast(msg, 'error');
    }
  };

  const deletePasskey = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Supprimer la clé d’accès',
      message:
        `Supprimer « ${label || 'cette clé'} » du serveur ?\n\n` +
        'Elle ne pourra plus servir à la connexion web. Retirez-la aussi dans les réglages de l’appareil (mots de passe / clés d’accès) si elle reste listée.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    });
    if (!ok) return;
    try {
      const res: any = await api.deleteWebAuthnCredential(id);
      const remaining = passkeys.map((k) => k.id).filter((x) => x && x !== id);
      const local = await removePasskeyLocally(id, remaining);
      setPasskeys((prev) => prev.filter((k) => k.id !== id));
      if (local.signaled) {
        flash(res?.message || 'Clé supprimée du site et signalée sur cet appareil');
        toast('Clé supprimée (site + appareil)', 'success');
      } else {
        flash(
          (res?.message || 'Clé supprimée du site.') +
            ' Sur cet appareil : ouvrez Réglages → Mots de passe / Clés d’accès et supprimez l’entrée Atlas si elle reste visible.',
        );
        toast('Supprimée du site — vérifiez l’appareil', 'success');
      }
      await loadPasskeys();
    } catch (e: any) {
      const msg = friendlyError(e, 'Impossible de supprimer la clé.');
      flash(msg, 'error');
      toast(msg, 'error');
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, []);


  
  useEffect(() => {
    return subscribeUiPrefs(() => {
      setUiDensity(getDensity());
      setUiScaleState(getUiScale());
    });
  }, []);



if (loading) return (
    <div className="atlas-page atlas-settings">
      <p className="atlas-eyebrow">Société</p>
      <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Paramètres</h1>
      <div className="atlas-card" style={{ marginTop: 16 }}>
        <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 40, width: '100%', marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 40, width: '100%' }} />
      </div>
    </div>
  );
  const s = settings || {
    company_name: '', legal_form: '', address: '', city: '', postal_code: '', country: 'Morocco',
    phone: '', email: '', website: '', logo_url: '', default_notes: '', pdf_footer: '',
  };
  // normalize so form never crashes
  if (!settings) {
    /* still render form with empty defaults below via s */
  }

  const officeSettings = canAccessCompanySettings();
  const adminSettings = canAccessAdminSettings() || isOwner;

  const tabs: { id: string; label: string; group: string; icon: string }[] = [
    { id: 'profile', label: 'Mon profil', group: 'Vous', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
    // stock / user: profile only — no company, legal, bank, warehouse, etc.
    ...(officeSettings ? [
      { id: 'company', label: 'Société', group: 'Entreprise', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6' },
      { id: 'legal', label: 'Légal', group: 'Entreprise', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4' },
      { id: 'invoicing', label: 'Facturation', group: 'Documents', icon: 'M8 2h8a2 2 0 0 1 2 2v16l-3-1.5L12 21l-3-1.5L6 20V4a2 2 0 0 1 2-2z' },
      { id: 'documents', label: 'PDF', group: 'Documents', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6' },
      { id: 'warehouse', label: 'Entrepôts', group: 'Stock', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z' },
      { id: 'categories', label: 'Catégories', group: 'Stock', icon: 'M4 6h16M4 12h16M4 18h10' },
    ] : []),
    ...(adminSettings ? [
      { id: 'integrations', label: 'API', group: 'Admin', icon: 'M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18.07' },
      { id: 'admin', label: 'Admin', group: 'Admin', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8' },
      { id: 'audit', label: 'Journal d’audit', group: 'Admin', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4' },
    ] : []),
  ];
  const tabGroups = Array.from(new Set(tabs.map((x) => x.group)));

  // Force profile if current tab not allowed (e.g. stock user)
  if (!tabs.some((x) => x.id === activeTab)) {
    // can't call setState during render — use effect below
  }

  const reloadAdmin = async () => {
    try {
      const u = await api.getAdminUsers();
      setOwnerInfo(u.data?.owner);
      setAdminUsers(u.data?.users || []);
      const c = await api.getAdminConfig();
      setAdminConfig(c.data);
      await loadAuditPage(null, auditQ, true);
    } catch { /* ignore */ }
  };

  const createUser = () => {
    if (!newUser.username.trim() || !newUser.password) {
      flash('Nom d\'utilisateur et mot de passe obligatoires.', 'error');
      return;
    }
    setPwTitle('Créer un utilisateur');
    setPendingAction(() => async (password: string) => {
      await api.createAdminUser({ ...newUser, confirm_password: password });
      flash('Utilisateur créé.');
      setNewUser({ username: '', password: '', display_name: '', role: 'secretaire' });
      setPwOpen(false); setPendingAction(null);
      await reloadAdmin();
    });
    setPwOpen(true);
  };

  const deleteUser = (id: number, name: string) => {
    setPwTitle(`Supprimer « ${name} »`);
    setPendingAction(() => async (password: string) => {
      await api.deleteAdminUser(id, password);
      flash('Utilisateur supprimé.');
      setPwOpen(false); setPendingAction(null);
      await reloadAdmin();
    });
    setPwOpen(true);
  };


  const saveAdminConfig = () => {
    if (!adminConfig) return;
    setPwTitle('Enregistrer la configuration serveur');
    setPendingAction(() => async (password: string) => {
      await api.updateAdminConfig({
        confirm_password: password,
        webauthn_attestation: adminConfig.webauthn?.attestation,
        webauthn_user_verification: adminConfig.webauthn?.user_verification,
        webauthn_fido2_only: adminConfig.webauthn?.fido2_only,
      });
      flash('Configuration administrateur enregistrée.');
      setPwOpen(false); setPendingAction(null);
      await reloadAdmin();
    });
    setPwOpen(true);
  };

  return (
    <div className="atlas-page atlas-settings">
      <p className="atlas-eyebrow">Société</p>
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Paramètres</h1>
          <p className="atlas-lead" style={{ marginBottom: 0 }}>
            Identité, fiscalité, banque et sécurité de l&apos;espace de travail.
          </p>
        </div>
        <>
          {Object.values(fieldErrors).filter(Boolean)[0] && (
            <span className="save-error-inline">{Object.values(fieldErrors).filter(Boolean)[0]}</span>
          )}
          {activeTab !== 'profile' && activeTab !== 'admin' && activeTab !== 'audit' && activeTab !== 'integrations' && activeTab !== 'categories' && (
            <button onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer cette section'}</button>
          )}
        </>
      </div>

<SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="settings-shell settings-shell--responsive">
        <aside className="settings-nav" aria-label="Sections paramètres">
          {tabGroups.map((g) => (
            <div key={g} className="settings-nav-group">
              <div className="settings-nav-group-label">{g}</div>
              {tabs.filter((x) => x.group === g).map((tab) => (
                <Link
                  key={tab.id}
                  to={`/settings?tab=${tab.id}`}
                  className={activeTab === tab.id ? 'settings-nav-item active' : 'settings-nav-item'}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={tab.icon} />
                  </svg>
                  <span>{tab.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </aside>
        <div className="settings-main">

      {activeTab === 'profile' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Apparence</h3>
          <p className="muted" style={{ marginTop: 0 }}>Densité de l’interface et taille du texte (s’applique aussi en mode compact).</p>
          <div className="form-row">
            <label>Densité</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={uiDensity === 'compact' ? 'btn primary' : 'btn secondary'} onClick={() => { setDensity('compact'); setUiDensity('compact'); }}>Compact</button>
              <button type="button" className={uiDensity === 'comfortable' ? 'btn primary' : 'btn secondary'} onClick={() => { setDensity('comfortable'); setUiDensity('comfortable'); }}>Confort</button>
            </div>
          </div>
          <div className="form-row">
            <label>Taille du texte</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={uiScale === 'sm' ? 'btn primary' : 'btn secondary'} onClick={() => { setUiScale('sm'); setUiScaleState('sm'); }}>Petit</button>
              <button type="button" className={uiScale === 'md' ? 'btn primary' : 'btn secondary'} onClick={() => { setUiScale('md'); setUiScaleState('md'); }}>Moyen</button>
              <button type="button" className={uiScale === 'lg' ? 'btn primary' : 'btn secondary'} onClick={() => { setUiScale('lg'); setUiScaleState('lg'); }}>Grand</button>
            </div>
          </div>
        </div>
      )}


      
      {activeTab === 'profile' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="settings-section-head">
              <h2>Mon profil</h2>
              <p>
                Nom affiché, photo, téléphone et e-mail. L&apos;identifiant et le rôle se modifient uniquement côté administrateur.
              </p>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, padding: '10px 12px', background: 'var(--paper-2, #f7f4ee)', borderRadius: 10, border: '1px solid var(--line)' }}>
              Pour modifier votre <strong>identifiant</strong> ou votre <strong>rôle</strong>, contactez un administrateur.
            </p>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                {profileForm.avatar_url ? (
                  <img src={profileForm.avatar_url} alt="" width={72} height={72} style={{ borderRadius: 16, objectFit: 'cover', border: '1px solid var(--line)' }} />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 16, background: '#0B1F1A', color: '#55C4A5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22, letterSpacing: 0.5 }}>
                    {(() => {
                      const n = (profileForm.display_name || profileForm.username || '?').trim();
                      const parts = n.split(/[\s._-]+/).filter(Boolean);
                      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                      return n.slice(0, 2).toUpperCase();
                    })()}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="form-row">
                  <label>Photo de profil</label>
                  <input
                    value={profileForm.avatar_url}
                    onChange={(e) => setProfileForm({ ...profileForm, avatar_url: e.target.value })}
                    placeholder="Collez une URL ou choisissez un fichier ci-dessous"
                  />
                </div>
                <label className="settings-file-label">
                  <span className="settings-file-btn">Choisir une image</span>
                  <span className="settings-file-hint">PNG, JPG ou WebP · max 400 Ko</span>
                  <input
                    type="file"
                    className="settings-file-input"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 400000) { flash('Image trop lourde (max ~400 Ko).', 'error'); return; }
                      const reader = new FileReader();
                      reader.onload = () => setProfileForm({ ...profileForm, avatar_url: String(reader.result || '') });
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="form-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label>Identifiant (lecture seule)</label>
                <input value={profileForm.username || ''} readOnly disabled style={{ opacity: 0.85 }} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label>Rôle (lecture seule)</label>
                <input value={roleLabel(profileForm.role || '')} readOnly disabled style={{ opacity: 0.85 }} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
              Identifiant et mot de passe : uniquement un administrateur peut les changer.
            </p>
            <div className="form-row">
              <label>Nom affiché</label>
              <input
                value={profileForm.display_name}
                onChange={(e) => setProfileForm({ ...profileForm, display_name: e.target.value })}
                placeholder="Votre nom"
              />
            </div>
            <div className="form-row">
              <label>E-mail</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                placeholder="vous@exemple.com"
              />
            </div>
            <div className="form-row">
              <label>Téléphone</label>
              <input
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                placeholder="+212 …"
              />
            </div>
            <div className="form-row">
              <label>Note personnelle (optionnel)</label>
              <textarea
                rows={2}
                value={profileForm.notes}
                onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })}
                placeholder="Magasin Casa, horaires…"
              />
            </div>
            <button
              type="button"
              disabled={profileSaving}
              onClick={async () => {
                setProfileSaving(true);
                try {
                  const res: any = await api.updateMe({
                    display_name: profileForm.display_name,
                    email: profileForm.email,
                    phone: profileForm.phone,
                    avatar_url: profileForm.avatar_url,
                    notes: profileForm.notes,
                  });
                  const d = res?.data || {};
                  setProfileForm((prev) => ({
                    ...prev,
                    display_name: d.display_name != null ? d.display_name : prev.display_name,
                    email: d.email != null ? d.email : prev.email,
                    phone: d.phone != null ? d.phone : prev.phone,
                    avatar_url: d.avatar_url != null ? d.avatar_url : prev.avatar_url,
                    notes: d.notes != null ? d.notes : prev.notes,
                  }));
                  setProfileCache({
                    display_name: d.display_name != null ? d.display_name : profileForm.display_name,
                    avatar_url: d.avatar_url != null ? d.avatar_url : profileForm.avatar_url,
                  });
                  // Refresh from server
                  try {
                    const me = await api.getMe();
                    const m = me.data || {};
                    setProfileForm((prev) => ({
                      ...prev,
                      display_name: m.display_name || prev.display_name,
                      email: m.email || '',
                      phone: m.phone || '',
                      avatar_url: m.avatar_url || '',
                      notes: m.notes || '',
                      username: m.username || prev.username,
                      role: m.role || prev.role,
                    }));
                    setProfileCache({
                      display_name: m.display_name || '',
                      avatar_url: m.avatar_url || '',
                      username: m.username,
                      role: m.role,
                    });
                  } catch { /* */ }
                  flash('Profil enregistré');
                } catch (e: any) {
                  flash(e?.message || 'Échec', 'error');
                } finally {
                  setProfileSaving(false);
                }
              }}
            >
              {profileSaving ? 'Enregistrement…' : 'Enregistrer le profil'}
            </button>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Mes clés d&apos;accès (passkeys)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Biométrie et clés enregistrées pour <strong>cet appareil</strong>.
              Supprimer retire la clé du site Atlas ; le navigateur peut aussi la retirer de l&apos;appareil (sinon : Réglages système → Mots de passe / Clés d&apos;accès).
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className="secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={passkeysLoading} onClick={() => loadPasskeys()}>
                {passkeysLoading ? 'Chargement…' : 'Actualiser'}
              </button>
            </div>
            {passkeys.length === 0 && !passkeysLoading && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Aucune clé enregistrée sur cet appareil. Ajoutez-en depuis l&apos;écran de connexion après OTP.</p>
            )}
            {passkeys.length > 0 && (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 4px' }}>Appareil / biométrie</th>
                    <th style={{ padding: '6px 4px' }}>Type</th>
                    <th style={{ padding: '6px 4px' }}>Compte</th>
                    <th style={{ padding: '6px 4px' }}>Créée</th>
                    <th style={{ padding: '6px 4px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {passkeys.map((k) => (
                    <tr key={k.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px 4px' }}>
                        <strong>{k.display_label || k.label || 'Sans nom'}</strong>
                        {k.device_info ? (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(() => { try { const d = typeof k.device_info === 'string' ? JSON.parse(k.device_info) : k.device_info; return d.model || d.os_version || d.label || ''; } catch { return ''; } })()}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px 4px' }}>{k.device_type === 'platform' ? 'Biométrie / OS' : 'Clé sécurité'}</td>
                      <td style={{ padding: '8px 4px', color: 'var(--muted)' }}>{k.username || '—'}</td>
                      <td style={{ padding: '8px 4px', color: 'var(--muted)' }}>{(k.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                      <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                        <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: 12, marginRight: 6 }} onClick={() => renamePasskey(k.id, k.label || '')}>Renommer</button>
                        <button type="button" className="danger" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => deletePasskey(k.id, k.label || '')}>Supprimer</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Sécurité d&apos;accès (WebAuthn / FIDO2)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Biométrie (Face ID, Touch ID, Windows Hello) et clés physiques (YubiKey…).
            </p>
            {adminConfig?.webauthn && (
              <>
                <div className="form-row">
                  <label>Type d&apos;attestation</label>
                  <select
                    value={adminConfig.webauthn.attestation || 'none'}
                    onChange={(e) => setAdminConfig({
                      ...adminConfig,
                      webauthn: { ...adminConfig.webauthn, attestation: e.target.value },
                    })}
                  >
                    <option value="none">Aucune (recommandé)</option>
                    <option value="indirect">Indirecte (anonymisée)</option>
                    <option value="direct">Directe (certificat fabricant)</option>
                    <option value="enterprise">Entreprise (flotte gérée)</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Exiger PIN / biométrie sur la clé</label>
                  <select
                    value={adminConfig.webauthn.user_verification || 'preferred'}
                    onChange={(e) => setAdminConfig({
                      ...adminConfig,
                      webauthn: { ...adminConfig.webauthn, user_verification: e.target.value },
                    })}
                  >
                    <option value="required">Toujours exigé</option>
                    <option value="preferred">Préféré (défaut)</option>
                    <option value="discouraged">Désactivé si possible</option>
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!adminConfig.webauthn.fido2_only}
                    onChange={(e) => setAdminConfig({
                      ...adminConfig,
                      webauthn: { ...adminConfig.webauthn, fido2_only: e.target.checked },
                    })}
                  />
                  Préférer authentifiants certifiés FIDO2
                </label>
                <ul style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, paddingLeft: 18 }}>
                  {(adminConfig.webauthn.fido2_notes || []).map((n: string, i: number) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <button type="button" onClick={saveAdminConfig} style={{ marginTop: 12 }}>
                  Enregistrer la config WebAuthn
                </button>
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Mode démonstration</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Sandbox isolée (session uniquement). Aucune donnée réelle n’est modifiée.
              « Revoir le guide » active aussi ce mode.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={isDemoMode() ? 'danger' : undefined}
                onClick={() => {
                  if (isDemoMode()) exitDemoMode();
                  else enterDemoMode();
                  window.location.reload();
                }}
              >
                {isDemoMode() ? 'Quitter le mode démo' : 'Activer le mode démo'}
              </button>
              {isDemoMode() && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    resetDemoData();
                    window.location.reload();
                  }}
                >
                  Réinitialiser les données
                </button>
              )}
            </div>
          </div>

        </div>
      )}

{activeTab === 'company' && officeSettings && (
        <div className="atlas-card">
          <h2 style={{ fontSize: 16, marginBottom: 20 }}>Informations de la société</h2>
          <div className="grid grid-2">
            <div className="form-row"><label>Nom de la société *</label><input className={fieldErrors.company_name ? 'field-error' : undefined} value={s.company_name || ''} onChange={(e) => { update('company_name', e.target.value); setFieldErrors((fe) => ({ ...fe, company_name: '' })); }} placeholder="Ex. A-F Marbre" /><span className="field-error-msg">{fieldErrors.company_name || ''}</span></div>
            <div className="form-row"><label>Forme juridique</label><input value={s.legal_form || ''} onChange={(e) => update('legal_form', e.target.value)} placeholder="SARL, SA, etc." /></div>
          </div>
          <div className="form-row"><label>Adresse</label><input value={s.address || ''} onChange={(e) => update('address', e.target.value)} /></div>
          <div className="grid grid-3">
            <div className="form-row"><label>Ville</label><input value={s.city || ''} onChange={(e) => update('city', e.target.value)} /></div>
            <div className="form-row"><label>Code postal</label><input value={s.postal_code || ''} onChange={(e) => update('postal_code', e.target.value)} /></div>
            <div className="form-row"><label>Pays</label><input value={s.country || ''} onChange={(e) => update('country', e.target.value)} /></div>
          </div>
          <div className="grid grid-2">
            <div className="form-row"><label>Téléphone</label><input value={s.phone || ''} onChange={(e) => update('phone', e.target.value)} /></div>
            <div className="form-row"><label>E-mail</label><input type="email" value={s.email || ''} onChange={(e) => update('email', e.target.value)} /></div>
          </div>
          <div className="grid grid-2">
            <div className="form-row"><label>Site web</label><input value={s.website || ''} onChange={(e) => update('website', e.target.value)} /></div>
            <div className="form-row"><label>URL du logo</label><input value={s.logo_url || ''} onChange={(e) => update('logo_url', e.target.value)} placeholder="https://..." /></div>
          </div>
          <div className="form-row"><label>Notes par défaut (factures)</label><textarea rows={2} value={s.notes || ''} onChange={(e) => update('notes', e.target.value)} /></div>
          <div className="form-row"><label>Pied de page des rapports PDF</label><textarea rows={2} value={s.report_footer || ''} onChange={(e) => update('report_footer', e.target.value)} placeholder="Ex. Document confidentiel — Atlas Commerce — Conservez ce rapport 10 ans (obligations comptables Maroc)" /></div>
        </div>
      )}

      {activeTab === 'legal' && officeSettings && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginBottom: 20 }}>Identifiants légaux et fiscaux</h2>
          <div className="grid grid-2">
            <div className="form-row"><label>ICE / Identifiant</label><input value={s.ice || ''} onChange={(e) => update('ice', e.target.value)} /></div>
            <div className="form-row"><label>IF / Identifiant fiscal</label><input value={s.if_number || ''} onChange={(e) => update('if_number', e.target.value)} /></div>
          </div>
          <div className="grid grid-3">
            <div className="form-row"><label>RC / Registre commerce</label><input value={s.rc || ''} onChange={(e) => update('rc', e.target.value)} /></div>
            <div className="form-row"><label>Patente</label><input value={s.patente || ''} onChange={(e) => update('patente', e.target.value)} /></div>
            <div className="form-row"><label>CNSS / Sécurité sociale</label><input value={s.cnss || ''} onChange={(e) => update('cnss', e.target.value)} /></div>
          </div>
          <div className="grid grid-2">
            <div className="form-row"><label>Taux de TVA (%)</label><NumberField value={s.tax_rate ?? 0} onValueChange={(n) => update('tax_rate', n)} step="0.01" /></div>

          <h3 style={{ fontSize: 14, margin: '20px 0 12px', color: 'var(--muted)' }}>Documents & conservation</h3>
          <div className="grid grid-2">
            <div className="form-row">
              <label>Jours avant purge des documents annulés</label>
              <NumberField
                value={Number(s.retention_cancelled_days ?? 14)}
                onValueChange={(n) => update('retention_cancelled_days', Math.max(1, Math.min(365, n || 14)))}
                min={1}
                max={365}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Factures / devis / achats / reçus déjà annulés uniquement. Les documents actifs ne sont jamais purgés.</span>
            </div>
            <div className="form-row">
              <label>Décimales affichées (prix)</label>
              <NumberField
                value={Number(s.price_decimals ?? 0)}
                onValueChange={(n) => update('price_decimals', Math.max(0, Math.min(2, n ?? 0)))}
                min={0}
                max={2}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>0 = arrondi à l’entier (115,79 → 116). Recommandé pour le commerce local.</span>
            </div>
          </div>
          
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="form-row">
              <label>Durée de validité QR situation (jours)</label>
              <input
                type="number"
                min={7}
                max={365}
                value={Number(s.qr_situation_ttl_days ?? 90)}
                onChange={(e) => update('qr_situation_ttl_days', Number(e.target.value) || 90)}
              />
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Défaut 90 jours. Après expiration, le scan affiche « lien expiré ».</p>
            </div>
            <div className="form-row">
              <label>Rappel conservation données clients (jours)</label>
              <input
                type="number"
                min={365}
                max={3650}
                value={Number(s.client_data_retention_days ?? 1825)}
                onChange={(e) => update('client_data_retention_days', Number(e.target.value) || 1825)}
              />
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Rappel interne (ex. 5 ans). Appliquez votre politique CNDP.</p>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--stone)' }}>
            <p style={{ fontSize: 13, margin: 0, lineHeight: 1.45 }}>
              <strong>Équipe — reçus imprimés :</strong> les reçus avec QR situation sont des documents
              sensibles. Ne les laissez pas accessibles au public. En cas de perte, révoquez le jeton
              depuis la facture liée (admin) et réimprimez.
            </p>
          </div>
          <div className="form-row">
            <label>Note de bas de page documents (optionnel)</label>
            <textarea
              rows={2}
              value={s.document_footer_note || ''}
              onChange={(e) => update('document_footer_note', e.target.value)}
              placeholder="Laisser vide pour aucun texte légal automatique"
            />
          </div>
          <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="show_legal_footer"
              checked={!!Number(s.show_legal_footer)}
              onChange={(e) => update('show_legal_footer', e.target.checked ? 1 : 0)}
            />
            <label htmlFor="show_legal_footer" style={{ margin: 0 }}>Afficher un bloc « Mentions légales » (désactivé par défaut)</label>
          </div>
            <div className="form-row"><label>Devise principale</label><input value={s.currency || 'MAD'} onChange={(e) => update('currency', e.target.value)} placeholder="MAD" /></div>
            <div className="form-row">
              <label>Devise secondaire (affichage)</label>
              <input value={s.secondary_currency || ''} onChange={(e) => update('secondary_currency', e.target.value)} placeholder="EUR (optionnel)" />
            </div>
            <div className="form-row">
              <label>Taux 1 {s.currency || 'MAD'} = ? secondaire</label>
              <input
                type="number"
                step="0.0001"
                value={s.secondary_currency_rate ?? ''}
                onChange={(e) => update('secondary_currency_rate', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="ex: 0.092"
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -8, marginBottom: 12 }}>
            Multi-devise léger : les montants restent en devise principale ; le taux sert d&apos;indication sur les écrans (pas de multi-GL).
          </p>
          <div className="form-row">
            <label>Format de date</label>
            <select value={s.date_format || 'DD/MM/YYYY'} onChange={(e) => update('date_format', e.target.value)}>
              <option value="DD/MM/YYYY">JJ/MM/AAAA</option>
              <option value="MM/DD/YYYY">MM/JJ/AAAA</option>
              <option value="YYYY-MM-DD">AAAA-MM-JJ</option>
            </select>
          </div>
        </div>
      )}


      {activeTab === 'invoicing' && officeSettings && (
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Numérotation des documents (conformité Maroc)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.45 }}>
              Chaque type de document possède sa propre série continue (art. 145 CGI). Formats recommandés au Maroc :
              FA-2026-0001, DEV-2026-0001, REC-2026-0001, <strong>WR-2026-0001</strong> (remboursements / avoirs).
              La séquence ne doit pas comporter de trous.
            </p>
            <div className="form-row" style={{ marginBottom: 16 }}>
              <label>Style de numérotation</label>
              <select
                value={s.numbering_style || 'prefix_year'}
                onChange={(e) => update('numbering_style', e.target.value)}
              >
                <option value="prefix_year">Préfixe + année + séquence (FA-2026-0001) — recommandé</option>
                <option value="prefix_year_slash">Préfixe / année / séquence (FA/2026/0001)</option>
                <option value="year_seq">Année + séquence (2026-0001)</option>
                <option value="year_slash">Année / séquence (2026/0001)</option>
                <option value="prefix_pad5">Préfixe + 5 chiffres (FA-00001)</option>
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 16, maxWidth: 160 }}>
              <label>Nombre de chiffres (séquence)</label>
              <NumberField
                min={3}
                max={6}
                value={s.numbering_pad ?? 4}
                onValueChange={(n) => update('numbering_pad', Math.max(3, Math.min(6, n || 4)))}
              />
            </div>
            <div className="grid grid-3">
              <div className="form-row"><label>Préfixe factures de vente</label><input value={s.invoice_prefix || 'FA-'} onChange={(e) => update('invoice_prefix', e.target.value)} placeholder="FA-" /></div>
              <div className="form-row"><label>Préfixe devis</label><input value={s.quote_prefix || 'DEV-'} onChange={(e) => update('quote_prefix', e.target.value)} placeholder="DEV-" /></div>
              <div className="form-row"><label>Préfixe factures d&apos;achat</label><input value={s.bill_prefix || 'ACH-'} onChange={(e) => update('bill_prefix', e.target.value)} placeholder="ACH-" /></div>
              <div className="form-row"><label>Préfixe reçus</label><input value={s.receipt_prefix || 'REC-'} onChange={(e) => update('receipt_prefix', e.target.value)} placeholder="REC-" /></div>
              <div className="form-row">
                <label>Préfixe remboursements (WR / avoir)</label>
                <input value={s.credit_prefix || 'WR-'} onChange={(e) => update('credit_prefix', e.target.value)} placeholder="WR-" />
              </div>
              <div className="form-row">
                <label>Préfixe ventes rapides (caisse)</label>
                <input value={s.quick_sale_prefix || 'VR-'} onChange={(e) => update('quick_sale_prefix', e.target.value)} placeholder="VR-" />
              </div>
              <div className="form-row"><label>Prochain n° facture</label><NumberField value={s.next_invoice_number ?? 1} onValueChange={(n) => update('next_invoice_number', n)} min={1} /></div>
              <div className="form-row"><label>Prochain n° devis</label><NumberField value={s.next_quote_number ?? 1} onValueChange={(n) => update('next_quote_number', n)} min={1} /></div>
              <div className="form-row"><label>Prochain n° facture d&apos;achat</label><NumberField value={s.next_bill_number ?? 1} onValueChange={(n) => update('next_bill_number', n)} min={1} /></div>
              <div className="form-row"><label>Prochain n° reçu</label><NumberField value={s.next_receipt_number ?? 1} onValueChange={(n) => update('next_receipt_number', n)} min={1} /></div>
              <div className="form-row">
                <label>Prochain n° remboursement (WR)</label>
                <NumberField value={s.next_credit_number ?? 1} onValueChange={(n) => update('next_credit_number', n)} min={1} />
              </div>
              <div className="form-row">
                <label>Prochain n° vente rapide</label>
                <NumberField value={s.next_quick_sale_number ?? 1} onValueChange={(n) => update('next_quick_sale_number', n)} min={1} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              Exemple vente rapide : {(s.quick_sale_prefix || 'VR-').replace(/[-\/]+$/, '')}
              {(s.numbering_style || 'prefix_year') === 'prefix_pad5'
                ? String(s.next_quick_sale_number ?? 1).padStart(5, '0')
                : `-${new Date().getFullYear()}-${String(s.next_quick_sale_number ?? 1).padStart(Number(s.numbering_pad) || 4, '0')}`}
              {' · '}Exemple WR : {(s.credit_prefix || 'WR-').replace(/[-\/]+$/, '')}
              {(s.numbering_style || 'prefix_year') === 'prefix_pad5'
                ? String(s.next_credit_number ?? 1).padStart(5, '0')
                : `-${new Date().getFullYear()}-${String(s.next_credit_number ?? 1).padStart(Number(s.numbering_pad) || 4, '0')}`}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Clôture de période fiscale</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.45 }}>
              Bloque la création de factures, avoirs WR et achats datés jusqu&apos;au mois inclus (YYYY-MM).
              Les documents déjà émis restent consultables. Réservé au propriétaire.
            </p>
            <PeriodLockPanel />
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16 }}>Aperçu du modèle de facture</h2>
              <a className="btn secondary" href={`${BASE}/api/settings/invoice-preview?token=${encodeURIComponent(getToken() || '')}`} target="_blank" rel="noreferrer">Ouvrir l'aperçu</a>
            </div>
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <iframe src={`${BASE}/api/settings/invoice-preview?token=${encodeURIComponent(getToken() || '')}`} style={{ width: '100%', height: 500, border: 'none' }} title="Aperçu facture" />
            </div>
          </div>
        </div>
      )}


      {activeTab === 'documents' && officeSettings && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Personnalisation PDF / impression</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              Options appliquées aux factures, devis, achats et reçus (impression et PDF).
            </p>
            <div className="grid grid-2" style={{ gap: 12, marginBottom: 16 }}>
              {[
                { key: 'pdf_show_logo', label: 'Afficher le logo', def: true },
                { key: 'pdf_show_qr', label: 'Afficher les QR de vérification', def: true },
                { key: 'qr_client_situation', label: 'QR situation sur TOUS les reçus (défaut OFF — préférez l’activer par reçu)', def: false },


                { key: 'pdf_show_bank', label: 'Afficher RIB / banque', def: true },
                { key: 'pdf_show_stamp', label: 'Afficher signature & cachet', def: true },
                { key: 'pdf_show_promo', label: 'Afficher la ligne Promo / remise', def: true },
              ].map((opt) => (
                <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={s[opt.key] === undefined || s[opt.key] === null || s[opt.key] === '' ? opt.def : !!Number(s[opt.key])}
                    onChange={(e) => update(opt.key, e.target.checked ? 1 : 0)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Couleur d’accent (hex)</label>
                <input
                  value={s.pdf_accent_color || '#1a1814'}
                  onChange={(e) => update('pdf_accent_color', e.target.value)}
                  placeholder="#1a1814"
                />
              </div>
              <div className="form-row">
                <label>Texte bas de page PDF</label>
                <input
                  value={s.pdf_footer_text || s.document_footer_note || ''}
                  onChange={(e) => update('pdf_footer_text', e.target.value)}
                  placeholder="Optionnel — laissez vide pour aucun texte"
                />
              </div>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Signature et cachet société</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              Ajoutez une image PNG/JPG (ou data URL) de votre signature manuscrite et de votre cachet.
              Elles apparaissent sur les <strong>factures</strong> et <strong>reçus</strong> (pas sur les devis).
            </p>
            <div className="form-row">
              <label>Signature société (URL ou data:image/png;base64,…)</label>
              <input
                value={s.company_signature_url || ''}
                onChange={(e) => update('company_signature_url', e.target.value)}
                placeholder="https://… ou collez une data URL"
              />
            </div>
            <div className="form-row">
              <label>Importer une signature (fichier image)</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 400000) { flash('Fichier trop volumineux (max ~400 Ko).', 'error'); return; }
                  const reader = new FileReader();
                  reader.onload = () => update('company_signature_url', String(reader.result || ''));
                  reader.readAsDataURL(f);
                }}
              />
            </div>
            {settings.company_signature_url && (
              <div style={{ marginBottom: 16 }}>
                <img src={settings.company_signature_url} alt="Signature" style={{ maxHeight: 72, background: '#fff', border: '1px solid var(--line)' }} />
              </div>
            )}
            <div className="form-row">
              <label>Cachet / tampon (URL ou data URL)</label>
              <input
                value={s.company_stamp_url || ''}
                onChange={(e) => update('company_stamp_url', e.target.value)}
                placeholder="https://… ou collez une data URL"
              />
            </div>
            <div className="form-row">
              <label>Importer un cachet (fichier image)</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 400000) { flash('Fichier trop volumineux (max ~400 Ko).', 'error'); return; }
                  const reader = new FileReader();
                  reader.onload = () => update('company_stamp_url', String(reader.result || ''));
                  reader.readAsDataURL(f);
                }}
              />
            </div>
            {settings.company_stamp_url && (
              <div>
                <img src={settings.company_stamp_url} alt="Cachet" style={{ maxHeight: 88, background: '#fff', border: '1px solid var(--line)' }} />
              </div>
            )}
          </div>
        </div>
      )}

      
      {activeTab === 'warehouse' && officeSettings && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Multi-entrepôts</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
              Activez le suivi par emplacement. Les ventes et achats mettent à jour l&apos;emplacement par défaut
              (magasin principal). Utilisez <strong>Ops stock</strong> pour transférer entre entrepôts et voir les rapports par lieu.
            </p>
            <div className="form-row">
              <label>
                <input
                  type="checkbox"
                  checked={!!Number(s.multi_warehouse ?? 1)}
                  onChange={(e) => update('multi_warehouse', e.target.checked ? 1 : 0)}
                />{' '}
                Multi-entrepôts activé
              </label>
            </div>
            <div className="form-row">
              <label>ID emplacement ventes (sales_location_id)</label>
              <NumberField
                value={Number(s.sales_location_id || 0)}
                onValueChange={(n) => update('sales_location_id', n || null)}
                min={0}
              />
              <span className="field-hint" style={{ color: 'var(--muted)' }}>
                Laisser 0 = utiliser l&apos;emplacement marqué « défaut » dans Ops stock.
              </span>
            </div>
            <div className="form-row">
              <label>ID emplacement achats (purchase_location_id)</label>
              <NumberField
                value={Number(s.purchase_location_id || 0)}
                onValueChange={(n) => update('purchase_location_id', n || null)}
                min={0}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Gérez la liste des entrepôts (code MAG, RES, …) dans <strong>Ops stock → Emplacements</strong>.
            </p>
          </div>
          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Méthode de valorisation des stocks</h2>
            <div className="form-row">
              <label>Méthode</label>
              <select
                value={s.inventory_valuation_method || 'average'}
                onChange={(e) => update('inventory_valuation_method', e.target.value)}
              >
                {VALUATION_METHOD_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
              {(VALUATION_METHOD_OPTIONS.find((o) => o.code === (s.inventory_valuation_method || 'average')) || VALUATION_METHOD_OPTIONS[0]).help}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'categories' && officeSettings && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Catégories de produits</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.45 }}>
            Organisez le stock par catégories. Le rapport PDF stock est regroupé automatiquement par catégorie.
            La suppression d&apos;une catégorie retire le libellé des produits (les produits restent).
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <input
              placeholder="Nom de la catégorie *"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              style={{ flex: '1 1 180px' }}
            />
            <input
              placeholder="Description (optionnel)"
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
              style={{ flex: '2 1 220px' }}
            />
            <button
              type="button"
              disabled={catSaving}
              onClick={async () => {
                if (!catName.trim()) { flash('Nom obligatoire.', 'error'); return; }
                setCatSaving(true);
                try {
                  if (editingCat?.id) {
                    await api.updateCategory(editingCat.id, { name: catName.trim(), description: catDesc });
                    flash('Catégorie mise à jour.');
                    setEditingCat(null);
                  } else {
                    await api.createCategory({ name: catName.trim(), description: catDesc });
                    flash('Catégorie créée.');
                  }
                  setCatName(''); setCatDesc('');
                  const r = await api.getCategories();
                  setCategories(r.data || []);
                } catch (e: any) { flash(e.message, 'error'); }
                finally { setCatSaving(false); }
              }}
            >
              {catSaving ? '…' : editingCat ? 'Enregistrer' : '+ Ajouter'}
            </button>
            {editingCat && (
              <button type="button" className="secondary" onClick={() => { setEditingCat(null); setCatName(''); setCatDesc(''); }}>
                Annuler
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nom</th><th>Description</th><th>Source</th><th></th></tr>
              </thead>
              <tbody>
                {categories.map((cat: any) => (
                  <tr key={cat.id ?? cat.name}>
                    <td><strong>{cat.name}</strong></td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{cat.description || '—'}</td>
                    <td style={{ fontSize: 12 }}>{cat.from_products ? 'Utilisée sur produits' : 'Définie'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {cat.id ? (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }}
                          onClick={() => {
                            setEditingCat(cat);
                            setCatName(cat.name || '');
                            setCatDesc(cat.description || '');
                          }}
                        >
                          Modifier
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => {
                          setPwTitle('Supprimer la catégorie');
                          setPwDesc(
                            cat.from_products
                              ? `« ${cat.name} » n'est définie que sur des produits. Confirmer pour retirer ce libellé de tous les produits.`
                              : `Supprimer « ${cat.name} » ? Les produits garderont leurs quantités ; le libellé catégorie sera vidé.`
                          );
                          setPendingAction(() => async (password: string) => {
                            await api.deleteCategory(cat.id || 'by-name', password, cat.name);
                            const r = await api.getCategories();
                            setCategories(r.data || []);
                            flash('Catégorie supprimée.');
                            setPwOpen(false); setPendingAction(null);
                          });
                          setPwOpen(true);
                        }}
                      >
                        Suppr.
                      </button>
                    </td>
                  </tr>
                ))}
                {!categories.length && (
                  <tr><td colSpan={4} className="empty">Aucune catégorie. Ajoutez-en une ou assignez-en une sur un produit.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 16, margin: '24px 0 8px' }}>Unités de mesure</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Ex. unité, kg, carton — modifiables et supprimables par l&apos;admin.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <input placeholder="Nom de l&apos;unité *" value={unitName} onChange={(e) => setUnitName(e.target.value)} style={{ flex: '1 1 180px' }} />
            <button type="button" disabled={catSaving} onClick={async () => {
              if (!unitName.trim()) { flash('Nom obligatoire.', 'error'); return; }
              setCatSaving(true);
              try {
                if (editingUnit?.id) {
                  await api.updateUnit(editingUnit.id, { name: unitName.trim() });
                  flash('Unité mise à jour.');
                  setEditingUnit(null);
                } else {
                  await api.createUnit({ name: unitName.trim() });
                  flash('Unité créée.');
                }
                setUnitName('');
                const r = await api.getUnits();
                setUnits(r.data || []);
              } catch (e: any) { flash(e.message, 'error'); }
              finally { setCatSaving(false); }
            }}>{editingUnit ? 'Enregistrer' : '+ Ajouter unité'}</button>
            {editingUnit && <button type="button" className="secondary" onClick={() => { setEditingUnit(null); setUnitName(''); }}>Annuler</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th></th></tr></thead>
              <tbody>
                {units.map((u: any) => (
                  <tr key={u.id ?? u.name}>
                    <td><strong>{u.name}</strong></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {u.id ? (
                          <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }}
                            onClick={() => { setEditingUnit(u); setUnitName(u.name || ''); }}>Modifier</button>
                      ) : null}
                          <button type="button" className="danger" style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => {
                              setPwTitle(`Supprimer l'unité « ${u.name} »`);
                              setPendingAction(() => async (password: string) => {
                                await api.deleteUnit(u.id || 'by-name', password, u.name);
                                flash('Unité supprimée.');
                                setPwOpen(false); setPendingAction(null);
                                const r = await api.getUnits();
                                setUnits(r.data || []);
                              });
                              setPwOpen(true);
                            }}>Suppr.</button>

                    </td>
                  </tr>
                ))}
                {!units.length && <tr><td colSpan={2} className="empty">Aucune unité.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      
      
      {activeTab === 'audit' && (canAccessAdminSettings() || isOwner) && (
        <div className="audit-panel">
          <header className="audit-panel-head">
            <div>
              <h2 className="audit-panel-title">Journal d’audit</h2>
              <p className="audit-panel-sub">Historique des changements sur ce compte (admin uniquement).</p>
            </div>
            <div className="audit-panel-actions">
              <button type="button" className="secondary" disabled={auditLoading} onClick={() => loadAuditPage(null, auditQ, true)}>
                Actualiser
              </button>
              <button
                type="button"
                className="secondary"
                disabled={auditLoading}
                onClick={async () => {
                  try {
                    await api.exportAuditLog('csv', 500);
                    flash('Export CSV téléchargé.');
                  } catch (e: any) {
                    flash(e?.message || 'Échec export', 'error');
                  }
                }}
              >
                Export CSV
              </button>
            </div>
          </header>

          <div className="audit-stats">
            <div className="audit-stat">
              <span className="audit-stat-label">Actions (période)</span>
              <strong className="audit-stat-value">{auditStats?.total ?? '—'}</strong>
            </div>
            <div className="audit-stat">
              <span className="audit-stat-label">Acteurs uniques</span>
              <strong className="audit-stat-value">{auditStats?.unique_actors ?? '—'}</strong>
            </div>
            <div className="audit-stat">
              <span className="audit-stat-label">Sur cette page</span>
              <strong className="audit-stat-value">{auditLog.length}</strong>
            </div>
            <div className="audit-stat">
              <span className="audit-stat-label">Période</span>
              <strong className="audit-stat-value" style={{ fontSize: '0.95rem' }}>
                {auditRange === '24h' ? '24 h' : auditRange === '30d' ? '30 j' : auditRange === 'all' ? 'Tout' : '7 j'}
              </strong>
            </div>
          </div>


          <div className="audit-charts">
            <div className="audit-chart-card">
              <h3>Actions dans le temps</h3>
              <div className="audit-bars">
                {((auditStats?.by_day as any[]) || []).length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Pas assez de données</span>
                )}
                {(() => {
                  const days = (auditStats?.by_day as any[]) || [];
                  const max = Math.max(1, ...days.map((d: any) => Number(d.n || 0)));
                  return days.map((d: any) => (
                    <div key={d.day} className="audit-bar-col" title={`${d.day}: ${d.n}`}>
                      <div className="audit-bar" style={{ height: `${Math.max(4, (Number(d.n) / max) * 100)}%` }} />
                      <span className="audit-bar-lbl">{String(d.day || '').slice(5)}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="audit-chart-card">
              <h3>Types d’action</h3>
              {(() => {
                const acts = (auditStats?.top_actions as any[]) || [];
                const max = Math.max(1, ...acts.map((a: any) => Number(a.n || 0)));
                if (!acts.length) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>Aucune donnée</span>;
                return acts.map((a: any) => (
                  <div key={a.action} className="audit-hbar">
                    <span className="audit-hbar-name">{a.action}</span>
                    <div className="audit-hbar-track">
                      <div className="audit-hbar-fill" style={{ width: `${(Number(a.n) / max) * 100}%` }} />
                    </div>
                    <span className="audit-hbar-n">{a.n}</span>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="audit-filters">
            <input
              type="search"
              placeholder="Rechercher (action, détail, utilisateur…)"
              value={auditQ}
              onChange={(e) => setAuditQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadAuditPage(null, auditQ, true);
              }}
            />
            <select value={auditRange} onChange={(e) => setAuditRange(e.target.value as any)}>
              <option value="24h">24 dernières heures</option>
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="all">Tout</option>
            </select>
            <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)}>
              <option value="">Tous les types</option>
              {(auditStats?.top_actions || []).map((a: any) => (
                <option key={a.action} value={a.action}>
                  {a.action} ({a.n})
                </option>
              ))}
            </select>
            <button type="button" className="secondary" disabled={auditLoading} onClick={() => loadAuditPage(null, auditQ, true)}>
              {auditLoading ? '…' : 'Filtrer'}
            </button>
          </div>

          <div className="audit-table-wrap audit-table-wrap--wide">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Type d’action</th>
                  <th>Ressource</th>
                  <th>Acteur</th>
                  <th>IP</th>
                  <th>Détail</th>
                </tr>
              </thead>
              <tbody>
                {auditLoading && auditLog.length === 0 && (
                  <tr>
                    <td colSpan={6} className="audit-empty">
                      Chargement…
                    </td>
                  </tr>
                )}
                {!auditLoading && auditLog.length === 0 && (
                  <tr>
                    <td colSpan={6} className="audit-empty">
                      Aucune entrée pour ces filtres.
                    </td>
                  </tr>
                )}
                {auditLog.map((row: any) => (
                  <tr key={row.id || `${row.created_at}-${row.action}`}>
                    <td className="audit-time">
                      {row.created_at
                        ? new Date(
                            row.created_at.includes('T') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z',
                          ).toLocaleString('fr-MA', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td>
                      <span className="audit-action-pill">{row.action || '—'}</span>
                    </td>
                    <td>
                      {[row.entity, row.entity_id != null ? `#${row.entity_id}` : ''].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td>
                      <div className="audit-actor">
                        <strong>{row.username || '—'}</strong>
                        <span>{roleLabel(row.role || '')}</span>
                      </div>
                    </td>
                    <td className="audit-ip">{row.ip || '—'}</td>
                    <td className="audit-detail" title={row.detail || ''}>
                      {row.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="audit-pager">
            <button
              type="button"
              className="secondary"
              disabled={auditLoading || auditCursorStack.length <= 1}
              onClick={() => {
                const stack = auditCursorStack.slice(0, -1);
                const prev = stack[stack.length - 1] ?? null;
                setAuditCursorStack(stack);
                loadAuditPage(prev, auditQ, false);
              }}
            >
              ← Précédent
            </button>
            <button
              type="button"
              className="secondary"
              disabled={auditLoading || !auditMeta?.has_more || !auditMeta?.next_cursor}
              onClick={() => {
                const next = auditMeta?.next_cursor ?? null;
                if (!next) return;
                setAuditCursorStack((s) => [...s, next]);
                loadAuditPage(next, auditQ, false);
              }}
            >
              Suivant →
            </button>
            <span className="audit-pager-meta">
              {auditMeta
                ? auditLog.length === 0
                  ? '0 entrée'
                  : `Page ${auditCursorStack.length}${auditMeta.has_more ? ' · suite disponible' : ' · fin'}`
                : ''}
            </span>
          </div>
        </div>
      )}


      {activeTab === 'integrations' && (canAccessAdminSettings() || isOwner) && (
        <div>
          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Atlas Agent · Groq</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
              Atlas Agent utilise uniquement <strong>Groq</strong> (rapide, gratuit avec quota).
              Il peut parler librement (identité, explications, métier) — pas seulement le stock.
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
              Secret requis: <code>GROQ_API_KEY</code> {assistMeta.groqConfigured ? '✓ configuré' : '✗ manquant'}
              <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: '0.8rem' }}>
                Optionnel: <code>GROQ_MODEL</code> (défaut llama-3.1-8b-instant). Conversations chiffrées sur R2 (ACH2).
              </span>
            </p>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16 }}>Clés API publiques</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Pour connecter une caisse, un site e-commerce ou un script. En-tête :
              <code> Authorization: Bearer atlas_…</code> (à venir côté auth) — la clé s&apos;affiche une seule fois à la création.
            </p>
            <IntegrationsPanel />
          </div>
        </div>
      )}

      
{activeTab === 'admin' && (canAccessAdminSettings() || isOwner) && (
        <div>
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Sauvegarde &amp; restauration</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
            Snapshot complet chiffré (AES-256-GCM, format .abk) — illisible sur le CDN sans ADMIN_BACKUP_TOKEN. Dossier backups/30m (cron ~30 min). Rétention 14 jours. Une copie de sécurité est créée avant chaque restauration.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <button type="button" className="secondary" disabled={restoreBusy || backupBusy} onClick={async () => {
              const t0 = Date.now();
              setOpStartedAt(t0);
              setBackupBusy(true);
              setBackupPct(5);
              setBackupPhase('Vérification R2 et secrets…');
              setBackupEtaSec(45);
              const tick = window.setInterval(() => {
                setBackupPct((p) => {
                  const next = Math.min(88, p + (p < 30 ? 8 : p < 60 ? 5 : 2));
                  const elapsed = (Date.now() - t0) / 1000;
                  if (next > 5) {
                    const totalEst = elapsed / (next / 100);
                    setBackupEtaSec(Math.max(1, Math.round(totalEst - elapsed)));
                  }
                  return next;
                });
                setBackupPhase((ph) => {
                  if (ph.startsWith('Vérif')) return 'Lecture des tables D1…';
                  if (ph.startsWith('Lecture')) return 'Chiffrement AES-256-GCM…';
                  if (ph.startsWith('Chiff')) return 'Écriture sur R2 (backups/30m)…';
                  return 'Finalisation…';
                });
              }, 700);
              try {
                const r = await api.backupNow();
                window.clearInterval(tick);
                setBackupPct(100);
                setBackupPhase('Terminé');
                setBackupEtaSec(0);
                toast(r.message || 'Sauvegarde OK', 'success');
                await loadBackupList(true);
              } catch (e: any) {
                window.clearInterval(tick);
                setBackupPhase('Échec');
                toast(e?.message || 'Échec sauvegarde', 'error');
              } finally {
                window.setTimeout(() => {
                  setBackupBusy(false);
                  setBackupPct(0);
                  setBackupPhase('');
                  setBackupEtaSec(null);
                }, 800);
              }
            }}>Sauvegarder maintenant</button>
            <button type="button" className="secondary" disabled={restoreBusy || backupBusy} onClick={async () => {
              try {
                const r = await api.backupStatus();
                const d = r.data || {};
                toast(d.has_latest
                  ? `Dernière: ${d.uploaded || 'oui'}${d.size ? ' · ' + Math.round(Number(d.size) / 1024) + ' Ko' : ''}`
                  : 'Aucune sauvegarde.', 'success');
                await loadBackupList(true);
              } catch (e: any) {
                toast(e?.message || 'Statut indisponible', 'error');
              }
            }}>Statut</button>
            <button type="button" className="secondary" disabled={restoreBusy || backupBusy} title="Actualiser la liste déroulante" onClick={async () => {
              await loadBackupList(false);
            }}>↻ Actualiser</button>
          </div>

          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Jeton optionnel (import fichier hors serveur uniquement)
          </label>
          <input
            type="password"
            autoComplete="off"
            value={backupToken}
            onChange={(e) => setBackupToken(e.target.value)}
            placeholder="Uniquement si le .abk vient d’un autre serveur"
            style={{ width: '100%', maxWidth: 420, marginBottom: 12 }}
          />

          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Restauration R2 : le serveur utilise <code>ADMIN_BACKUP_TOKEN</code> tout seul (session admin suffisante).
          </p>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Restaurer depuis R2</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <select
              value={selectedBackupKey}
              onChange={(e) => setSelectedBackupKey(e.target.value)}
              style={{ minWidth: 280, flex: 1 }}
            >
              {(backupList.length
                ? backupList
                : [{ key: 'backups/latest.abk', uploaded: null as string | null }]
              ).map((b) => {
                const fmtBackupLabel = () => {
                  if (b.key === 'backups/latest.abk') {
                    if (b.uploaded) {
                      try {
                        const d = new Date(b.uploaded);
                        return `Dernière — ${d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
                      } catch { /* */ }
                    }
                    return 'Dernière sauvegarde';
                  }
                  // Prefer uploaded timestamp; fallback to stamp in filename atlas-YYYY-MM-DDTHH-MM-SS…
                  let dateSrc = b.uploaded || '';
                  if (!dateSrc) {
                    const m = String(b.key).match(/atlas-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
                    if (m) dateSrc = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3') + 'Z';
                  }
                  if (dateSrc) {
                    try {
                      const d = new Date(dateSrc);
                      if (!Number.isNaN(d.getTime())) {
                        return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
                      }
                    } catch { /* */ }
                  }
                  return b.key.split('/').pop() || b.key;
                };
                return (
                  <option key={b.key} value={b.key}>
                    {fmtBackupLabel()}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={restoreBusy}
              onClick={async () => {
                                const ok = await confirm({
                  title: 'Restaurer la sauvegarde',
                  message: 'Une copie de sécurité chiffrée sera créée d’abord. L’opération peut prendre plusieurs minutes. Continuer ?',
                  confirmLabel: 'Restaurer',
                });
                if (!ok) return;
                setRestoreBusy(true);
                setOpStartedAt(Date.now());
                setRestoreMsg('Démarrage…');
                setRestoreJob({ status: 'running', progress: 5, message: 'Démarrage de la restauration…' });
                startAtlasLoading();
                setAtlasLoading(5);
                let pollTimer: any = null;
                let stopped = false;
                const poll = async (jid?: string) => {
                  if (stopped) return;
                  try {
                    const st = await api.backupRestoreStatus(jid);
                    const job = st?.data;
                    if (job) {
                      setRestoreJob(job);
                      setRestoreMsg(job.message || '');
                      const prog = Number(job.progress);
                      if (Number.isFinite(prog)) setAtlasLoading(prog);
                      if (job.status === 'ok' || job.status === 'failed') {
                        stopped = true;
                        if (pollTimer) clearInterval(pollTimer);
                        setRestoreBusy(false);
                        localStorage.removeItem('atlas_restore_job_id');
                        doneAtlasLoading();
                        setRestoreMsg(job.message || '');
                        if (job.status === 'ok') toast(job.message || 'Restauration terminée', 'success');
                        else toast(job.message || 'Échec — vous pouvez réessayer', 'error');
                        return;
                      }
                    }
                  } catch { /* keep polling */ }
                };
                // Fast poll while restore runs in background on the Worker
                pollTimer = setInterval(() => { void poll(localStorage.getItem('atlas_restore_job_id') || undefined); }, 2500);
                try {
                  const r = await api.backupRestore({ key: selectedBackupKey });
                  const jid = r?.data?.job_id;
                  if (jid) {
                    localStorage.setItem('atlas_restore_job_id', jid);
                    setRestoreJob((prev: any) => ({
                      ...(prev || {}),
                      id: jid,
                      status: 'running',
                      message: r.message || prev?.message || 'Restauration en cours…',
                      progress: Math.max(5, Number(prev?.progress) || 5),
                    }));
                    void poll(jid);
                  } else {
                    stopped = true;
                    if (pollTimer) clearInterval(pollTimer);
                    setRestoreBusy(false);
                    doneAtlasLoading();
                    toast(r?.message || 'Pas de job_id — vérifiez les droits', 'error');
                  }
                } catch (e: any) {
                  stopped = true;
                  if (pollTimer) clearInterval(pollTimer);
                  setRestoreBusy(false);
                  localStorage.removeItem('atlas_restore_job_id');
                  doneAtlasLoading();
                  toast(e?.message || 'Échec restauration — l’app reste utilisable, réessayez', 'error');
                }
              }}
            >
              Restaurer depuis R2
            </button>
          </div>

          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Ou importer un fichier .abk (chiffré) ou ancien JSON Atlas</label>
          <input
            type="file"
            accept=".abk,application/json,.json,application/octet-stream" title="JSON Atlas uniquement"
            disabled={restoreBusy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
                            const ok = await confirm({
                title: 'Importer une sauvegarde',
                message: `Restaurer depuis « ${file.name} » ? Une sauvegarde de sécurité chiffrée sera créée d’abord.`,
                confirmLabel: 'Restaurer',
              });
              if (!ok) return;
              setRestoreBusy(true);
              setRestoreMsg('Lecture du fichier…');
              try {
                const name = file.name.toLowerCase();
                if (!name.endsWith('.abk') && !name.endsWith('.json')) {
                  throw new Error('Seuls les fichiers .abk (chiffré) ou JSON Atlas sont acceptés');
                }
                let body: any;
                if (name.endsWith('.abk') || file.type === 'application/octet-stream') {
                  const buf = await file.arrayBuffer();
                  const u8 = new Uint8Array(buf);
                  // magic ABK1
                  const isAbk = u8.length > 16 && u8[0] === 0x41 && u8[1] === 0x42 && u8[2] === 0x4b && u8[3] === 0x31;
                  if (!isAbk && !name.endsWith('.json')) {
                    throw new Error('Fichier .abk invalide (format ABK1 attendu)');
                  }
                  // send as base64 for worker decrypt
                  let binary = '';
                  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
                  body = { abk_base64: btoa(binary) };
                } else {
                  const text = await file.text();
                  let parsed: any;
                  try { parsed = JSON.parse(text); } catch { throw new Error('JSON invalide'); }
                  const isEnc = parsed?.fmt === 'atlas-backup-enc-v1';
                  const isPlain = parsed?.tables && (parsed.app === 'atlas-commerce' || parsed.version === 2 || parsed.version === 1 || parsed.exported_at);
                  if (!isEnc && !isPlain) throw new Error('Fichier non compatible — sauvegarde Atlas uniquement');
                  body = { payload: parsed };
                }
                setRestoreJob({ status: 'running', progress: 5, message: 'Démarrage de la restauration…' });
                startAtlasLoading();
                setAtlasLoading(5);
                let pollTimer: any = null;
                let stopped = false;
                const poll = async (jid?: string) => {
                  if (stopped) return;
                  try {
                    const st = await api.backupRestoreStatus(jid);
                    const job = st?.data;
                    if (job) {
                      setRestoreJob(job);
                      setRestoreMsg(job.message || '');
                      const prog = Number(job.progress);
                      if (Number.isFinite(prog)) setAtlasLoading(prog);
                      if (job.status === 'ok' || job.status === 'failed') {
                        stopped = true;
                        if (pollTimer) clearInterval(pollTimer);
                        setRestoreBusy(false);
                        localStorage.removeItem('atlas_restore_job_id');
                        doneAtlasLoading();
                        if (job.status === 'ok') toast(job.message || 'Restauration terminée', 'success');
                        else toast(job.message || 'Échec', 'error');
                      }
                    }
                  } catch { /* */ }
                };
                pollTimer = setInterval(() => { void poll(localStorage.getItem('atlas_restore_job_id') || undefined); }, 2500);
                const r = await api.backupRestore(body, backupToken.trim());
                const jid = r?.data?.job_id;
                if (jid) {
                  localStorage.setItem('atlas_restore_job_id', jid);
                  void poll(jid);
                } else {
                  stopped = true;
                  if (pollTimer) clearInterval(pollTimer);
                  setRestoreBusy(false);
                  doneAtlasLoading();
                  toast(r?.message || 'Pas de job_id', 'error');
                }
              } catch (err: any) {
                setRestoreBusy(false);
                localStorage.removeItem('atlas_restore_job_id');
                        doneAtlasLoading();
                toast(err?.message || 'Import échoué — réessayez sans casser l’app', 'error');
              }
            }}
          />

          {restoreMsg && (
            <p style={{ fontSize: 13, marginTop: 10, color: 'var(--muted)' }}>{restoreMsg}</p>
          )}
        </div>

        {/* Progress overlay — backup or restore */}
        {(restoreBusy || backupBusy) && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(15,23,42,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24,
            }}
          >
            <div className="card" style={{ maxWidth: 440, width: '100%', padding: 24, textAlign: 'center' }}>
              <h3 style={{ marginTop: 0 }}>
                {backupBusy ? 'Sauvegarde en cours' : 'Restauration en cours'}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.45, minHeight: 40 }}>
                {backupBusy
                  ? (backupPhase || 'Préparation…')
                  : (restoreJob?.message || 'Ne fermez pas l’onglet. Un rafraîchissement réaffichera cette fenêtre jusqu’à la fin.')}
              </p>
              {(() => {
                const pct = backupBusy
                  ? backupPct
                  : Math.min(100, Math.max(0, Number(restoreJob?.progress) || 0));
                const eta = backupBusy
                  ? backupEtaSec
                  : (opStartedAt && pct > 8
                    ? Math.max(1, Math.round(((Date.now() - opStartedAt) / 1000) / (pct / 100) - (Date.now() - opStartedAt) / 1000))
                    : null);
                return (
                  <>
                    <div style={{
                      height: 12, borderRadius: 99, background: 'var(--stone)', overflow: 'hidden', margin: '16px 0 8px',
                    }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        background: 'linear-gradient(90deg, #0f1b2d, #3b82f6)',
                        transition: 'width 0.45s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                      <span>{Math.round(pct)}%</span>
                      <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                        {pct >= 100 ? 'Terminé' : eta != null ? `≈ ${eta}s restantes` : 'Calcul…'}
                      </span>
                    </div>
                  </>
                );
              })()}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '14px 0 0' }}>
                {backupBusy
                  ? 'Création du fichier .abk chiffré sur R2.'
                  : 'En cas d’échec l’application reste utilisable — vous pourrez réessayer.'}
              </p>
              {!backupBusy && (
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: 16, width: '100%' }}
                  onClick={async () => {
                    const jid = localStorage.getItem('atlas_restore_job_id') || restoreJob?.id;
                    try {
                      await api.backupRestoreCancel(jid || undefined);
                    } catch { /* ignore */ }
                    localStorage.removeItem('atlas_restore_job_id');
                    setRestoreBusy(false);
                    setRestoreJob(null);
                    setRestoreMsg('');
                    doneAtlasLoading();
                    toast('Restauration fermée — vous pouvez réessayer plus tard', 'success');
                  }}
                >
                  Fermer / Annuler
                </button>
              )}
            </div>
          </div>
        )}

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Administrateur principal</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              Compte propriétaire : <strong>{ownerInfo?.username || adminConfig?.owner_username || 'admin'}</strong>
              {' '}(mot de passe = secret Cloudflare <code>ADMIN_PASSWORD</code>)
            </p>
            {adminConfig?.password_secret_format && (
              <div style={{ background: 'var(--stone)', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.55 }}>
                <strong>Format du secret mot de passe</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {(adminConfig.password_secret_format.rules || []).map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p style={{ marginTop: 8 }}>Exemple : <code>{adminConfig.password_secret_format.example}</code></p>
                <p style={{ marginTop: 6, color: 'var(--muted)' }}>
                  Optionnel : secret <code>ADMIN_USERNAME</code> (défaut <code>admin</code>).
                </p>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Comptes de l&apos;équipe</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Ajoutez des collaborateurs. Ils se connectent avec leur identifiant et leur mot de passe.
              Pour supprimer une facture, un produit, etc., ils confirment avec <strong>leur propre mot de passe</strong>.
              Seul le compte propriétaire voit cet onglet.
            </p>
            <div className="grid grid-2" style={{ marginBottom: 12 }}>
              <div className="form-row">
                <label>Identifiant</label>
                <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="ex: secretaire" />
              </div>
              <div className="form-row">
                <label>Nom affiché</label>
                <input value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} placeholder="ex: Fatima — secrétariat" />
              </div>
              <div className="form-row">
                <label>Mot de passe</label>
                <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Rôle</label>
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="stock">Magasinier (scan, stock, proposer produit · pas de caisse)</option>
                  <option value="secretaire">Secrétaire (tout le métier · pas admin serveur)</option>
                  <option value="admin">Admin (stock &amp; ventes)</option>
                  <option value="user">Lecture limitée</option>
                </select>
              </div>
            </div>
            <button type="button" onClick={createUser}>Créer l&apos;utilisateur</button>

            {editingUser && (
              <div className="atlas-card" style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 15, marginBottom: 10 }}>Modifier « {editingUser.username} »</h3>
                <div className="grid grid-2" style={{ marginBottom: 12 }}>
                  <div className="form-row">
                    <label>Nom affiché</label>
                    <input value={editingUser.display_name || ''} onChange={(e) => setEditingUser({ ...editingUser, display_name: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label>Rôle</label>
                    <select value={editingUser.role || 'secretaire'} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}>
                      <option value="stock">Magasinier (scan, stock, proposer produit · pas de caisse)</option>
                      <option value="secretaire">Secrétaire (tout le métier · pas admin serveur)</option>
                      <option value="admin">Admin (stock &amp; ventes)</option>
                      <option value="user">Lecture limitée</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Nouveau mot de passe (optionnel)</label>
                    <input type="password" value={editingUser.password || ''} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} placeholder="Laisser vide = inchangé" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => {
                    setPwTitle(`Modifier « ${editingUser.username} »`);
                    setPendingAction(() => async (password: string) => {
                      await api.updateAdminUser(editingUser.id, {
                        confirm_password: password,
                        display_name: editingUser.display_name,
                        role: editingUser.role,
                        password: editingUser.password || undefined,
                      });
                      flash('Utilisateur mis à jour.');
                      setEditingUser(null);
                      setPwOpen(false); setPendingAction(null);
                      await reloadAdmin();
                    });
                    setPwOpen(true);
                  }}>Enregistrer</button>
                  <button type="button" className="secondary" onClick={() => setEditingUser(null)}>Annuler</button>
                </div>
              </div>
            )}

            <table className="data-table" style={{ marginTop: 20, width: '100%' }}>
              <thead>
                <tr>
                  <th>Identifiant</th>
                  <th>Nom affiché</th>
                  <th>Rôle</th>
                  <th>Créé le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.length === 0 && (
                  <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Aucun utilisateur secondaire</td></tr>
                )}
                {adminUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.display_name || '—'}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td style={{ fontSize: 12 }}>{u.created_at}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }}
                        onClick={() => setEditingUser({ ...u, password: '' })}>
                        Modifier
                      </button>
                      <button type="button" className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteUser(u.id, u.username)}>
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Matrice des permissions</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Droits effectifs par rôle (contrôlés côté serveur). Le compte principal (admin) dispose de tous les droits.
            </p>
            <div className="table-wrap">
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Utilisateur</th>
                    <th>Magasinier</th>
                    <th>Secrétaire</th>
                    <th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Consulter stock / produits / scan', 'Oui', 'Oui', 'Oui', 'Oui'],
                    ['Proposer nouveau produit (→ PC)', '—', 'Oui', 'Oui', 'Oui'],
                    ['Ajuster stock (demande → PC)', '—', 'Oui', 'Oui', 'Oui'],
                    ['Consulter factures / rapports argent', 'Oui', '—', 'Oui', 'Oui'],
                    ['Créer / modifier ventes, achats, clients', '—', '—', 'Oui', 'Oui'],
                    ['Vente rapide / encaissement', '—', '—', 'Oui', 'Oui'],
                    ['Annuler (void) une facture', '—', '—', 'Oui', 'Oui'],
                    ['Supprimer produits / bulk', '—', '—', 'Oui', 'Oui'],
                    ['Paramètres entreprise / PDF', '—', '—', '—', 'Oui'],
                    ['Gérer utilisateurs & audit', '—', '—', '—', 'Oui'],
                    ['Clôture de période fiscale', '—', '—', '—', 'Oui'],
                    ['Clés API & webhooks', '—', '—', '—', 'Oui'],
                    ['Export archive / secrets', '—', '—', '—', 'Oui'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td style={{ textAlign: 'center', color: row[1] === 'Oui' ? 'var(--ok, #0a7)' : 'var(--muted)' }}>{row[1]}</td>
                      <td style={{ textAlign: 'center', color: row[2] === 'Oui' ? 'var(--ok, #0a7)' : 'var(--muted)' }}>{row[2]}</td>
                      <td style={{ textAlign: 'center', color: row[3] === 'Oui' ? 'var(--ok, #0a7)' : 'var(--muted)' }}>{row[3]}</td>
                      <td style={{ textAlign: 'center', color: row[4] === 'Oui' ? 'var(--ok, #0a7)' : 'var(--muted)' }}>{row[4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Journal d&apos;audit</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Historique des actions sensibles — section dédiée.
            </p>
            <button type="button" className="secondary" onClick={() => setActiveTab('audit')}>
              Ouvrir le journal d&apos;audit
            </button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Pack mensuel (sauvegarde comptable)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Export propriétaire : factures, paiements, mouvements de stock et dépenses du mois (JSON ou CSV multi-sections).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
              <div className="form-row" style={{ margin: 0 }}>
                <label>Mois</label>
                <input
                  type="month"
                  id="atlas-month-pack"
                  defaultValue={new Date().toISOString().slice(0, 7)}
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  const el = document.getElementById('atlas-month-pack') as HTMLInputElement | null;
                  const month = el?.value || new Date().toISOString().slice(0, 7);
                  try {
                    await api.exportMonthPack(month, 'json');
                    flash(`Pack ${month} (JSON) téléchargé.`);
                  } catch (e: any) {
                    flash(e?.message || 'Échec export', 'error');
                  }
                }}
              >
                JSON
              </button>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const el = document.getElementById('atlas-month-pack') as HTMLInputElement | null;
                  const month = el?.value || new Date().toISOString().slice(0, 7);
                  try {
                    await api.exportMonthPack(month, 'csv');
                    flash(`Pack ${month} (CSV) téléchargé.`);
                  } catch (e: any) {
                    flash(e?.message || 'Échec export', 'error');
                  }
                }}
              >
                CSV
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Intégrité &amp; régression E2E</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Contrôle stock négatif / numéros doublons, puis scénario éphémère sell → pay → WR (nettoyage auto).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    const r: any = await api.getIntegrityStatus();
                    const d = r.data || {};
                    flash(
                      d.ok
                        ? `OK — stock négatif: ${d.negative_stock_products}, doublons n°: ${d.duplicate_invoice_numbers}`
                        : `Attention — stock négatif: ${d.negative_stock_products}, doublons n°: ${d.duplicate_invoice_numbers}`,
                      d.ok ? 'success' : 'error',
                    );
                  } catch (e: any) {
                    flash(e?.message || 'Échec', 'error');
                  }
                }}
              >
                Statut intégrité
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r: any = await api.runIntegrityRegression();
                    const steps = r.data?.steps || r.steps || [];
                    const failed = steps.filter((s: any) => !s.ok);
                    if (failed.length) {
                      flash(`Régression: ${failed.length} échec(s) — ${failed.map((f: any) => f.name).join(', ')}`, 'error');
                    } else {
                      flash(r.message || `Régression OK (${steps.length} étapes)`);
                    }
                  } catch (e: any) {
                    flash(e?.message || 'Échec régression', 'error');
                  }
                }}
              >
                Lancer régression E2E
              </button>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Serveur</h2>
            <p style={{ fontSize: 13 }}>Environnement : <strong>{adminConfig?.environment || '—'}</strong></p>
            <p style={{ fontSize: 13 }}>OTP vers : <strong>{adminConfig?.otp_to || '—'}</strong></p>
            <p style={{ fontSize: 13 }}>OTP de : <strong>{adminConfig?.otp_from || '—'}</strong></p>
            <p style={{ fontSize: 13 }}>
              Secret ADMIN_PASSWORD :{' '}
              <strong style={{ color: adminConfig?.password_configured ? 'var(--ok, green)' : 'var(--bad, red)' }}>
                {adminConfig?.password_configured ? 'configuré' : 'manquant'}
              </strong>
            </p>
          </div>
        </div>
      )}

      </div>{/* settings-main */}
      </div>{/* settings-shell */}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description="Saisissez votre mot de passe pour confirmer cette action."
          confirmLabel="Confirmer"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}

      <div className="card" style={{ marginTop: 20, background: 'var(--stone)', borderColor: 'transparent' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          <strong>Sécurité :</strong> Le mot de passe administrateur est géré de façon sécurisée côté serveur et n'est jamais stocké dans la base de données ni affiché dans cette interface.
        </p>
      </div>
    </div>
  );
}


function PeriodLockPanel() {
  const [period, setPeriod] = useState('');
  const [msg, setMsg] = useState('');
  const isOwner = (typeof getRole === 'function' ? getRole() : '') === 'owner';
  useEffect(() => {
    api.getPeriodLock().then((r: any) => setPeriod(r.data?.fiscal_locked_through || '')).catch(() => {});
  }, []);
  const save = async (clear = false) => {
    try {
      const r: any = await api.setPeriodLock(clear ? { clear: true } : { fiscal_locked_through: period });
      setMsg(r.message || 'OK');
      if (clear) setPeriod('');
    } catch (e: any) {
      setMsg(e?.message || 'Erreur');
    }
  };
  return (
    <div>
      <div className="form-row" style={{ maxWidth: 200 }}>
        <label>Clôturé jusqu&apos;à (YYYY-MM)</label>
        <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" disabled={!isOwner} />
      </div>
      {isOwner ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => save(false)}>Enregistrer la clôture</button>
          <button type="button" className="secondary" onClick={() => save(true)}>Rouvrir</button>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Lecture seule — contactez le propriétaire.</p>
      )}
      {msg && <p style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}