/**
 * Atlas Agent — dock + P0/P1/P2: citations, tools, drafts, stream UX, history, voice, role chips.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import { isStockRole, canOfficeWork, canSell } from '../auth';
import AgentPermissionsPanel from './AgentPermissionsPanel';
import { setDensity, type Density } from '../lib/density';
import { isDemoMode, demoCreateClient, demoCreateProduct } from '../lib/demoMode';
import { uiToast } from './AppDialogs';

function IconHistory({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconNewChat({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function IconMic({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}
function IconSend({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function IconSettings({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function IconStop({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1a2e2a" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}



type ToolTrace = { name: string; ok?: boolean; error?: string; data?: unknown };
type Msg = {
  role: 'user' | 'assistant';
  text: string;
  ms?: number;
  tools?: ToolTrace[];
  proposals?: Array<Record<string, any>>;
  sources?: { label: string; href: string }[];
  failed?: boolean;
  prompt?: string;
  streaming?: boolean;
};

type ThreadMeta = { id: string; title: string; updated: number };

const OPEN_KEY = 'atlas_agent_open';
const AGENT_EXEC_MODE_KEY = 'atlas_agent_exec_mode'; // 'ask' | 'auto'
const MSGS_KEY = 'atlas_agent_msgs_v1';
const THREADS_KEY = 'atlas_agent_threads_v1';
const ACTIVE_THREAD_KEY = 'atlas_agent_active_thread';

function pageMeta(pathname: string): { title: string; hint: string; path: string } {
  if (pathname.startsWith('/products'))
    return { title: 'Produits & stock', hint: 'Catalogue, stock, étiquettes.', path: pathname };
  if (pathname.startsWith('/actions'))
    return { title: 'Boîte d’actions', hint: 'Demandes téléphone à valider.', path: pathname };
  if (pathname.startsWith('/invoices'))
    return { title: 'Factures', hint: 'Factures et paiements.', path: pathname };
  if (pathname.startsWith('/quotes'))
    return { title: 'Devis', hint: 'Estimations non comptabilisées.', path: pathname };
  if (pathname.startsWith('/quick-sale'))
    return { title: 'Vente rapide', hint: 'Caisse / tickets.', path: pathname };
  if (pathname.startsWith('/clients'))
    return { title: 'Clients', hint: 'Fiches clients.', path: pathname };
  if (pathname.startsWith('/mailbox'))
    return {
      title: 'Messagerie',
      hint: 'Lis les mails, propose une réponse, signale impayés clients, ouvre devis/facture/TVA si besoin. Dis "réponse à ce mail" ou "qui doit payer".',
      path: pathname,
    };
  if (pathname.startsWith('/settings'))
    return { title: 'Paramètres', hint: 'Profil et société.', path: pathname };
  if (pathname.startsWith('/reports'))
    return { title: 'Rapports', hint: 'Clôture et indicateurs.', path: pathname };
  if (pathname === '/' || pathname === '')
    return { title: 'Tableau de bord', hint: 'Vue d’ensemble du jour.', path: '/' };
  return { title: 'Atlas Commerce', hint: pathname, path: pathname };
}

function sourcesFromTools(tools: ToolTrace[]): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const seen = new Set<string>();
  const add = (label: string, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    out.push({ label, href });
  };
  for (const t of tools) {
    if (!t.ok) continue;
    const d: any = t.data;
    if (t.name === 'list_low_stock' || t.name === 'search_products') {
      const items = d?.items || d || [];
      if (Array.isArray(items)) {
        for (const p of items.slice(0, 5)) {
          if (p?.id) add(String(p.name || p.sku || `Produit #${p.id}`), `/products?highlight=${p.id}`);
        }
      }
      add('Produits & stock', '/products');
    }
    if (t.name === 'list_actions_pending' || t.name === 'summarize_pending_actions') {
      add('Boîte d’actions', '/actions');
    }
    if (t.name === 'list_unpaid_invoices' || t.name === 'list_recent_invoices' || t.name === 'get_invoice_brief') {
      const items = d?.items || (d?.id ? [d] : []);
      if (Array.isArray(items)) {
        for (const inv of items.slice(0, 4)) {
          if (inv?.id) add(String(inv.number || `FA #${inv.id}`), `/invoices/${inv.id}`);
        }
      }
      add('Factures', '/invoices');
    }
    if (t.name === 'list_open_quotes') add('Devis', '/quotes');
    if (t.name === 'search_clients') add('Clients', '/clients');
    if (t.name === 'list_recent_mail' || t.name === 'get_mail_brief') add('Messagerie', '/mailbox');
    if (t.name === 'get_dashboard_snapshot' || t.name === 'draft_day_close_report') {
      add('Tableau de bord', '/');
    }
    if (t.name === 'warehouse_stock' || t.name === 'list_warehouses') {
      add('Produits & stock', '/products');
    }
    if (t.name === 'closing_pack') {
      const cl = d?.checklist || [];
      if (Array.isArray(cl)) {
        for (const c of cl) {
          if (c?.href && c?.label) add(`${c.label}${c.count != null ? ` (${c.count})` : ''}`, c.href);
        }
      }
    }
    if (t.name === 'propose_quote_lines') add('Ouvrir Devis', '/quotes');
    if (t.name === 'draft_client_message' && d?.client?.id) {
      add(String(d.client.name || 'Client'), '/clients');
    }
    if (t.name === 'explain_pending_action') add('Boîte d’actions', '/actions');
  }
  return out.slice(0, 10);
}

const WELCOME: Msg = {
  role: 'assistant',
  text: 'Bonjour — je suis Atlas Agent. Je reste ouvert quand vous changez de page. Posez une question ou utilisez une suggestion.',
};

function loadThreads(): ThreadMeta[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveThreads(list: ThreadMeta[]) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* */ }
}

function msgsKey(threadId: string) {
  return `${MSGS_KEY}:${threadId}`;
}

function loadMsgs(threadId: string): Msg[] {
  try {
    const raw = sessionStorage.getItem(msgsKey(threadId)) || sessionStorage.getItem(MSGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.slice(-40);
  } catch { /* */ }
  return [];
}

function saveMsgs(threadId: string, msgs: Msg[]) {
  try {
    sessionStorage.setItem(msgsKey(threadId), JSON.stringify(msgs.slice(-40)));
  } catch { /* */ }
}

function newThreadId() {
  return `t-${Date.now().toString(36)}`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = start(now) - start(d);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 86400000) return 'Hier';
  return d.toLocaleDateString('fr-MA', { day: 'numeric', month: 'short' });
}


function timeGreeting(): { hello: string; sub: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) {
    return { hello: 'Bonjour', sub: 'Que faisons-nous aujourd’hui ?' };
  }
  if (h >= 12 && h < 18) {
    return { hello: 'Bon après-midi', sub: 'Stock, factures ou dépenses ?' };
  }
  return { hello: 'Bonsoir', sub: 'Besoin d’un résumé des ventes du jour ?' };
}

type ExecMode = 'ask' | 'auto';

function getExecMode(): ExecMode {
  try {
    return localStorage.getItem(AGENT_EXEC_MODE_KEY) === 'auto' ? 'auto' : 'ask';
  } catch {
    return 'ask';
  }
}

type LocalAction =
  | { type: 'navigate'; path: string; draft?: Record<string, string>; label: string }
  | { type: 'density'; value: Density; label: string }
  | { type: 'open_perms'; label: string }
  | { type: 'create_client'; name: string; ice?: string; phone?: string; email?: string; label: string }
  | { type: 'create_product'; name: string; price?: number; stock?: number; sku?: string; label: string };

/** Lightweight local intent parser for common UI actions (no LLM required). */
function parseLocalAction(text: string, currentPath = ''): LocalAction | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const path = (currentPath || '').split('?')[0].replace(/\/+$/, '') || '/';

  // Advice on current page — never "open this page" (bottom chips already navigate)
  if (
    /que faire|quoi faire|comment (faire|utiliser)|aide sur|sur (cette|la) page|page actuelle/.test(t)
  ) {
    return null;
  }


  // Density
  if (/compact|densité\s*compact/.test(t)) {
    return { type: 'density', value: 'compact', label: 'Passer l’interface en mode Compact' };
  }
  if (/confort|comfortable|densité\s*confort/.test(t)) {
    return { type: 'density', value: 'comfortable', label: 'Passer l’interface en mode Confort' };
  }

  // Permissions
  if (/permission|droits?\s+agent|outils?\s+agent/.test(t)) {
    return { type: 'open_perms', label: 'Ouvrir les permissions Atlas Agent' };
  }

  // Client creation
  if (/\b(cr[ée]er?|ajoute?r?|nouveau)\b.*\bclient\b|\bclient\b.*\b(nomm[ée]|appel[ée])\b/.test(t) || /client\s+avec\s+/.test(t) || /^client\s+/.test(t)) {
    const ice = (t.match(/\b(\d{15})\b/) || [])[1] || '';
    let name = '';
    const m1 = text.match(/client(?:e)?\s+(?:nomm[ée]e?|appel[ée]e?|avec(?:\s+nom)?)\s+["']?([^"'.\d]+?)["']?(?:\s+avec|\s+ice|$)/i);
    const m2 = text.match(/(?:cr[ée]er?|ajoute?r?)\s+(?:un\s+)?client\s+["']?([^"'.]+?)["']?(?:\s+avec|\s+ice|$)/i);
    const m3 = text.match(/client\s+avec\s+(?:nom\s+)?["']?([a-zA-ZÀ-ÿ][\wÀ-ÿ\s-]{1,60})["']?/i);
    name = (m1?.[1] || m2?.[1] || m3?.[1] || '').trim();
    // "create a client with haytam name" / "client haytam"
    if (!name) {
      const m4 = text.match(/client(?:e)?\s+["']?([a-zA-ZÀ-ÿ][\wÀ-ÿ-]{1,40})["']?/i);
      if (m4 && !/^(avec|nommé|nommee|nouveau|nouvelle)$/i.test(m4[1])) name = m4[1].trim();
    }
    if (name) {
      return {
        type: 'create_client',
        name,
        ice: ice || undefined,
        label: `Créer le client « ${name} »`,
      };
    }
    return {
      type: 'navigate',
      path: '/clients',
      draft: { open: '1' },
      label: 'Ouvrir la création de client',
    };
  }
  // Product creation
  if (/\b(cr[ée]er?|ajoute?r?|nouveau)\b.*\bproduit\b/.test(t)) {
    const m = text.match(/produit\s+["']?([^"']{2,60})["']?/i);
    const name = (m?.[1] || '').trim();
    const priceM = t.match(/(\d+[.,]?\d*)\s*(?:dh|mad|dh\b)/);
    const price = priceM ? Number(priceM[1].replace(',', '.')) : 0;
    if (name) {
      return { type: 'create_product', name, price, label: `Créer le produit « ${name} »` };
    }
    return { type: 'navigate', path: '/products', draft: { open: '1' }, label: 'Ouvrir la création produit' };
  }

  // Expense / charge
  if (/\b(d[ée]pense|charge|frais)\b/.test(t) || /ajouter?\s+\d+/.test(t) && /dh|mad|dirham/.test(t)) {
    const amount = (t.match(/(\d+[\s.,]?\d*)\s*(?:dh|mad|dirhams?)?/) || [])[1]?.replace(/\s/g, '').replace(',', '.') || '';
    const cat = /transport|essence|carburant/.test(t)
      ? 'Transport'
      : /loyer|location/.test(t)
        ? 'Loyer'
        : /fourniture|bureau/.test(t)
          ? 'Fournitures'
          : '';
    return {
      type: 'navigate',
      path: '/balance',
      draft: { amount, category: cat, open: 'expense' },
      label: amount ? `Préparer une dépense de ${amount} MAD` : 'Ouvrir la saisie de dépense',
    };
  }

  // Daily report — only if user asks to OPEN it, not "what to do on reports"
  if (
    /\b(ouvrir|va[s]? sur|aller|montre|affiche)\b/.test(t) &&
    /rapport|cl[ôo]ture|ventes?\s+du\s+jour|daily\s+report/.test(t)
  ) {
    if (path === '/reports' || path.endsWith('/reports')) return null;
    return { type: 'navigate', path: '/reports', label: 'Ouvrir les rapports / clôture' };
  }

  // Invoice
  if (/\b(facture|devis)\b/.test(t) && /\b(cr[ée]er?|nouvelle?|nouveau)\b/.test(t)) {
    return { type: 'navigate', path: '/invoices', draft: { open: '1' }, label: 'Ouvrir la création de facture' };
  }

  return null;
}


function scrubVendorNames(s: string) {
  return String(s || '')
    .replace(/\b(Google|Gemini|Mistral|OpenAI|ChatGPT|Claude|Anthropic)\b/gi, 'Atlas Agent')
    .trim();
}
function clipAgent(s: string) {
  return String(s || '')
    .replace(/^(NO introductory phrases|No introductory phrases)[.\s]*/i, '')
    .trim();
}


export default function AtlasAgent() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageMeta(location.pathname);
  const stockOnly = isStockRole();
  const isPhoneShell = (() => {
    try {
      return document.documentElement.classList.contains('phone-shell')
        || /\/m(\/|$)/.test(location.pathname)
        || window.matchMedia('(max-width: 720px) and (pointer: coarse)').matches;
    } catch {
      return false;
    }
  })();

  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [threadId, setThreadId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_THREAD_KEY) || newThreadId();
    } catch {
      return newThreadId();
    }
  });
  const [threads, setThreads] = useState<ThreadMeta[]>(() => loadThreads());
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const next = detail?.open !== false;
      setOpen(next);
      try {
        sessionStorage.setItem(OPEN_KEY, next ? '1' : '0');
        document.documentElement.classList.toggle('atlas-agent-docked', next);
      } catch { /* */ }
    };
    window.addEventListener('atlas-agent-open', onOpen as EventListener);
    return () => window.removeEventListener('atlas-agent-open', onOpen as EventListener);
  }, []);

  // Mobile: close drawer when navigating away from /m/agent (or any route change if not agent tab)
  useEffect(() => {
    if (!isPhoneShell) return;
    const onAgentRoute = /^\/m\/?agent/.test(location.pathname) || location.pathname === '/agent';
    if (!onAgentRoute && open) {
      setOpen(false);
      try {
        sessionStorage.setItem(OPEN_KEY, '0');
        document.documentElement.classList.remove('atlas-agent-docked');
      } catch { /* */ }
    }
  }, [location.pathname, isPhoneShell, open]);
  const [showPerms, setShowPerms] = useState(false);
  const [execMode, setExecMode] = useState<ExecMode>(() => getExecMode());
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem('atlas_agent_width') || 380);
      return Number.isFinite(n) ? Math.min(800, Math.max(320, n)) : 380;
    } catch {
      return 380;
    }
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [pendingAction, setPendingAction] = useState<LocalAction | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const id = (() => {
      try {
        return localStorage.getItem(ACTIVE_THREAD_KEY) || '';
      } catch {
        return '';
      }
    })();
    const saved = id ? loadMsgs(id) : [];
    return saved.length ? saved : [WELCOME];
  });
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevPath = useRef(location.pathname);
  const abortRef = useRef<AbortController | null>(null);
  const streamTimer = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--atlas-agent-w', `${panelWidth}px`);
    try { localStorage.setItem('atlas_agent_width', String(panelWidth)); } catch { /* */ }
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.startX - e.clientX;
      const maxW = Math.min(800, Math.floor(window.innerWidth * 0.5));
      const next = Math.min(maxW, Math.max(320, dragRef.current.startW + dx));
      setPanelWidth(next);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
      localStorage.setItem(ACTIVE_THREAD_KEY, threadId);
    } catch { /* */ }
    document.documentElement.classList.toggle('atlas-agent-docked', open);
    return () => document.documentElement.classList.remove('atlas-agent-docked');
  }, [open, threadId]);

  useEffect(() => {
    saveMsgs(threadId, msgs);
  }, [msgs, threadId]);

  useEffect(() => {
    if (prevPath.current === location.pathname) return;
    prevPath.current = location.pathname;
    if (!open) return;
    setMsgs((m) => [
      ...m,
      {
        role: 'assistant',
        text: `Vous êtes sur « ${page.title} ». ${page.hint} Que puis-je faire ici ?`,
      },
    ]);
  }, [location.pathname, open, page.title, page.hint]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, open, busy]);

  useEffect(() => {
    return () => {
      if (streamTimer.current) window.clearInterval(streamTimer.current);
      try {
        recognitionRef.current?.stop?.();
      } catch { /* */ }
    };
  }, []);

  const streamText = (full: string, meta: Omit<Msg, 'role' | 'text' | 'streaming'>) => {
    const idPlaceholder = { role: 'assistant' as const, text: '', streaming: true, ...meta };
    setMsgs((m) => [...m, idPlaceholder]);
    let i = 0;
    if (streamTimer.current) window.clearInterval(streamTimer.current);
    streamTimer.current = window.setInterval(() => {
      i += Math.max(2, Math.ceil(full.length / 40));
      const slice = full.slice(0, i);
      setMsgs((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.streaming) {
          copy[copy.length - 1] = { ...last, text: slice, streaming: i < full.length };
        }
        return copy;
      });
      if (i >= full.length) {
        if (streamTimer.current) window.clearInterval(streamTimer.current);
        streamTimer.current = null;
      }
    }, 28);
  };

  const touchThread = (title: string) => {
    setThreads((prev) => {
      const next = [{ id: threadId, title: title.slice(0, 48), updated: Date.now() }, ...prev.filter((t) => t.id !== threadId)].slice(0, 20);
      saveThreads(next);
      return next;
    });
  };


  const applyAction = useCallback(
    async (action: LocalAction, confirmed = false) => {
      if (execMode === 'ask' && !confirmed) {
        setPendingAction(action);
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Action préparée : ${action.label}. Confirmez pour exécuter, ou passez en mode « Automatiquement ».`,
          },
        ]);
        return;
      }
      setPendingAction(null);
      if (action.type === 'density') {
        setDensity(action.value);
        try { uiToast(`Densité : ${action.value === 'compact' ? 'Compact' : 'Confort'}`, 'success'); } catch { /* */ }
        setMsgs((m) => [...m, { role: 'assistant', text: `C’est fait — interface en mode ${action.value === 'compact' ? 'Compact' : 'Confort'}.` }]);
        return;
      }
      if (action.type === 'open_perms') {
        setShowPerms(true);
        setShowHistory(false);
        setMsgs((m) => [...m, { role: 'assistant', text: 'Panneau des permissions ouvert.' }]);
        return;
      }
      if (action.type === 'create_client') {
        try {
          if (isDemoMode()) {
            const row = demoCreateClient({ name: action.name, ice: action.ice, phone: action.phone, email: action.email });
            try { uiToast(`Client démo « ${action.name} » créé`, 'success'); } catch { /* */ }
            setMsgs((m) => [
              ...m,
              { role: 'assistant', text: `Client « ${action.name} » créé dans le sandbox démo (#${row.id}). Les données réelles n’ont pas été modifiées.` },
            ]);
          } else {
            const body: Record<string, string> = { name: action.name };
            if (action.ice) body.ice = action.ice;
            if (action.phone) body.phone = action.phone;
            if (action.email) body.email = action.email;
            const res: any = await api.createClient(body);
            const id = res?.data?.id;
            try { uiToast(`Client « ${action.name} » créé`, 'success'); } catch { /* */ }
            setMsgs((m) => [
              ...m,
              { role: 'assistant', text: `Client « ${action.name} » créé avec succès${id ? ` (#${id})` : ''}.` },
            ]);
          }
          navigate('/clients');
        } catch (e: any) {
          setMsgs((m) => [...m, { role: 'assistant', text: friendlyError(e) || 'Création client impossible.' }]);
        }
        return;
      }
      if (action.type === 'create_product') {
        try {
          if (isDemoMode()) {
            demoCreateProduct({
              name: action.name,
              price: action.price ?? 0,
              stock_quantity: action.stock ?? 0,
              sku: action.sku,
            });
            try { uiToast(`Produit démo « ${action.name} » créé`, 'success'); } catch { /* */ }
            setMsgs((m) => [...m, { role: 'assistant', text: `Produit « ${action.name} » créé dans le sandbox démo.` }]);
          } else {
            await api.createProduct({
              name: action.name,
              price: action.price ?? 0,
              stock_quantity: action.stock ?? 0,
              unit: 'unité',
              category: 'Général',
              track_inventory: 1,
              sku: action.sku || undefined,
            });
            try { uiToast(`Produit « ${action.name} » créé`, 'success'); } catch { /* */ }
            setMsgs((m) => [...m, { role: 'assistant', text: `Produit « ${action.name} » créé avec succès.` }]);
          }
          navigate('/products');
        } catch (e: any) {
          setMsgs((m) => [...m, { role: 'assistant', text: friendlyError(e) || 'Création produit impossible.' }]);
        }
        return;
      }
      if (action.type === 'navigate') {
        const here = (location.pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
        const dest = (action.path || '').split('?')[0].replace(/\/+$/, '') || '/';
        if (here === dest || here.endsWith(dest)) {
          setMsgs((m) => [
            ...m,
            {
              role: 'assistant',
              text: `Vous êtes déjà sur cet écran. Utilisez les raccourcis en bas si besoin.`,
            },
          ]);
          return;
        }
        if (action.draft) {
          try {
            sessionStorage.setItem('atlas_agent_form_draft', JSON.stringify({ path: action.path, ...action.draft }));
          } catch { /* */ }
        }
        navigate(action.path);
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: execMode === 'auto'
              ? `Exécuté : ${action.label}.`
              : `J’ouvre « ${action.label} ».`,
          },
        ]);
      }
    },
    [execMode, navigate, location.pathname],
  );

  const send = useCallback(
    async (raw?: string, isRetry = false) => {
      const q = (raw ?? input).trim();
      if (!q || busy) return;
      if (!isRetry) setInput('');
      if (!isRetry) setMsgs((m) => [...m, { role: 'user', text: q }]);
      touchThread(q);

      // Local UI actions (client, expense, density, permissions) — no round-trip
      const local = parseLocalAction(q, location.pathname);
      if (local) {
        void applyAction(local);
        return;
      }

      setBusy(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const t0 = performance.now();
      try {
        const prompt = [
          `L'utilisateur est DÉJÀ sur la page: ${page.title} (${page.path}). ${page.hint}`,
          'Réponds en français, 1–2 phrases. Explique quoi faire SUR CETTE page.',
          'N\'ouvre pas et ne propose pas d\'ouvrir la page courante (les boutons du bas suffisent).',
          `Question: ${q}`,
        ].join('\n');
        const res = await api.assistChat(prompt, {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Casablanca',
          thread_id: threadId,
        });
        if (ac.signal.aborted) return;
        const ms = Math.round(performance.now() - t0);
        const tools: ToolTrace[] = (res.data?.tool_trace || []).map((t: any) => ({
          name: t.name,
          ok: t.ok !== false,
          error: t.error,
          data: t.data,
        }));
        const sources = sourcesFromTools(tools);
        const reply = clipAgent(res.data?.reply || 'Pas de réponse.');
        streamText(reply, {
          ms,
          tools,
          sources,
          proposals: res.data?.proposals || [],
          prompt: q,
        });
      } catch (e: any) {
        if (ac.signal.aborted) {
          setMsgs((m) => [
            ...m,
            { role: 'assistant', text: 'Requête arrêtée.', ms: Math.round(performance.now() - t0) },
          ]);
          return;
        }
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: friendlyError(e) || 'Je ne peux pas répondre pour le moment. Réessayez.',
            ms: Math.round(performance.now() - t0),
            failed: true,
            prompt: q,
          },
        ]);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, input, page, threadId, applyAction, location.pathname],
  );

  const stop = () => {
    abortRef.current?.abort();
    if (streamTimer.current) {
      window.clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
    setBusy(false);
    setMsgs((m) =>
      m.map((x) => (x.streaming ? { ...x, streaming: false } : x)),
    );
  };

  const clearThread = () => {
    const id = newThreadId();
    setThreadId(id);
    setMsgs([WELCOME]);
    setShowHistory(false);
    try {
      localStorage.setItem(ACTIVE_THREAD_KEY, id);
    } catch { /* */ }
  };

  const openThread = (id: string) => {
    setThreadId(id);
    const saved = loadMsgs(id);
    setMsgs(saved.length ? saved : [WELCOME]);
    setShowHistory(false);
    try {
      localStorage.setItem(ACTIVE_THREAD_KEY, id);
    } catch { /* */ }
  };

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMsgs((m) => [
        ...m,
        { role: 'assistant', text: 'La dictée vocale n’est pas disponible sur ce navigateur (Web Speech API).' },
      ]);
      return;
    }
    if (listening) {
      try { recognitionRef.current?.stop?.(); } catch { /* */ }
      setListening(false);
      return;
    }
    try {
      const rec = new SR();
      recognitionRef.current = rec;
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onstart = () => setListening(true);
      rec.onresult = (ev: any) => {
        let transcript = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          transcript += ev.results[i][0]?.transcript || '';
        }
        transcript = transcript.trim();
        if (transcript) setInput(transcript);
        if (ev.results[ev.results.length - 1]?.isFinal) {
          setListening(false);
        }
      };
      rec.onerror = (ev: any) => {
        setListening(false);
        const code = String(ev?.error || '');
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setMsgs((m) => [
            ...m,
            { role: 'assistant', text: 'Micro refusé — autorisez le microphone dans le navigateur pour dicter.' },
          ]);
        } else if (code && code !== 'aborted' && code !== 'no-speech') {
          setMsgs((m) => [
            ...m,
            { role: 'assistant', text: `Dictée interrompue (${code}). Réessayez.` },
          ]);
        }
      };
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
      setMsgs((m) => [
        ...m,
        { role: 'assistant', text: 'Impossible de démarrer la dictée. Vérifiez les permissions micro.' },
      ]);
    }
  };

  const approve = async (id: string) => {
    try {
      const r = await api.assistApprove(id);
      setMsgs((m) => [
        ...m,
        { role: 'assistant', text: r.data?.message || 'Proposition envoyée à la boîte d’actions.' },
      ]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: friendlyError(e) }]);
    }
  };

  const go = (path: string, label: string) => {
    navigate(path);
    setMsgs((m) => [...m, { role: 'assistant', text: `J’ouvre « ${label} » pour vous.` }]);
  };

  const groupedHistory = () => {
    const groups: Record<string, ThreadMeta[]> = {};
    for (const th of threads) {
      const g = dayLabel(th.updated);
      (groups[g] ||= []).push(th);
    }
    return groups;
  };

  return (
    <>
{!isPhoneShell && (
            <button
        type="button"
        className={`atlas-agent-fab atlas-agent-fab-accent ${open ? 'on' : ''}`}
        aria-label={open ? 'Masquer Atlas Agent' : 'Ouvrir Atlas Agent'}
        title="Atlas Agent"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            try {
              document.documentElement.classList.toggle('atlas-agent-docked', next);
              sessionStorage.setItem(OPEN_KEY, next ? '1' : '0');
            } catch { /* */ }
            return next;
          });
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          <circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </button>
      )}

      <aside className={`atlas-agent-panel ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Atlas Agent" style={{ width: panelWidth }}>
        <div
          className="atlas-agent-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau agent"
          onPointerDown={(e) => {
            e.preventDefault();
            dragRef.current = { startX: e.clientX, startW: panelWidth };
          }}
        />
        <header className="atlas-agent-head">
          <div>
            <strong>Atlas Agent</strong>
            <span>Je suis là pour vous aider sur Atlas Commerce</span>
          </div>
          {!isPhoneShell && (
          <div className="atlas-agent-head-actions">
            <div className="atlas-agent-perm-wrap">
              <button
                type="button"
                className={`atlas-agent-iconbtn${showPerms ? ' on' : ''}`}
                title="Permissions de l’agent"
                aria-expanded={showPerms}
                aria-label="Permissions de l’agent"
                onClick={(e) => {
                  const btn = e.currentTarget;
                  const r = btn.getBoundingClientRect();
                  (btn as any)._portalPos = { top: r.bottom + 6, right: window.innerWidth - r.right };
                  setShowPerms((v) => !v);
                  setShowHistory(false);
                }}
              >
                <IconSettings />
              </button>
              {showPerms &&
                typeof document !== 'undefined' &&
                createPortal(
                  <>
                    <button
                      type="button"
                      className="atlas-agent-float-backdrop"
                      aria-label="Fermer"
                      onClick={() => setShowPerms(false)}
                    />
                    <div
                      className="atlas-agent-perm-popover atlas-agent-perm-popover--portal"
                      role="dialog"
                      aria-label="Permissions Atlas Agent"
                      style={{ position: 'fixed', top: 56, right: 16, zIndex: 10050, maxHeight: 'min(70vh, 480px)', overflowY: 'auto' }}
                    >
                      <AgentPermissionsPanel
                        compact
                        onSaved={() => { /* status handled inside panel */ }}
                      />
                    </div>
                  </>,
                  document.body,
                )}
            </div>
            <button
              type="button"
              className="atlas-agent-iconbtn"
              title="Historique"
              onClick={() => {
                setShowHistory((v) => !v);
                setShowPerms(false);
              }}
            >
              <IconHistory />
            </button>
            <button type="button" className="atlas-agent-iconbtn" title="Nouvelle conversation" onClick={clearThread}>
              <IconNewChat />
            </button>
            <button type="button" className="atlas-agent-close" aria-label="Fermer" onClick={() => {
          setOpen(false);
          try {
            document.documentElement.classList.remove('atlas-agent-docked');
            sessionStorage.setItem(OPEN_KEY, '0');
          } catch { /* */ }
        }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a2e2a" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          )}
        </header>

        {showHistory && (
          <div className="atlas-agent-history">
            <div className="atlas-agent-history-title">Conversations</div>
            {threads.length === 0 && <p className="atlas-agent-history-empty">Aucune conversation enregistrée.</p>}
            {Object.entries(groupedHistory()).map(([label, list]) => (
              <div key={label} className="atlas-agent-history-group">
                <div className="atlas-agent-history-day">{label}</div>
                {list.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    className={`atlas-agent-history-item${th.id === threadId ? ' active' : ''}`}
                    onClick={() => openThread(th.id)}
                  >
                    <span className="atlas-agent-history-label">{th.title || 'Sans titre'}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        


        <div className="atlas-agent-pagechip" title={page.path}>
          <span className="dot" />
          <div>
            <em>Page actuelle</em>
            <strong>{page.title}</strong>
          </div>
        </div>

        {!isPhoneShell && (
        <div className="atlas-agent-execmode" role="group" aria-label="Mode d’exécution">
          <button
            type="button"
            className={execMode === 'ask' ? 'active' : undefined}
            onClick={() => {
              setExecMode('ask');
              try { localStorage.setItem(AGENT_EXEC_MODE_KEY, 'ask'); } catch { /* */ }
            }}
          >
            Demander avant
          </button>
          <button
            type="button"
            className={execMode === 'auto' ? 'active' : undefined}
            onClick={() => {
              setExecMode('auto');
              try { localStorage.setItem(AGENT_EXEC_MODE_KEY, 'auto'); } catch { /* */ }
            }}
          >
            Automatiquement
          </button>
        </div>
        )}

        {msgs.length <= 1 && (
          <div className="atlas-agent-greeting">
            <strong>{timeGreeting().hello}</strong>
            <span>{timeGreeting().sub}</span>
            <div className="atlas-agent-chips">
              {(isPhoneShell
                ? [
                    { label: 'Stock bas', prompt: 'Résumé stock bas' },
                    { label: 'Actions', prompt: 'Combien d’actions en attente ?' },
                  ]
                : [
                    { label: 'Nouveau client', prompt: 'Créer un client' },
                    { label: 'Dépense', prompt: 'Ajouter une dépense' },
                    { label: 'Rapport du jour', prompt: 'Rapport des ventes du jour' },
                    { label: 'Permissions', prompt: 'Ouvrir les permissions agent' },
                  ]
              ).map((c) => (
                <button key={c.label} type="button" onClick={() => void send(c.prompt)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {pendingAction && (
          <div className="atlas-agent-confirm-card" role="status">
            <p>{pendingAction.label}</p>
            <div className="atlas-agent-confirm-actions">
              <button type="button" className="secondary" onClick={() => setPendingAction(null)}>
                Annuler
              </button>
              <button type="button" onClick={() => void applyAction(pendingAction, true)}>
                Confirmer
              </button>
            </div>
          </div>
        )}

        <div className="atlas-agent-body">
          {msgs.map((m, i) => (
            <div key={i} className={`atlas-agent-msg ${m.role}`}>
              <div className="atlas-agent-bubble">
                {m.text}
                {m.streaming ? <span className="atlas-agent-caret">▍</span> : null}
              </div>

              {m.tools && m.tools.length > 0 && (
                <div className="atlas-agent-tools">
                  <button
                    type="button"
                    className="atlas-agent-tools-toggle"
                    onClick={() => setExpandedTools((s) => ({ ...s, [i]: !s[i] }))}
                  >
                    {expandedTools[i] ? '▾' : '▸'} {m.tools.length} outil{m.tools.length > 1 ? 's' : ''}
                  </button>
                  {expandedTools[i] && (
                    <ul className="atlas-agent-tools-list">
                      {m.tools.map((t, j) => (
                        <li key={j} className={t.ok ? 'ok' : 'bad'}>
                          <code>{t.name}</code>
                          <span>{t.ok ? 'OK' : t.error || 'échec'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {m.sources && m.sources.length > 0 && (
                <div className="atlas-agent-sources">
                  {m.sources.map((s, j) => (
                    <Link key={j} to={s.href} className="atlas-agent-source">
                      {s.label}
                    </Link>
                  ))}
                </div>
              )}

              {m.tools?.some((x) => x.name === 'draft_client_message' && x.ok) && (
                <div className="atlas-agent-draft">
                  {(() => {
                    const tr = m.tools!.find((x) => x.name === 'draft_client_message');
                    const d: any = tr?.data;
                    if (!d?.body) return null;
                    return (
                      <>
                        <pre className="atlas-agent-draft-body">{d.body}</pre>
                        <div className="atlas-agent-draft-actions">
                          <button type="button" onClick={() => void navigator.clipboard?.writeText(String(d.body))}>
                            Copier le texte
                          </button>
                          {d.wa_link ? (
                            <a href={d.wa_link} target="_blank" rel="noreferrer">
                              Ouvrir WhatsApp
                            </a>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {m.role === 'assistant' && (m.ms != null || m.failed) && !m.streaming && (
                <div className="atlas-agent-meta">
                  {m.ms != null && (
                    <span>
                      {m.ms >= 1000 ? `Répondu en ${(m.ms / 1000).toFixed(1)} s` : `Répondu en ${m.ms} ms`}
                    </span>
                  )}
                  {m.failed && m.prompt && (
                    <button
                      type="button"
                      className="atlas-agent-retry"
                      disabled={busy}
                      onClick={() => void send(m.prompt, true)}
                      title="Réessayer"
                    >
                      <svg className="atlas-agent-retry-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                        <path d="M16 16h5v5" />
                      </svg>
                      <span>Réessayer</span>
                    </button>
                  )}
                </div>
              )}

              {m.proposals && m.proposals.length > 0 && (
                <div className="atlas-agent-props">
                  {m.proposals.map((p, j) => (
                    <div key={j} className="atlas-agent-prop">
                      {p.type === 'inventory_adjustment' ? (
                        <span>
                          Ajustement {p.product_name || p.sku} : {p.delta > 0 ? '+' : ''}
                          {String(p.delta)}
                        </span>
                      ) : (
                        <span>{String(p.type || 'proposition')}</span>
                      )}
                      {p.proposal_id ? (
                        <button type="button" onClick={() => void approve(String(p.proposal_id))}>
                          Approuver
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="atlas-agent-msg assistant">
              <div className="atlas-agent-bubble thinking">
                <span className="atlas-agent-dots" aria-hidden />
                Réflexion en cours…
                <button type="button" className="atlas-agent-stop" onClick={stop}>
                  Arrêter
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {!isPhoneShell && (
        <div className="atlas-agent-nav">
          <span className="lbl">Aller à</span>
          <button type="button" onClick={() => go('/', 'Tableau de bord')}>Tableau de bord</button>
          <button type="button" onClick={() => go('/products', 'Produits')}>Produits</button>
          <button type="button" onClick={() => go('/actions', 'Boîte d’actions')}>Actions</button>
          {!stockOnly && canOfficeWork() && (
            <button type="button" onClick={() => go('/quotes', 'Devis')}>Devis</button>
          )}
          {!stockOnly && canSell() && (
            <button type="button" onClick={() => go('/quick-sale', 'Vente rapide')}>Vente</button>
          )}
          {!stockOnly && canOfficeWork() && (
            <button type="button" onClick={() => go('/invoices', 'Factures')}>Factures</button>
          )}
        </div>
        )}

        <div className="atlas-agent-suggest">
          {!isPhoneShell && (
          <button type="button" disabled={busy} onClick={() => void send(`Que faire sur la page ${page.title} ?`)}>
            Que faire ici ?
          </button>
          )}
          {!isPhoneShell && (
          <button type="button" disabled={busy} onClick={() => void send('Que faire ensuite ?')}>
            Que faire ensuite ?
          </button>
          )}
          <button type="button" disabled={busy} onClick={() => void send('Résumé stock bas')}>
            Stock bas
          </button>
          <button type="button" disabled={busy} onClick={() => void send('Combien d’actions en attente ?')}>
            Actions en attente
          </button>
          {!isPhoneShell && !stockOnly && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send('Prépare le pack de clôture du jour (impayés, stock bas, devis, actions)')}
            >
              Pack clôture
            </button>
          )}
          {!isPhoneShell && page.path.startsWith('/actions') && (
            <button type="button" disabled={busy} onClick={() => void send('Explique les actions en attente et quoi valider en premier')}>
              Expliquer actions
            </button>
          )}
          {!isPhoneShell && !stockOnly && canOfficeWork() && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send('Propose des lignes de devis à partir des produits les plus vendus')}
            >
              Lignes devis
            </button>
          )}
        </div>

        <footer className="atlas-agent-foot">
          <button
            type="button"
            className={`atlas-agent-mic ${listening ? 'on' : ''}`}
            title="Dictée (français)"
            onClick={toggleVoice}
            disabled={busy}
          >
            <IconMic />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Écrire un message…"
            disabled={busy}
            aria-label="Message Atlas Agent"
          />
          {busy ? (
            <button type="button" className="atlas-agent-send stop" onClick={stop} title="Arrêter">
              <IconStop />
            </button>
          ) : (
            <button type="button" className="atlas-agent-send" disabled={!input.trim()} onClick={() => void send()}>
              <IconSend />
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
