import { finishAgentReply } from '../lib/agentMessages';
import { ChevronDown, Plus, PackageSearch, ListChecks, FileText, ArrowUpRight, Sparkles, Search, Maximize2, Minimize2, Trash2 } from 'lucide-react';
/**
 * Atlas Agent — dock + P0/P1/P2: citations, tools, drafts, stream UX, history, voice, role chips.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import LatticeLoader from './ui/LatticeLoader';
import ConfirmDialog from './ConfirmDialog';
import { AtlasAgentShimmerBody } from './PageSkeleton';
import { bumpAtlasLayer } from './GlobalSearchPanel';
import PromptBar from './ui/PromptBar';
import { ImageLightbox } from './ui/ImageLightbox';
import { sanitizeImageDataUrl , getUsername } from '../auth';
import { Attachment01Icon } from '@hugeicons/core-free-icons';
import { createPortal } from 'react-dom';
import { renderMiniMarkdown } from '../lib/miniMarkdown';
import ImageAnnotator from './ui/ImageAnnotator';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import { isStockRole, canOfficeWork, canSell } from '../auth';
import { setDensity, type Density } from '../lib/density';
import { uiToast } from './AppDialogs';
import { setAgentDraft } from '../lib/agentDraft';
import { normalizeAgentPolicy, quotaPercent, quotaReached, type AgentPolicy } from '../lib/agentQuota';


function IconCopy({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}
function IconRetry({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    </svg>
  );
}





type ToolTrace = { name: string; ok?: boolean; error?: string; data?: unknown };
const TOOL_LABELS: Record<string, string> = {
  get_dashboard_snapshot: 'Consulter le tableau de bord', search_products: 'Rechercher des produits',
  get_product: 'Consulter un produit', list_actions_pending: 'Consulter les actions en attente',
  list_open_quotes: 'Consulter les devis', list_unpaid_invoices: 'Consulter les factures impayées',
  warehouse_stock: 'Consulter le stock', list_low_stock: 'Consulter les stocks bas',
  search_clients: 'Rechercher des clients', list_recent_invoices: 'Consulter les factures',
  get_invoice_brief: 'Consulter une facture', list_warehouses: 'Consulter les entrepôts',
  summarize_pending_actions: 'Résumer les actions en attente', draft_day_close_report: 'Préparer un rapport',
  draft_client_message: 'Préparer un message client', propose_inventory_adjustment: 'Préparer un ajustement de stock',
  propose_quote_lines: 'Préparer un devis', create_client: 'Créer un client', create_product: 'Créer un produit',
  update_client: 'Modifier un client', update_product: 'Modifier un produit',
  create_invoice_draft: 'Préparer une facture', create_quote_draft: 'Préparer un devis',
};
function toolLabel(name: string): string { return TOOL_LABELS[name] || name.replace(/_/g, ' '); }

type Msg = {
  role: 'user' | 'assistant';
  text: string;
  ms?: number;
  tools?: ToolTrace[];
  proposals?: Array<Record<string, any>>;
  sources?: { label: string; href: string }[];
  failed?: boolean;
  prompt?: string;
  images?: string[];
  /** Session-only opaque object URLs for on-screen rendering (never persisted). */
  imageUrls?: string[];
  streaming?: boolean;
  /** Alternate assistant replies (retry / regenerate) */
  variants?: string[];
  variantIndex?: number;
};

type ThreadMeta = { id: string; title: string; updated: number };

const OPEN_KEY = 'atlas_agent_open';
const AGENT_EXEC_MODE_KEY = 'atlas_agent_exec_mode'; // 'ask' | 'auto'
const MSGS_KEY = 'atlas_agent_msgs_v1';
const THREADS_KEY = 'atlas_agent_threads_v1';
const ACTIVE_THREAD_KEY = 'atlas_agent_active_thread';

/* v240.4 — storage is PER USER: switching accounts in one browser must never
   expose another account's threads, messages or active-thread pointer. */
function scopeUser(): string {
  try { return String(getUsername() || 'anon').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64); } catch { return 'anon'; }
}
function threadsKey(): string { return `${THREADS_KEY}:${scopeUser()}`; }
function activeThreadKey(): string { return `${ACTIVE_THREAD_KEY}:${scopeUser()}`; }

function pageMeta(pathname: string): { title: string; hint: string; path: string } {
  if (pathname === '/agent')
    return { title: 'Atlas Agent', hint: 'Assistant mobile.', path: pathname };
  if (pathname === '/m/scan')
    return { title: 'Scan', hint: 'Code-barres terrain.', path: pathname };
  if (pathname === '/m/warehouse')
    return { title: 'Entrepôts', hint: 'Stock terrain.', path: pathname };
  if (pathname.startsWith('/m'))
    return { title: 'Accueil terrain', hint: 'Tableau de bord mobile.', path: pathname };
  if (pathname.startsWith('/settings'))
    return { title: 'Paramètres mobile', hint: 'Thème et compte.', path: pathname };
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
    const raw = localStorage.getItem(threadsKey());
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 20) : [];
  } catch {
    return [];
  }
}


function threadSnapshot(messages: Msg[]): Msg[] {
  return messages.filter(m => !m.streaming).map(m => {
    const { imageUrls, ...rest } = m;
    const images = Array.isArray(rest.images) ? rest.images.map(sanitizeImageDataUrl).filter(Boolean).slice(0, 4) : undefined;
    return { ...rest, ...(images?.length ? { images } : { images: undefined }) };
  });
}
function pendingKey(id: string) { return `atlas_agent_pending_v1:${scopeUser()}:${id}`; }

function saveThreads(list: ThreadMeta[]) {
  try {
    localStorage.setItem(threadsKey(), JSON.stringify(list.slice(0, 20)));
  } catch { /* */ }
}

function fmtReset(iso?: string): string {
  if (!iso) return 'au prochain cycle';
  try {
    return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  } catch { return 'au prochain cycle'; }
}

function msgsKey(threadId: string) {
  return `${MSGS_KEY}:${scopeUser()}:${threadId}`;
}

function loadMsgs(threadId: string): Msg[] {
  try {
    const raw = localStorage.getItem(msgsKey(threadId)) || sessionStorage.getItem(msgsKey(threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* */ }
  return [];
}

/**
 * v256 — Recompress an image data URL (≤1280px, JPEG q0.72) so attached
 * photos survive the localStorage quota and the R2 thread payload instead of
 * being stripped or silently failing to persist. Non-images pass through.
 */
function compressImageDataUrl(dataUrl: string, maxDim = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image/')) { resolve(dataUrl); return; }
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || maxDim;
          const h0 = img.naturalHeight || maxDim;
          const scale = Math.min(1, maxDim / Math.max(w0, h0));
          if (scale >= 1 && dataUrl.length < 400_000) { resolve(dataUrl); return; }
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(dataUrl); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
  });
}

function saveMsgs(threadId: string, msgs: Msg[]): boolean {
  try { localStorage.setItem(msgsKey(threadId), JSON.stringify(threadSnapshot(msgs))); return true; }
  catch { return false; }
}

function newThreadId() {
  return `t-${crypto.randomUUID()}`;
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
  | { type: 'perms_moved'; label: string }
  | { type: 'create_client'; name: string; ice?: string; phone?: string; email?: string; label: string }
  | { type: 'create_product'; name: string; price?: number; stock?: number; sku?: string; label: string }
  | { type: 'update_client'; name: string; phone?: string; email?: string; label: string }
  | { type: 'update_product'; name: string; price?: number; stock?: number; label: string }
  | { type: 'open_create'; path: string; label: string };

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

  // Permissions — now managed in Settings
  if (/permission|droits?\s+agent|outils?\s+agent/.test(t)) {
    return { type: 'perms_moved', label: 'Permissions → Paramètres' };
  }

  // Client creation
  if (/\b(cr[ée]er?|ajoute?r?|nouveau)\b.*\bclient\b|\bclient\b.*\b(nomm[ée]|appel[ée])\b/.test(t) || /client\s+avec\s+/.test(t) || /^client\s+/.test(t)) {
    const ice = (t.match(/\b(\d{15})\b/) || [])[1] || '';
    let name = '';
    // "client de nom X" / "client nommé X" / "client appelé X" — X may start with a digit
    const mNom = text.match(
      /client(?:e)?\s+(?:de\s+|du\s+)?(?:nom|nomm[ée]e?|appel[ée]e?)\s+["']?([^"'.]+?)["']?(?:\s+(?:avec|ice|email|e-mail|t[ée]l|phone)|$)/i,
    );
    const m1 = text.match(/client(?:e)?\s+(?:nomm[ée]e?|appel[ée]e?|avec(?:\s+nom)?)\s+["']?([^"'.\d]+?)["']?(?:\s+avec|\s+ice|$)/i);
    const m2 = text.match(/(?:cr[ée]er?|ajoute?r?)\s+(?:un\s+)?client\s+["']?([^"'.]+?)["']?(?:\s+avec|\s+ice|$)/i);
    const m3 = text.match(/client\s+avec\s+(?:nom\s+)?["']?([a-zA-ZÀ-ÿ][\wÀ-ÿ\s-]{1,60})["']?/i);
    name = (mNom?.[1] || m1?.[1] || m2?.[1] || m3?.[1] || '').trim();
    // "create a client with haytam name" / "client haytam"
    if (!name) {
      const m4 = text.match(/client(?:e)?\s+["']?([a-zA-Z0-9À-ÿ][\wÀ-ÿ-]{1,40})["']?/i);
      if (m4 && !/^(avec|nommé|nommee|nouveau|nouvelle|de|du|nom|appelé|appelee)$/i.test(m4[1])) name = m4[1].trim();
    }
    if (name) {
      const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '';
      const phone = (text.match(/(?:\+?\d[\d\s.-]{8,17}\d)/) || [])[0]?.trim() || '';
      return {
        type: 'create_client',
        name,
        ice: ice || undefined,
        email: email || undefined,
        phone: phone || undefined,
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

  // Invoice / quote create
  if (/\b(facture|devis)\b/.test(t) && /\b(cr[ée]er?|nouvelle?|nouveau)\b/.test(t)) {
    const isQuote = /\bdevis\b/.test(t);
    return {
      type: 'navigate',
      path: isQuote ? '/quotes' : '/invoices',
      draft: { open: '1' },
      label: isQuote ? 'Ouvrir la création de devis' : 'Ouvrir la création de facture',
    };
  }

  // Edit / update client
  if (/\b(modifi|édit|mettre\s+à\s+jour|change)\b/.test(t) && /\bclient\b/.test(t)) {
    const m = text.match(/client\s+["']?([a-zA-ZÀ-ÿ][\wÀ-ÿ\s-]{1,40})["']?/i);
    const name = (m?.[1] || '').trim();
    const phone = (t.match(/(?:tél|tel|phone)\s*[:=]?\s*([\d\s+]{8,})/) || [])[1]?.replace(/\s/g, '');
    const email = (t.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i) || [])[0];
    if (name) {
      return {
        type: 'update_client',
        name,
        phone,
        email,
        label: `Modifier le client « ${name} »`,
      };
    }
    return { type: 'navigate', path: '/clients', label: 'Ouvrir les clients pour modification' };
  }

  // Edit product
  if (/\b(modifi|édit|mettre\s+à\s+jour|change)\b/.test(t) && /\bproduit\b/.test(t)) {
    const m = text.match(/produit\s+["']?([^"']{2,60})["']?/i);
    const name = (m?.[1] || '').trim();
    const priceM = t.match(/(\d+[.,]?\d*)\s*(?:dh|mad)/);
    const price = priceM ? Number(priceM[1].replace(',', '.')) : undefined;
    if (name) {
      return { type: 'update_product', name, price, label: `Modifier le produit « ${name} »` };
    }
    return { type: 'navigate', path: '/products', label: 'Ouvrir les produits pour modification' };
  }

  // Employee / vendor / quick sale shortcuts
  if (/\b(employé|employe)\b/.test(t) && /\b(cr[ée]er?|nouveau|ajoute)\b/.test(t)) {
    return { type: 'open_create', path: '/employees', label: 'Ouvrir la création d’employé' };
  }
  if (/\b(fournisseur|vendor)\b/.test(t) && /\b(cr[ée]er?|nouveau|ajoute)\b/.test(t)) {
    return { type: 'open_create', path: '/vendors', label: 'Ouvrir la création fournisseur' };
  }
  if (/\b(vente\s*rapide|ticket\s*vr|caisse)\b/.test(t) && /\b(cr[ée]er?|nouvelle?|ouvre)\b/.test(t)) {
    return { type: 'navigate', path: '/quick-sale', draft: { open: '1' }, label: 'Ouvrir la vente rapide' };
  }


  // Document → entity (fichier joint mentionné dans le texte ou "transformer en…")
  if (
    /\b(transforme|convertis|tourne|fais|créer?|cree|genere|génère)\b/.test(t) &&
    /\b(facture|devis|reçu|recu|client|employé|employe|produit|fournisseur)\b/.test(t)
  ) {
    if (/\bfacture\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/invoices',
        draft: { open: '1', entity: 'invoice', source: 'document' },
        label: 'Ouvrir une facture à partir du document',
      };
    }
    if (/\bdevis\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/quotes',
        draft: { open: '1', entity: 'quote', source: 'document' },
        label: 'Ouvrir un devis à partir du document',
      };
    }
    if (/\b(reçu|recu)\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/receipts',
        draft: { open: '1', entity: 'receipt', source: 'document' },
        label: 'Ouvrir un reçu à partir du document',
      };
    }
    if (/\bclient\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/clients',
        draft: { open: '1', entity: 'client', source: 'document' },
        label: 'Ouvrir un client à partir du document',
      };
    }
    if (/\b(employé|employe)\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/employees',
        draft: { open: '1', entity: 'employee', source: 'document' },
        label: 'Ouvrir un employé à partir du document',
      };
    }
    if (/\bproduit\b/.test(t)) {
      return {
        type: 'navigate',
        path: '/products',
        draft: { open: '1', entity: 'product', source: 'document' },
        label: 'Ouvrir un produit à partir du document',
      };
    }
  }

  
  return null;
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
      return localStorage.getItem(activeThreadKey()) || localStorage.getItem(ACTIVE_THREAD_KEY) || newThreadId();
    } catch {
      return newThreadId();
    }
  });
  const [threads, setThreads] = useState<ThreadMeta[]>(() => loadThreads());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyError, setHistoryError] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [deletingThread, setDeletingThread] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<(ThreadMeta & { user: string }) | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('atlas_agent_expanded') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('atlas_agent_expanded', expanded ? '1' : '0'); } catch { /* storage unavailable */ } }, [expanded]);
  const [showExtras, setShowExtras] = useState<boolean>(() => {
    try { return localStorage.getItem('atlas_agent_show_extras') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (!historyOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.atlas-agent-header-title')) setHistoryOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHistoryOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [historyOpen]);
  const [agentPolicy, setAgentPolicy] = useState<AgentPolicy | null>(null);
  // v0.7.7 — popup dédié « accès suspendu » : montré une fois par session
  const [blockedModalSeen, setBlockedModalSeen] = useState(() => {
    try { return sessionStorage.getItem('atlas-agent-blocked-seen') === '1'; } catch { return true; }
  });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await api.getAgentPolicy();
        if (alive && res?.data) setAgentPolicy(normalizeAgentPolicy(res.data));
      } catch { /* offline: permissive */ }
    })();
    return () => { alive = false; };
  }, [open]);
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
  const [annotator, setAnnotator] = useState<{ index: number; src: string; name: string } | null>(null);
  const [execMode] = useState<ExecMode>(() => getExecMode());
  /** Server agent_perm_mode: full | read_only | custom */
  const [agentPermMode, setAgentPermMode] = useState<'full' | 'read_only' | 'custom'>('full');

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
  // Remote (R2) hydration blocks edits until the saved version is known.
  // Cached conversations remain visible; empty threads show a shimmer.
  const [loadingThread, setLoadingThread] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'too-large'>('loading');
  const [syncEpoch, setSyncEpoch] = useState(0);
  const syncRef = useRef<{ id: string; user: string; ready: boolean; version: string | null; baseline: string; inFlight: boolean; blocked: boolean; failure: 'conflict' | 'offline' | 'too-large' } | null>(null);
  const [reloadThread, setReloadThread] = useState(0);
 // unused (dictation removed)
  const [attachments, setAttachments] = useState<{ name: string; type: string; data_url: string; preview_url?: string; text_excerpt?: string }[]>([]);
  // v256 — unsent composer attachments survive a page refresh (images are
  // stored already-compressed; blob previews are recreated from the data URL).
  const ATTACH_DRAFT_KEY = 'atlas-agent-attach-draft-v256';
  useEffect(() => {
    try {
      if (!attachments.length) { localStorage.removeItem(ATTACH_DRAFT_KEY); return; }
      const slim = attachments.map((a) => ({ name: a.name, type: a.type, data_url: a.data_url, text_excerpt: a.text_excerpt }));
      localStorage.setItem(ATTACH_DRAFT_KEY, JSON.stringify(slim));
    } catch { /* quota — attachments stay in memory only */ }
  }, [attachments]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ATTACH_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return;
      const restored = parsed
        .filter((a: any) => a && typeof a.data_url === 'string' && a.data_url)
        .map((a: any) => ({
          name: String(a.name || 'Pièce jointe'),
          type: String(a.type || 'application/octet-stream'),
          data_url: String(a.type || '').startsWith('image/') ? sanitizeImageDataUrl(a.data_url) : String(a.data_url),
          text_excerpt: typeof a.text_excerpt === 'string' ? a.text_excerpt.slice(0, 12000) : undefined,
        }))
        .filter((a: any) => a.data_url)
        .slice(-5);
      if (restored.length) setAttachments((prev) => (prev.length ? prev : restored));
    } catch { /* */ }
  }, []);
  // v242 — remember the latest uploaded files so "lis ça" without a new
  // attachment re-sends them to the model instead of answering blind.
  const lastFilesRef = useRef<{ name: string; type: string; data_url: string; preview_url?: string; text_excerpt?: string }[]>([]);
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const id = (() => {
      try {
        return localStorage.getItem(activeThreadKey()) || '';
      } catch {
        return '';
      }
    })();
    const saved = id ? loadMsgs(id) : [];
    return saved.length ? saved : [WELCOME];
  });
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [liveTools, setLiveTools] = useState<ToolTrace[]>([]);
  const [activeTool, setActiveTool] = useState('');
  const [receivingReply, setReceivingReply] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRevision = useRef(0);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--atlas-agent-w', `${panelWidth}px`);
    try { localStorage.setItem('atlas_agent_width', String(panelWidth)); } catch { /* */ }
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = (document.documentElement.dir === 'rtl' ? 1 : -1) * (e.clientX - dragRef.current.startX);
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
      localStorage.setItem(activeThreadKey(), threadId);
    } catch { /* */ }
    document.documentElement.classList.toggle('atlas-agent-docked', open);
    // v0.7.7 — l'agent ouvert passe AU-DESSUS du panneau recherche ouvert avant
    // (et réciproquement) : compteur de couches partagé, jamais de boucle.
    if (open) bumpAtlasLayer('--z-agent');
    return () => document.documentElement.classList.remove('atlas-agent-docked');
  }, [open, threadId]);

  // Load R2 before any write. A cached pending edit may only be sent when its
  // recorded base version still matches; a different device wins otherwise.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const user = scopeUser();
    const state = { id: threadId, user, ready: false, version: null as string | null, baseline: '', inFlight: false, blocked: false, failure: 'offline' as 'conflict' | 'offline' | 'too-large' };
    syncRef.current = state;
    setLoadingThread(true); setSyncStatus('loading');
    const local = loadMsgs(threadId);
    if (local.length) setMsgs(local);
    (async () => {
      try {
        const res = await api.getAgentThread(threadId);
        if (cancelled || syncRef.current !== state || scopeUser() !== user) return;
        const remote = Array.isArray(res?.data?.messages) ? threadSnapshot(res.data.messages) : [];
        const version = res?.meta?.version ?? null;
        const key = pendingKey(threadId);
        let pending: { known: boolean; version: string | null } | null = null;
        try { const raw = localStorage.getItem(key); if (raw) pending = JSON.parse(raw); } catch { /* handled as conflict below */ }
        state.version = version; state.ready = true;
        if (pending && local.some(m => m.role === 'user') && remote.length && JSON.stringify(threadSnapshot(local)) === JSON.stringify(remote)) {
          // A write may have succeeded even if its acknowledgement was lost.
          try { localStorage.removeItem(key); } catch { /* local persistence unavailable */ }
          state.baseline = JSON.stringify(remote);
          setMsgs(remote); setSyncStatus('saved');
        } else if (pending && local.some(m => m.role === 'user') && ((!pending.known && version !== null) || (pending.known && pending.version !== version))) {
          state.blocked = true; state.failure = 'conflict';
          state.baseline = JSON.stringify(threadSnapshot(local));
          setSyncStatus('conflict');
        } else if (pending && local.some(m => m.role === 'user')) {
          state.baseline = JSON.stringify(remote);
          setMsgs(local);
          setSyncStatus('pending');
        } else if (remote.length && local.some(m => m.role === 'user') && !local.every((m, index) => remote[index]?.role === m.role && remote[index]?.text === m.text)) {
          // A legacy local-only copy may contain edits that never reached R2.
          // Keep it intact instead of treating an unversioned cache as authoritative.
          state.blocked = true; state.failure = 'conflict';
          state.baseline = JSON.stringify(threadSnapshot(local));
          try { localStorage.setItem(key, JSON.stringify({ known: false, version: null })); } catch { /* warning remains visible */ }
          setSyncStatus('conflict');
        } else if (remote.length) {
          state.baseline = JSON.stringify(remote);
          setMsgs(remote);
          saveMsgs(threadId, remote);
          setSyncStatus('saved');
        } else if (local.some(m => m.role === 'user')) {
          state.baseline = JSON.stringify([]);
          setMsgs(local);
          setSyncStatus('pending');
        } else {
          state.baseline = JSON.stringify(threadSnapshot(local.length ? local : [WELCOME]));
          setSyncStatus('saved');
        }
        if (res?.data?.title && remote.length) {
          setThreads(prev => {
            const next = [{ id: threadId, title: String(res.data.title).slice(0, 48), updated: Date.now() }, ...prev.filter(x => x.id !== threadId)].slice(0, 20);
            saveThreads(next); return next;
          });
        }
        setSyncEpoch(v => v + 1);
      } catch {
        if (!cancelled && syncRef.current === state) { state.blocked = true; setSyncStatus('offline'); }
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    })();
    return () => { cancelled = true; if (syncRef.current === state) syncRef.current = null; };
  }, [threadId, open, reloadThread]);

  useEffect(() => {
    if (!open || loadingThread || !msgs.some(m => m.role === 'user')) return;
    const state = syncRef.current;
    if (!state || state.id !== threadId || state.user !== scopeUser() || (!state.ready && !state.blocked)) return;
    const snapshot = threadSnapshot(msgs);
    const serialized = JSON.stringify(snapshot);
    if (state.ready && serialized === state.baseline) return;
    const localSaved = saveMsgs(threadId, snapshot);
    if (!localSaved) { state.blocked = true; setSyncStatus('offline'); return; }
    const pendingStorageKey = pendingKey(threadId);
    // Never rebase a conflicted local edit onto the other device's version.
    if (state.blocked && state.failure === 'conflict') { setSyncStatus('conflict'); return; }
    try { localStorage.setItem(pendingStorageKey, JSON.stringify({ known: state.ready, version: state.version })); }
    catch { state.blocked = true; setSyncStatus('offline'); return; }
    if (!state.ready || state.blocked) { setSyncStatus(state.failure); return; }
    if (busy) { setSyncStatus('pending'); return; }
    if (state.inFlight) return;
    setSyncStatus('pending');
    const timer = window.setTimeout(() => {
      if (syncRef.current !== state || scopeUser() !== state.user) return;
      state.inFlight = true; setSyncStatus('saving');
      const title = loadThreads().find(t => t.id === threadId)?.title || String(snapshot.find(m => m.role === 'user')?.text || 'Sans titre').trim().slice(0, 48);
      void api.putAgentThread(threadId, { title, messages: snapshot, expected_version: state.version }).then(res => {
        if (scopeUser() !== state.user) return;
        if (res?.data?.storage !== 'r2' || !res.data.version) throw new Error('No R2 acknowledgement');
        state.version = res.data.version; state.baseline = serialized;
        const latest = loadMsgs(threadId);
        if (JSON.stringify(threadSnapshot(latest)) === serialized) { localStorage.removeItem(pendingStorageKey); if (syncRef.current === state) setSyncStatus('saved'); }
        else { localStorage.setItem(pendingStorageKey, JSON.stringify({ known: true, version: state.version })); if (syncRef.current === state) setSyncStatus('pending'); }
      }).catch((err: any) => {
        if (syncRef.current !== state) return;
        state.blocked = true; state.failure = err?.code === 'AGENT_THREAD_CONFLICT' ? 'conflict' : err?.code === 'AGENT_THREAD_TOO_LARGE' ? 'too-large' : 'offline'; setSyncStatus(state.failure);
      }).finally(() => {
        state.inFlight = false;
        if (syncRef.current === state) setSyncEpoch(v => v + 1);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [msgs, threadId, open, busy, loadingThread, syncEpoch]);

  // Sync thread list from R2 index when panel opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listAgentThreads();
        if (cancelled) return;
        setHistoryError(Boolean(res?.meta?.unreadable_count));
        setHistoryPending(Boolean(res?.meta?.pending_count));
        const remote = res?.data;
        if (!Array.isArray(remote) || !remote.length) return;
        setThreads((prev) => {
          const byId = new Map<string, ThreadMeta>();
          for (const t of prev) byId.set(t.id, t);
          for (const r of remote) {
            const id = String(r.id || '');
            if (!id || (r.message_count === 0 && String(r.title || '') === 'Sans titre')) continue;
            const updated = r.updated_at ? new Date(r.updated_at).getTime() : Date.now();
            const existing = byId.get(id);
            byId.set(id, {
              id,
              title: String((r.summary_pending && existing?.title) || r.title || existing?.title || 'Sans titre').slice(0, 48),
              updated: Math.max(existing?.updated || 0, updated || 0),
            });
          }
          const next = [...byId.values()].sort((a, b) => b.updated - a.updated).slice(0, 20);
          saveThreads(next);
          return next;
        });
      } catch { if (!cancelled) setHistoryError(true); }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);


  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, open, busy]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch { /* */ }
    };
  }, []);

  // A completed server response is authoritative. Replace a retry placeholder
  // at its actual position instead of animating only the final message.
  const finishReply = (reply: Msg) => {
    setMsgs((messages) => finishAgentReply(messages, reply));
  };

  const touchThread = (title: string) => {
    setThreads((prev) => {
      const existing = prev.find((t) => t.id === threadId);
      const next = [{ id: threadId, title: existing?.title || title.slice(0, 48), updated: Date.now() }, ...prev.filter((t) => t.id !== threadId)].slice(0, 20);
      saveThreads(next);
      return next;
    });
  };



  useEffect(() => {
    if (!open) return;
    void api.getAgentPermissions().then((r: any) => {
      const m = r?.data?.mode || r?.mode;
      if (m === 'read_only' || m === 'custom' || m === 'full') setAgentPermMode(m);
    }).catch(() => {});
  }, [open]);

  const applyAction = useCallback(
    async (action: LocalAction, confirmed = false) => {
      // Opening a form is not destructive — never block on "ask" mode
      const formOpen =
        action.type === 'create_client' ||
        action.type === 'create_product' ||
        action.type === 'update_client' ||
        action.type === 'update_product' ||
        action.type === 'open_create' ||
        action.type === 'navigate' ||
        action.type === 'perms_moved' ||
        action.type === 'density';
      // Role-based: only office roles may auto-mutate; auto requires agent_perm_mode=full
      const role = (() => {
        try { return localStorage.getItem('stock_role') || 'user'; } catch { return 'user'; }
      })();
      const roleCanWrite = ['owner', 'admin', 'secretaire'].includes(String(role).toLowerCase());
      const autoAllowed = execMode === 'auto' && agentPermMode === 'full' && roleCanWrite;
      if (!formOpen && !confirmed && !autoAllowed) {
        setPendingAction(action);
        const why =
          execMode === 'ask'
            ? 'Confirmez pour exécuter, ou passez en mode « Automatiquement » (permissions complètes).'
            : agentPermMode !== 'full'
              ? 'Permissions agent en lecture seule / personnalisées — confirmation requise.'
              : !roleCanWrite
                ? 'Votre rôle ne permet pas les écritures automatiques — confirmation requise.'
                : 'Confirmation requise.';
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Action préparée : ${String((action as any)?.label ?? 'action')}. ${why}`,
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
      if (action.type === 'perms_moved') {
        setMsgs((m) => [...m, { role: 'assistant', text: 'Les permissions de l’agent se gèrent désormais dans **Paramètres → Atlas Agent & Sécurité**, section « Permissions Atlas Agent ».' }]);
        return;
      }
      if (action.type === 'create_client') {
        setAgentDraft({
          open: '1',
          entity: 'client',
          mode: 'create',
          prefill: {
            name: action.name,
            ice: action.ice || '',
            phone: action.phone || '',
            email: action.email || '',
          },
        });
        navigate('/clients');
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Formulaire client ouvert pour « ${action.name} ». Vérifiez les champs puis enregistrez.`,
          },
        ]);
        return;
      }
      if (action.type === 'create_product') {
        setAgentDraft({
          open: '1',
          entity: 'product',
          mode: 'create',
          prefill: {
            name: action.name,
            price: action.price ?? 0,
            stock_quantity: action.stock ?? 0,
            sku: action.sku || '',
          },
        });
        navigate('/products');
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Formulaire produit ouvert pour « ${action.name} ». Complétez ou corrigez puis enregistrez.`,
          },
        ]);
        return;
      }
      if (action.type === 'update_client') {
        setAgentDraft({
          open: '1',
          entity: 'client',
          mode: 'edit',
          prefill: {
            name: action.name,
            phone: action.phone || '',
            email: action.email || '',
          },
        });
        navigate('/clients');
        setMsgs((m) => [
          ...m,
          { role: 'assistant', text: `Ouverture du client « ${action.name} » pour modification.` },
        ]);
        return;
      }
      if (action.type === 'update_product') {
        setAgentDraft({
          open: '1',
          entity: 'product',
          mode: 'edit',
          prefill: {
            name: action.name,
            price: action.price,
            stock_quantity: action.stock,
          },
        });
        navigate('/products');
        setMsgs((m) => [
          ...m,
          { role: 'assistant', text: `Ouverture du produit « ${action.name} » pour modification.` },
        ]);
        return;
      }
      if (action.type === 'open_create') {
        try {
          sessionStorage.setItem('atlas-agent-draft', JSON.stringify({ open: '1' }));
        } catch { /* */ }
        navigate(action.path);
        setMsgs((m) => [...m, { role: 'assistant', text: `Ouverture : ${action.label}.` }]);
        return;
      }
      if (action.type === 'navigate') {
        if (action.draft) {
          setAgentDraft({
            open: action.draft.open || '1',
            entity: (action.draft as any).entity,
            mode: 'create',
            prefill: action.draft as any,
            source_file: (action.draft as any).source,
            note: action.label,
          });
        }

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
    [execMode, agentPermMode, navigate, location.pathname],
  );

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const allowed = (f: File) => {
      const t = (f.type || '').toLowerCase();
      const n = f.name.toLowerCase();
      if (t.startsWith('image/')) return true;
      if (t.includes('pdf') || n.endsWith('.pdf')) return true;
      if (n.endsWith('.doc') || n.endsWith('.docx') || n.endsWith('.odt') || n.endsWith('.txt')) return true;
      if (n.endsWith('.csv') || n.endsWith('.xlsx') || n.endsWith('.xls')) return true;
      return false;
    };
    for (const f of files) {
      if (!allowed(f)) {
        try { uiToast(`Fichier refusé (images / documents uniquement) : ${f.name}`, 'error'); } catch { /* */ }
        continue;
      }
      if (f.size > 4_000_000) {
        try { uiToast(`Fichier trop lourd (max 4 Mo) : ${f.name}`, 'error'); } catch { /* */ }
        continue;
      }
      void (async () => {
        const data_url = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(f);
        });
        const isImg = (f.type || '').startsWith('image/');
        const isTextual = (f.type || '').startsWith('text/') || /\.(txt|md|csv|json|xml|yml|yaml|log)$/i.test(f.name);
        let text_excerpt: string | undefined;
        if (!isImg && isTextual) {
          try { text_excerpt = (await f.text()).slice(0, 12000); } catch { /* */ }
        }
        // v256 — recompress images right away so the attachment (and thus the
        // thread) stays small enough to persist across page refreshes.
        const stored_url = isImg ? await compressImageDataUrl(data_url) : data_url;
        setAttachments((prev) => [...prev, {
          name: f.name,
          type: f.type || 'application/octet-stream',
          data_url: stored_url,
          text_excerpt,
          // Opaque object URL for on-screen previews: FileReader text never
          // reaches an <img> src (CodeQL js/dom-text-reinterpreted-as-html).
          preview_url: isImg ? URL.createObjectURL(f) : undefined,
        }].slice(-5));
      })();
    }
  };

  const lastReportedLen = useRef(0);
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant' && msgs.length > lastReportedLen.current) {
      lastReportedLen.current = msgs.length;
      // v233 — the server charges real tokens; we just refresh the quota display
      api.getAgentPolicy()
        .then((res: any) => { if (res?.data) setAgentPolicy(normalizeAgentPolicy(res.data)); })
        .catch(() => { /* */ });
    }
  }, [msgs]);

  const send = useCallback(
    async (raw?: string, isRetry = false, retryAtIndex?: number) => {
      const q = (raw ?? input).trim();
      const picked = isRetry ? [] : attachments;
      const READ_RX = /\b(lis|lire|relis|relire|read|analyse|analyser|analyze|regarde|regarder|résume|resume|summarize|commente|commentes|étudie|etudie|ouvre|open)\b/i;
      let reused = false;
      const files = (!picked.length && READ_RX.test(q) && lastFilesRef.current.length)
        ? ((reused = true), lastFilesRef.current)
        : picked;
      if (!isRetry && picked.length) lastFilesRef.current = picked;
      if ((!q && !files.length) || busy || loadingThread || deletingThread) return;
      conversationRevision.current += 1;
      /* v225 security: blocked users and exhausted quotas cannot talk to the agent */
      if (agentPolicy?.blocked) {
        setMsgs((m) => [...m, { role: 'assistant', text: "⛔ Accès à Atlas Agent suspendu pour votre compte (abus ou injection de prompt détecté). Contactez un administrateur pour le rétablir." }]);
        return;
      }
      if (agentPolicy && !agentPolicy.isAdmin && quotaReached(agentPolicy.dailyUsed, agentPolicy.dailyLimit)) {
        setMsgs((m) => [...m, { role: 'assistant', text: `📉 Quota quotidien de jetons atteint. Il se rafraîchira ${fmtReset(agentPolicy.dailyResetsAt)} (minuit UTC) — chaque jour à la même heure. Les administrateurs ne sont pas limités.` }]);
        return;
      }
      if (agentPolicy && !agentPolicy.isAdmin && quotaReached(agentPolicy.weeklyUsed, agentPolicy.weeklyLimit)) {
        setMsgs((m) => [...m, { role: 'assistant', text: `📉 Quota hebdomadaire de jetons atteint. Il se rafraîchira ${fmtReset(agentPolicy.weeklyResetsAt)} (lundi 00:00 UTC) — chaque semaine au même moment. Les administrateurs ne sont pas limités.` }]);
        return;
      }
      /* Prompt-injection tripwire: jailbreak patterns lock agent access until an admin restores it */
      const INJECTION = /(ignore(z|s)? (toutes )?(les )?(instructions|consignes|regles|rules)( precedentes| anteriores)?|disregard (all|previous|prior)|forget (your|all|previous) (instructions|rules|training)|you are (now|no longer)|tu es (maintenant|desormais) (libere|unrestricted)|jailbreak|dan mode|developer mode|system prompt|revele (ton|le) (prompt|system)|reveal (your|the) (system|prompt)|do anything now|pretend (you are|to be) (an? )?(unrestricted|evil|jailbroken))/i;
      if (q && INJECTION.test(q)) {
        try { await api.flagAgentAbuse('prompt_injection'); } catch { /* */ }
        setAgentPolicy((p0) => (p0 ? { ...p0, blocked: true } : p0));
        setMsgs((m) => [...m, { role: 'assistant', text: "🛡️ Tentative d'injection de prompt détectée. Par sécurité, l'accès à Atlas Agent est suspendu jusqu'à rétablissement par un administrateur. Incident journalisé." }]);
        return;
      }
      if (!isRetry) setInput('');
      if (!isRetry) setAttachments([]);
      // v234 — images show as thumbnails; never print their titles (non-image files keep names)
      const namedFiles = files.filter((f) => !(f.type || '').startsWith('image/'));
      const attachNote = namedFiles.length
        ? `\n[Pièces jointes: ${namedFiles.map((f) => f.name).join(', ')}]`
        : '';
      const userText = (q || 'Voir les pièces jointes') + attachNote;
      const bubbleText = q || '';
      if (!isRetry) {
        setMsgs((m) => [...m, { role: 'user', text: bubbleText, fileNames: namedFiles.map((f) => f.name).slice(0, 5), images: files.filter((f) => (f.type || '').startsWith('image/')).map((f) => sanitizeImageDataUrl(f.data_url)).filter(Boolean).slice(0, 4), imageUrls: files.filter((f) => (f.type || '').startsWith('image/')).map((f) => f.preview_url || '').filter(Boolean).slice(0, 4) }]);
        touchThread(userText);
      } else {
        // Remove the assistant message being retried; keep variants of previous text
        setMsgs((m) => {
          const idx =
            typeof retryAtIndex === 'number'
              ? retryAtIndex
              : (() => {
                  for (let i = m.length - 1; i >= 0; i--) {
                    if (m[i].role === 'assistant' && m[i].prompt === q) return i;
                  }
                  for (let i = m.length - 1; i >= 0; i--) {
                    if (m[i].role === 'assistant') return i;
                  }
                  return -1;
                })();
          if (idx < 0) return m;
          const copy = [...m];
          const prev = copy[idx];
          const prevVariants = prev.variants?.length
            ? [...prev.variants]
            : prev.text
              ? [prev.text]
              : [];
          // placeholder while waiting
          copy[idx] = {
            role: 'assistant',
            text: '',
            streaming: true,
            prompt: q,
            variants: prevVariants,
            variantIndex: prevVariants.length, // new reply will append
          };
          return copy;
        });
      }

      // Local UI actions (client, expense, density, permissions) — no round-trip
      const local = parseLocalAction(q || userText, location.pathname);
      if (local) {
        void applyAction(local);
        return;
      }

      setBusy(true);
      setLiveTools([]);
      setActiveTool('');
      setReceivingReply(false);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const t0 = performance.now();
      try {
        // Send the user text cleanly; page is context only (never inject "quoi faire"
        // into every prompt — that was matching local canned tips and making the agent dumb).
        const prompt = [
          `Contexte de navigation (informatif uniquement) : ${page.title} (${page.path}).`,
          `Message de l’utilisateur : ${q || 'Analyse des pièces jointes.'}`,
          files.length ? [
            `Fichiers joints : ${files.map((f) => `${f.name} (${f.type})`).join('; ')}.`,
            reused ? 'Ces fichiers ont été fournis précédemment dans cette conversation.' : '',
            ...files.filter((f) => f.text_excerpt).map((f) => `--- Extrait de ${f.name} ---\n${f.text_excerpt}`),
          ].filter(Boolean).join('\n') : '',
        ].filter(Boolean).join('\n');
        const res = await api.assistChat(prompt, {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Casablanca',
          thread_id: threadId,
          user_message: q || userText,
          page_path: page.path,
          page_title: page.title,
          images: files.filter((f) => (f.type || '').startsWith('image/')).map((f) => sanitizeImageDataUrl(f.data_url)).filter(Boolean).slice(0, 4),
          exec_mode: execMode,
          agent_perm_mode: agentPermMode,
          signal: ac.signal,
          onAgentEvent: (event, data) => {
            if (ac.signal.aborted) return;
            if (event === 'tool_start' && typeof data?.name === 'string') {
              setActiveTool(data.name);
            } else if (event === 'tool' && typeof data?.name === 'string') {
              setActiveTool('');
              setLiveTools((items) => [...items, { name: data.name, ok: data.ok !== false }]);
            } else if (event === 'token' && typeof data?.t === 'string' && data.t) {
              setReceivingReply(true);
              setMsgs((messages) => {
                let index = -1;
                messages.forEach((message, i) => { if (message.role === 'assistant' && message.streaming) index = i; });
                if (index < 0) return [...messages, { role: 'assistant', text: data.t, streaming: true, prompt: q }];
                const next = [...messages];
                next[index] = { ...next[index], text: next[index].text + data.t };
                return next;
              });
            }
          },
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
        finishReply({
          role: 'assistant', text: reply, ms,
          tools,
          sources,
          proposals: res.data?.proposals || [],
          prompt: q,
        });
      } catch (e: any) {
        if (ac.signal.aborted) {
          finishReply({ role: 'assistant', text: 'Réception arrêtée. Une action déjà lancée peut se poursuivre.', ms: Math.round(performance.now() - t0) });
          return;
        }
        finishReply({
          role: 'assistant', text: friendlyError(e) || 'Je ne peux pas répondre pour le moment.',
          ms: Math.round(performance.now() - t0), failed: true, prompt: q,
        });
      } finally {
        setBusy(false);
        setLiveTools([]);
        setActiveTool('');
        setReceivingReply(false);
        abortRef.current = null;
      }
    },
    [busy, loadingThread, deletingThread, input, attachments, page, threadId, applyAction, location.pathname, agentPolicy],
  );

  const stop = () => {
    abortRef.current?.abort();
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


  const switchThread = (id: string) => {
    if (busy || loadingThread || deletingThread || syncStatus === 'pending' || syncStatus === 'saving' || id === threadId) { setHistoryOpen(false); return; }
    conversationRevision.current += 1;
    const local = loadMsgs(id);
    setThreadId(id);
    setMsgs(local.length ? local : [WELCOME]);
    setPendingAction(null);
    setAttachments([]);
    lastFilesRef.current = [];
    setInput('');
    setExpandedTools({});
    setHistoryOpen(false);
  };
  const deleteThread = async (thread: ThreadMeta) => {
    if (busy || loadingThread || deletingThread || syncStatus === 'pending' || syncStatus === 'saving') return;
    const user = scopeUser();
    setDeletingThread(thread.id); setDeleteError('');
    try {
      await api.deleteAgentThread(thread.id);
      if (scopeUser() !== user) return;
      try { localStorage.removeItem(msgsKey(thread.id)); sessionStorage.removeItem(msgsKey(thread.id)); localStorage.removeItem(pendingKey(thread.id)); } catch { /* remote deletion already completed */ }
      setThreads(prev => { const next = prev.filter(t => t.id !== thread.id); saveThreads(next); return next; });
      if (thread.id === threadId) { conversationRevision.current++; syncRef.current = null; setThreadId(newThreadId()); setMsgs([WELCOME]); setInput(''); setAttachments([]); setPendingAction(null); }
      setHistoryOpen(false);
    } catch { if (scopeUser() === user) setDeleteError('Suppression impossible. La conversation reste affichée ; réessayez.'); }
    finally { if (scopeUser() === user) setDeletingThread(null); }
  };
  const saveConflictAsNew = () => {
    if (syncStatus !== 'conflict' || busy) return;
    const id = newThreadId();
    const title = String(msgs.find(m => m.role === 'user')?.text || 'Conversation').trim().slice(0, 48);
    if (!saveMsgs(id, msgs)) { setSyncStatus('offline'); return; }
    try { localStorage.setItem(pendingKey(id), JSON.stringify({ known: true, version: null })); }
    catch { setSyncStatus('offline'); return; }
    conversationRevision.current += 1;
    setThreads(prev => { const next = [{ id, title, updated: Date.now() }, ...prev].slice(0, 20); saveThreads(next); return next; });
    setThreadId(id); setHistoryOpen(false);
  };
  const activeTitle = threads.find((thread) => thread.id === threadId)?.title || 'Nouvelle conversation';
  const showWelcome = !loadingThread && !busy && !msgs.some((message) => message.role === 'user');
  const hasStreamingText = msgs.some((message) => message.streaming && message.text.trim());
  const visibleThreads = threads.filter((thread) => thread.title.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()));

  const hideAgent = ['/settings', '/about', '/whats-new', '/login', '/welcome', '/privacy', '/terms', '/licenses'].some(
    (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
  );
  if (hideAgent) return null;

  return (
    <>
{!isPhoneShell && !open && (
            <button
        type="button"
        className="atlas-agent-fab atlas-agent-fab-premium"
        aria-label="Ouvrir Atlas Agent"
        title="Atlas Agent"
        onClick={() => {
          setOpen(true);
          try {
            document.documentElement.classList.add('atlas-agent-docked');
            sessionStorage.setItem(OPEN_KEY, '1');
          } catch { /* */ }
        }}
      >
        <span className="atlas-agent-fab-ring" aria-hidden />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
          <path d="M12 3l1.6 4.8L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9L5.5 9.5l4.9-1.7L12 3z" />
          <path d="M19 4v3M17.5 5.5h3" strokeWidth="1.5" />
        </svg>
      </button>
      )}

      <aside className={`atlas-agent-panel ${open ? 'open' : ''}${expanded ? ' atlas-agent-panel--expanded' : ''}${expanded && !isPhoneShell ? ' atlas-agent-has-sidebar' : ''}`} aria-hidden={!open} aria-label="Atlas Agent" style={{ width: expanded ? '100vw' : panelWidth }}>
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
        {expanded && !isPhoneShell && <nav className="atlas-agent-workspace-sidebar" aria-label="Conversations Atlas Agent">
          <div className="atlas-agent-workspace-brand"><span className="atlas-agent-sidebar-mark"><Sparkles size={16} /></span><strong>Atlas Agent</strong></div>
          <button type="button" className="atlas-agent-sidebar-new" disabled={busy || loadingThread || syncStatus === 'pending' || syncStatus === 'saving'} onClick={() => switchThread(newThreadId())}><Plus size={16} /> Nouvelle conversation</button>
          <label className="atlas-agent-history-search"><Search size={15} aria-hidden="true" /><input aria-label="Rechercher dans les conversations" placeholder="Rechercher…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} /></label>
          <div className="atlas-agent-history-caption">Conversations récentes</div>
          {historyError && <p className="atlas-agent-history-error" role="status">Certaines conversations R2 sont indisponibles.</p>}
          {historyPending && <p className="atlas-agent-history-error" role="status">Certains titres se chargent à l’ouverture.</p>}
          {deleteError && <p className="atlas-agent-history-error" role="alert">{deleteError}</p>}
          <div className="atlas-agent-workspace-threads">
            {visibleThreads.length ? visibleThreads.map((thread) => <div className="atlas-agent-thread-row" key={thread.id}><button type="button" disabled={busy || loadingThread || !!deletingThread} className={`atlas-agent-sidebar-thread${thread.id === threadId ? ' is-current' : ''}`} aria-current={thread.id === threadId ? 'page' : undefined} onClick={() => switchThread(thread.id)}>{thread.title}</button><button type="button" className="atlas-agent-thread-delete" aria-label={`Supprimer ${thread.title}`} title="Supprimer la conversation" disabled={busy || loadingThread || !!deletingThread || syncStatus === 'pending' || syncStatus === 'saving'} onClick={() => setDeleteCandidate({ ...thread, user: scopeUser() })}><Trash2 size={15} /></button></div>) : <p>Aucune conversation trouvée.</p>}
          </div>
        </nav>}
        <div className="atlas-agent-main">
        <header className="atlas-agent-head">
          <div className="atlas-agent-header-title">
            <span className="atlas-agent-header-mark" aria-hidden="true"><Sparkles size={17} /></span>
            <button type="button" className="atlas-agent-history-trigger" aria-label="Historique des conversations" aria-expanded={historyOpen} aria-controls="atlas-agent-history-menu" onClick={() => setHistoryOpen((value) => !value)}>
              <span><small>ATLAS AGENT</small><strong>{activeTitle}</strong></span><ChevronDown size={15} aria-hidden="true" />
            </button>
            {historyOpen && <div id="atlas-agent-history-menu" className="atlas-agent-history-popover" onKeyDown={(event) => { if (event.key === 'Escape') setHistoryOpen(false); }}>
              <label className="atlas-agent-history-search"><Search size={15} aria-hidden="true" /><input aria-label="Rechercher une conversation" placeholder="Rechercher…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} /></label>
              <div className="atlas-agent-history-caption">Conversations récentes</div>
              {deleteError && <p className="atlas-agent-history-error" role="alert">{deleteError}</p>}
              <div className="atlas-agent-history-list">
                {visibleThreads.length ? visibleThreads.map((thread) => <div className="atlas-agent-thread-row" key={thread.id}><button type="button" disabled={busy || loadingThread || !!deletingThread} className={`atlas-agent-history-choice${thread.id === threadId ? ' is-current' : ''}`} onClick={() => switchThread(thread.id)}><span>{thread.title}</span>{thread.id === threadId && <span aria-label="Conversation actuelle">•</span>}</button><button type="button" className="atlas-agent-thread-delete" aria-label={`Supprimer ${thread.title}`} title="Supprimer la conversation" disabled={busy || loadingThread || !!deletingThread || syncStatus === 'pending' || syncStatus === 'saving'} onClick={() => setDeleteCandidate({ ...thread, user: scopeUser() })}><Trash2 size={15} /></button></div>) : <p>Aucune conversation trouvée.</p>}
              </div>
              <button type="button" className="atlas-agent-history-new" disabled={busy || loadingThread || syncStatus === 'pending' || syncStatus === 'saving'} onClick={() => switchThread(newThreadId())}><Plus size={15} /> Nouvelle conversation</button>
            </div>}
          </div>
          {!isPhoneShell && (
          <div className="atlas-agent-head-actions">
<button type="button" className="atlas-agent-iconbtn" aria-label={expanded ? 'Réduire le panneau' : 'Agrandir le panneau'} aria-pressed={expanded} title={expanded ? 'Réduire' : 'Agrandir'} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
<button type="button" className="atlas-agent-iconbtn atlas-agent-new" disabled={busy} aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={() => switchThread(newThreadId())}><Plus size={18} /></button>
<button
              type="button"
              className={`atlas-agent-iconbtn${showExtras ? ' on' : ''}`}
              title={showExtras ? 'Masquer les raccourcis' : 'Afficher les raccourcis'}
              aria-pressed={showExtras}
              aria-label={showExtras ? 'Masquer les raccourcis' : 'Afficher les raccourcis'}
              onClick={() => {
                setShowExtras((v) => {
                  const next = !v;
                  try { localStorage.setItem('atlas_agent_show_extras', next ? '1' : '0'); } catch { /* */ }
                  return next;
                });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                {showExtras ? (
                  <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></>
                ) : (
                  <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.6 2 12 2 12s3.6 7 10 7c1.5 0 2.9-.4 4.1-1" /></>
                )}
              </svg>
            </button>
            <button type="button" className="atlas-agent-close" aria-label="Fermer" title="Fermer" onClick={() => {
          setOpen(false);
          try {
            document.documentElement.classList.remove('atlas-agent-docked');
            sessionStorage.setItem(OPEN_KEY, '0');
          } catch { /* */ }
        }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          )}
        </header>


        


        {syncStatus !== 'saved' && <div className="atlas-agent-sync-status" role="status">
          {syncStatus === 'loading' ? 'Chargement de la conversation R2…' : syncStatus === 'saving' || syncStatus === 'pending' ? 'Sauvegarde de la conversation sur R2…' : syncStatus === 'conflict' ? 'Conversation modifiée ailleurs : votre copie locale est conservée, sans écraser R2.' : syncStatus === 'too-large' ? 'Conversation trop volumineuse pour R2. Démarrez une nouvelle conversation ; la copie locale est conservée si possible.' : 'R2 indisponible : sauvegarde locale seulement, si le navigateur le permet.'}
          {syncStatus === 'offline' && <button type="button" className="secondary" onClick={() => setReloadThread(v => v + 1)}>Réessayer</button>}
          {syncStatus === 'conflict' && <button type="button" className="secondary" disabled={busy} onClick={saveConflictAsNew}>Enregistrer une copie</button>}
        </div>}

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

        <div className="atlas-agent-body" role="log" aria-label="Conversation Atlas Agent" aria-live="polite" aria-relevant="additions">
          {showWelcome && <section className="atlas-agent-welcome" aria-label="Bienvenue dans Atlas Agent">
            <div className="atlas-agent-welcome-art" aria-hidden="true"><span /><span /><Sparkles size={29} /></div>
            <p className="atlas-agent-welcome-eyebrow">VOTRE ASSISTANT ATLAS</p>
            <h2>{timeGreeting().hello}.</h2>
            <p className="atlas-agent-welcome-sub">Comment puis-je vous aider aujourd’hui ?</p>
            <div className="atlas-agent-welcome-cards" aria-label="Questions suggérées">
              {[
                { Icon: PackageSearch, label: 'Surveiller le stock', detail: 'Voir les produits en stock bas', prompt: 'Quels produits sont en stock bas ?' },
                { Icon: ListChecks, label: 'Actions en attente', detail: 'Savoir quoi traiter en priorité', prompt: 'Quelles actions sont en attente ?' },
                ...(!stockOnly && canOfficeWork() ? [{ Icon: FileText, label: 'Suivre les factures', detail: 'Consulter les factures impayées', prompt: 'Quelles factures sont impayées ?' }] : []),
              ].map(({ Icon, label, detail, prompt }) => <button type="button" key={label} disabled={busy || !!agentPolicy?.blocked} onClick={() => void send(prompt)}><span className="atlas-agent-card-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={15} className="atlas-agent-card-arrow" /></button>)}
            </div>
            <div className="atlas-agent-context"><span /> Page actuelle : <strong>{page.title}</strong></div>
          </section>}
          {loadingThread && !msgs.some((m) => m.role === 'user') && <AtlasAgentShimmerBody rows={2} />}
          {!(loadingThread && !msgs.some((m) => m.role === 'user')) && msgs.map((m, i) => ((m.streaming && !String(m.text || '').trim()) || (i === 0 && m.role === 'assistant' && m.text === WELCOME.text)) ? null : (
            <div key={i} className={`atlas-agent-msg ${m.role}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="atlas-agent-tools">
                  <button
                    type="button"
                    className="atlas-agent-tools-toggle"
                    aria-expanded={!!expandedTools[i]}
                    onClick={() => setExpandedTools((s) => ({ ...s, [i]: !s[i] }))}
                  >
                    {expandedTools[i] ? '▾' : '▸'} {m.tools.some((tool) => tool.ok === false) ? 'Activité avec erreur' : 'Activité terminée'} · {m.tools.length} étape{m.tools.length > 1 ? 's' : ''}
                  </button>
                  {expandedTools[i] && (
                    <ul className="atlas-agent-tools-list">
                      {m.tools.map((t, j) => (
                        <li key={j} className={t.ok ? 'ok' : 'bad'}>
                          <span>{toolLabel(t.name)}</span>
                          <span>{t.ok ? 'Terminé' : 'Échec'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <span className="atlas-agent-msg-label">{m.role === 'assistant' ? 'Atlas Agent' : 'Vous'}</span>
              <div className="atlas-agent-bubble">
                {m.role === 'assistant' ? renderMiniMarkdown(String(m.text || '')) : m.text}
                {m.role === 'user' && ((m as any).fileNames || []).length ? (
                  <div className="atlas-agent-msg-files">
                    {((m as any).fileNames || []).map((n: string, k: number) => (
                      <span key={k} className="atlas-agent-msg-file" title={n}>{n}</span>
                    ))}
                  </div>
                ) : null}
                {m.role === 'user' && (m.images || []).length ? (
                  <div className="atlas-agent-msg-imgs">
                    {(m.images || []).map((raw, k) => (
                      <img
                        key={k}
                        src={m.imageUrls?.[k] || sanitizeImageDataUrl(raw)}
                        alt={`Pièce jointe ${k + 1}`}
                        title="Ouvrir l’image"
                        style={{ cursor: 'zoom-in' }}
                        onClick={() => setLightbox({ src: m.imageUrls?.[k] || sanitizeImageDataUrl(raw), name: `Pièce jointe ${k + 1}` })}
                      />
                    ))}
                  </div>
                ) : null}
                {m.streaming ? <span className="atlas-agent-caret">▍</span> : null}
              </div>
              {m.role === 'user' && !m.streaming && m.text.trim() ? (
                <div className="atlas-agent-msg-actions atlas-agent-msg-actions--user">
                  <button
                    type="button"
                    className="atlas-agent-msg-act"
                    title="Copier"
                    onClick={() => {
                      void navigator.clipboard?.writeText(m.text);
                      try { uiToast('Copié', 'success'); } catch { /* */ }
                    }}
                  >
                    <IconCopy />
                  </button>
                  <button
                    type="button"
                    className="atlas-agent-msg-act"
                    title="Retirer"
                    onClick={() => setMsgs((list) => list.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {m.role === 'assistant' && !m.streaming && m.text.trim() ? (
                <div className="atlas-agent-msg-actions atlas-agent-msg-actions--assistant">
                  <button
                    type="button"
                    className="atlas-agent-msg-act"
                    title="Copier"
                    onClick={() => {
                      void navigator.clipboard?.writeText(m.text);
                      try { uiToast('Copié', 'success'); } catch { /* */ }
                    }}
                  >
                    <IconCopy />
                  </button>
                  {m.prompt && !m.failed ? (
                    <button
                      type="button"
                      className="atlas-agent-msg-act"
                      title="Réessayer"
                      disabled={busy}
                      onClick={() => void send(m.prompt!, true, i)}
                    >
                      <IconRetry />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="atlas-agent-msg-act"
                    title="Retirer"
                    onClick={() => setMsgs((list) => list.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                  {m.variants && m.variants.length > 1 ? (
                    <div className="atlas-agent-variant-nav" aria-label="Versions de la réponse">
                      <button
                        type="button"
                        className="atlas-agent-msg-act"
                        title="Précédent"
                        disabled={(m.variantIndex ?? 0) <= 0}
                        onClick={() => {
                          setMsgs((list) => {
                            const copy = [...list];
                            const cur = copy[i];
                            if (!cur?.variants?.length) return list;
                            const ni = Math.max(0, (cur.variantIndex ?? 0) - 1);
                            copy[i] = { ...cur, variantIndex: ni, text: cur.variants[ni] };
                            return copy;
                          });
                        }}
                      >
                        ‹
                      </button>
                      <span className="atlas-agent-variant-count">
                        {(m.variantIndex ?? 0) + 1}/{m.variants.length}
                      </span>
                      <button
                        type="button"
                        className="atlas-agent-msg-act"
                        title="Suivant"
                        disabled={(m.variantIndex ?? 0) >= m.variants.length - 1}
                        onClick={() => {
                          setMsgs((list) => {
                            const copy = [...list];
                            const cur = copy[i];
                            if (!cur?.variants?.length) return list;
                            const ni = Math.min(cur.variants.length - 1, (cur.variantIndex ?? 0) + 1);
                            copy[i] = { ...cur, variantIndex: ni, text: cur.variants[ni] };
                            return copy;
                          });
                        }}
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}


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

              {m.role === 'assistant' && m.text.trim() && (m.ms != null || m.failed) && !m.streaming && (
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
                      onClick={() => void send(m.prompt, true, msgs.indexOf(m))}
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
          {busy && (!hasStreamingText || liveTools.length > 0 || activeTool) && (
            <div className="atlas-agent-msg assistant">
              <span className="atlas-agent-msg-label">Atlas Agent</span>
              {!hasStreamingText && <div className="atlas-agent-bubble thinking atlas-agent-thinking-row" role="status">

                <LatticeLoader
                  status="working"
                  label={receivingReply ? 'Préparation de la réponse' : 'Réflexion'}
                  doneLabel="Terminé en"
                  errorLabel="Échec après"
                  pattern="orbit"
                  grid={3}
                  shape="round"
                  color="currentColor"
                  doneColor="#71717a"
                  errorColor="#ef4444"
                  cellSize={6}
                  gap={2}
                  fontSize={14}
                  step={90}
                  idleOpacity={0.15}
                  showTimer
                />
                <button type="button" className="atlas-agent-stop secondary" onClick={stop} title="Arrêter la réception ; une action déjà lancée peut se poursuivre">
                  Arrêter
                </button>
              </div>}
              {(liveTools.length > 0 || activeTool) && <div className="atlas-agent-live-activity" aria-label="Activité des outils">
                <strong>Activité</strong>
                {liveTools.map((tool, index) => <div key={index}><span>{toolLabel(tool.name)}</span><span>{tool.ok ? 'Terminé' : 'Échec'}</span></div>)}
                {activeTool && <div><span>{toolLabel(activeTool)}</span><span>En cours…</span></div>}
              </div>}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {showExtras && !isPhoneShell && (
        <div className="atlas-agent-nav atlas-agent-nav--readable">
          <span className="lbl">Aller à</span>
          <button type="button" className="secondary" onClick={() => go('/', 'Tableau de bord')}>Tableau de bord</button>
          <button type="button" className="secondary" onClick={() => go('/products', 'Produits')}>Produits</button>
          <button type="button" className="secondary" onClick={() => go('/actions', 'Boîte d’actions')}>Actions</button>
          {!stockOnly && canOfficeWork() && (
            <button type="button" className="secondary" onClick={() => go('/quotes', 'Devis')}>Devis</button>
          )}
          {!stockOnly && canSell() && (
            <button type="button" className="secondary" onClick={() => go('/quick-sale', 'Vente rapide')}>Vente</button>
          )}
          {!stockOnly && canOfficeWork() && (
            <button type="button" className="secondary" onClick={() => go('/invoices', 'Factures')}>Factures</button>
          )}
        </div>
        )}

        {showExtras && (
        <div className="atlas-agent-suggest atlas-agent-suggest--readable">
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
        )}

        <footer className="atlas-agent-foot">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.odt,.txt,.csv,.xlsx,.xls"
            multiple
            style={{ display: 'none' }}
            onChange={onPickFiles}
          />
          {agentPolicy?.blocked && open && !blockedModalSeen &&
            createPortal(
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="atlas-agent-blocked-title"
                style={{
                  position: 'fixed', inset: 0, zIndex: 999, display: 'grid', placeItems: 'center',
                  background: 'rgba(9, 9, 11, 0.55)', backdropFilter: 'blur(3px)', padding: 20,
                }}
              >
                <div
                  style={{
                    maxWidth: 420, width: '100%', borderRadius: 18, padding: 22,
                    background: 'var(--paper, #fff)', border: '1px solid var(--line, #e4e4e7)',
                    boxShadow: '0 24px 60px rgba(0,0,0,.35)', textAlign: 'center',
                  }}
                >
                  <div style={{ width: 46, height: 46, margin: '0 auto 12px', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(196,92,38,.12)', color: '#c45c26' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  </div>
                  <h2 id="atlas-agent-blocked-title" style={{ margin: '0 0 8px', fontSize: 17 }}>
                    Accès Atlas Agent suspendu
                  </h2>
                  <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--muted, #52525b)' }}>
                    Abus ou injection de prompt détecté sur votre compte. L’accès est verrouillé jusqu’à
                    rétablissement par un administrateur (Paramètres → Atlas Agent & Sécurité).
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      try { sessionStorage.setItem('atlas-agent-blocked-seen', '1'); } catch { /* privé */ }
                      setBlockedModalSeen(true);
                    }}
                  >
                    J’ai compris
                  </button>
                </div>
              </div>,
              document.body,
            )}
          {agentPolicy?.blocked && (
            <div className="atlas-agent-lock" role="alert">
              <strong>Accès Atlas Agent suspendu</strong>
              <span>
                Détection d’abus ou d’injection de prompt. L’accès est verrouillé jusqu’à rétablissement par un
                administrateur (Paramètres → Atlas Agent & Sécurité).
              </span>
            </div>
          )}
          {agentPolicy && !agentPolicy.isAdmin && !agentPolicy.blocked && (quotaPercent(agentPolicy.dailyUsed, agentPolicy.dailyLimit) !== null || quotaPercent(agentPolicy.weeklyUsed, agentPolicy.weeklyLimit) !== null) && (
            <div
              className="atlas-agent-quota"
              title={`Jetons utilisés (jour / semaine) — rafraîchit ${fmtReset(agentPolicy.dailyResetsAt)} / ${fmtReset(agentPolicy.weeklyResetsAt)}`}
            >
              {[
                quotaPercent(agentPolicy.dailyUsed, agentPolicy.dailyLimit) !== null ? `${quotaPercent(agentPolicy.dailyUsed, agentPolicy.dailyLimit)}% du quota jour` : '',
                quotaPercent(agentPolicy.weeklyUsed, agentPolicy.weeklyLimit) !== null ? `${quotaPercent(agentPolicy.weeklyUsed, agentPolicy.weeklyLimit)}% semaine` : '',
              ].filter(Boolean).join(' · ')}
              {quotaReached(agentPolicy.dailyUsed, agentPolicy.dailyLimit) || quotaReached(agentPolicy.weeklyUsed, agentPolicy.weeklyLimit)
                ? ` — rafraîchit ${fmtReset(quotaReached(agentPolicy.dailyUsed, agentPolicy.dailyLimit) ? agentPolicy.dailyResetsAt : agentPolicy.weeklyResetsAt)}`
                : ''}
            </div>
          )}
          {!agentPolicy?.blocked && (
          <PromptBar
            key={threadId}
            placeholder="Écrire un message…"
            sources={[
              {
                key: 'files',
                name: 'Photos & fichiers',
                description: 'Images et documents (max 4 Mo)',
                icon: Attachment01Icon,
                attach: true,
              },
            ]}
            commands={[
              { key: 'summarize', name: '/résumer', description: 'Synthèse de la conversation' },
              { key: 'draft', name: '/brouillon', description: 'Première version' },
              { key: 'explain', name: '/expliquer', description: 'En langage simple' },
            ]}
            models={[]}
            efforts={[]}
            busy={busy || loadingThread || !!agentPolicy?.blocked}
            onSend={(text) => {
              setInput(text);
              void send(text);
            }}
            onStop={stop}
            attachments={attachments.map((a) => ({
              name: a.name,
              // v256 — drafts restored after a refresh have no blob preview;
              // fall back to the (sanitized) compressed data URL.
              preview: a.preview_url || sanitizeImageDataUrl(a.data_url) || undefined,
            }))}
            onRemoveAttachment={(i) =>
              setAttachments((prev) => (i === -1 ? [] : prev.filter((_, j) => j !== i)))
            }
            onEditAttachment={(i) => {
              const a = attachments[i];
              if (a) setAnnotator({ index: i, src: a.preview_url || sanitizeImageDataUrl(a.data_url), name: a.name });
            }}
            onPreviewAttachment={(i) => {
              const a = attachments[i];
              if (a) setLightbox({ src: a.preview_url || sanitizeImageDataUrl(a.data_url), name: a.name });
            }}
            onAttach={() => {
              fileInputRef.current?.click();
            }}
            background="var(--ac-ui-surface-2, #f4f4f5)"
            color="var(--ac-ui-ink, #0f172a)"
            menuBackground="var(--ac-ui-surface, #ffffff)"
            sparkColor={
              typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
                ? '#d4d4d8'
                : '#3f3f46'
            }
            width={720}
            radius={16}
            maxRows={5}
            className="atlas-agent-prompt-bar"
          />
          )}
        </footer>
        </div>
        {lightbox && (
          <ImageLightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />
        )}
        {annotator && (
          <ImageAnnotator
            src={annotator.src}
            name={annotator.name}
            onClose={() => setAnnotator(null)}
            onSave={(dataUrl) => {
              const idx = annotator.index;
              // v256 — flatten the annotated canvas to a compact JPEG so the
              // edited attachment also survives refresh persistence.
              void compressImageDataUrl(dataUrl).then((compact) => {
                setAttachments((prev) => prev.map((a, j) => (j === idx ? { ...a, data_url: compact, type: 'image/jpeg', preview_url: undefined } : a)));
              });
            }}
          />
        )}
      </aside>
      <ConfirmDialog open={!!deleteCandidate} title="Supprimer la conversation ?" message={`Supprimer « ${deleteCandidate?.title || ''} » et son contexte R2 ? Cette action est immédiate et sans annulation.`} confirmLabel="Supprimer" onCancel={() => setDeleteCandidate(null)} onConfirm={() => { const candidate = deleteCandidate; setDeleteCandidate(null); if (candidate && candidate.user === scopeUser()) void deleteThread(candidate); }} />
    </>
  );
}
