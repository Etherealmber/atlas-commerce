/**
 * Atlas Agent — dock + P0/P1/P2: citations, tools, drafts, stream UX, history, voice, role chips.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import LatticeLoader from './ui/LatticeLoader';
import PromptBar from './ui/PromptBar';
import { ImageLightbox } from './ui/ImageLightbox';
import { sanitizeImageDataUrl } from '../auth';
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

function IconHistory({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a1d26" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconNewChat({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a1d26" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function IconMic({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a1d26" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}
function IconSend({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

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
function IconAttach({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconSettings({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a1d26" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function IconStop({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1a1d26" aria-hidden>
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
  images?: string[];
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

function pageMeta(pathname: string): { title: string; hint: string; path: string } {
  if (pathname === '/agent')
    return { title: 'Atlas Agent', hint: 'Assistant mobile.', path: pathname };
  if (false /* /m removed */)
    return { title: 'Scan', hint: 'Code-barres terrain.', path: pathname };
  if (false)
    return { title: 'Entrepôts', hint: 'Stock terrain.', path: pathname };
  if (false)
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
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 20) : [];
  } catch {
    return [];
  }
}


const _persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _persistInflight = new Set<string>();

async function persistThreadR2(threadId: string, title: string, messages: any[]) {
  // Debounce: at most one PUT per thread every 2.5s (avoids admin rate-limit toast storms)
  const prev = _persistTimers.get(threadId);
  if (prev) clearTimeout(prev);
  const snapshot = messages.map((m) => ({
    role: m.role,
    text: m.text,
    ms: m.ms,
  }));
  const titleSnap = title;
  _persistTimers.set(
    threadId,
    setTimeout(() => {
      _persistTimers.delete(threadId);
      if (_persistInflight.has(threadId)) return;
      _persistInflight.add(threadId);
      void api
        .putAgentThread(threadId, { title: titleSnap, messages: snapshot })
        .catch(() => {
          /* offline / R2 / rate-limit — local sessionStorage already has the msgs */
        })
        .finally(() => {
          _persistInflight.delete(threadId);
        });
    }, 2500),
  );
}

function saveThreads(list: ThreadMeta[]) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* */ }
}

function fmtReset(iso?: string): string {
  if (!iso) return 'au prochain cycle';
  try {
    return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  } catch { return 'au prochain cycle'; }
}

function msgsKey(threadId: string) {
  return `${MSGS_KEY}:${threadId}`;
}

function loadMsgs(threadId: string): Msg[] {
  try {
    const raw = localStorage.getItem(msgsKey(threadId)) || sessionStorage.getItem(msgsKey(threadId)) || sessionStorage.getItem(MSGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.slice(-40);
  } catch { /* */ }
  return [];
}

function saveMsgs(threadId: string, msgs: Msg[]) {
  try {
    localStorage.setItem(msgsKey(threadId), JSON.stringify(msgs.slice(-40)));
    try {
      const th = loadThreads().find((t) => t.id === threadId);
      void persistThreadR2(threadId, th?.title || 'Sans titre', msgs.slice(-40));
    } catch { /* */ }
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


function scrubVendorNames(s: string) {
  return String(s || '')
    .replace(/\b(Google|Gemini|Atlas Agent|OpenAI|ChatGPT|Claude|Anthropic)\b/gi, 'Atlas Agent')
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
  const [showExtras, setShowExtras] = useState<boolean>(() => {
    try { return localStorage.getItem('atlas_agent_show_extras') === '1'; } catch { return false; }
  });
  const [agentPolicy, setAgentPolicy] = useState<{ blocked: boolean; isAdmin: boolean; dailyUsed: number; weeklyUsed: number; dailyLimit: number; weeklyLimit: number; dailyResetsAt?: string; weeklyResetsAt?: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await api.getAgentPolicy();
        if (alive && res?.data) setAgentPolicy(res.data);
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
  const [execMode, setExecMode] = useState<ExecMode>(() => getExecMode());
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
  const [listening, setListening] = useState(false); // unused (dictation removed)
  const [attachments, setAttachments] = useState<{ name: string; type: string; data_url: string }[]>([]);
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Hydrate conversation from sessionStorage + encrypted R2 (one file per thread)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const local = loadMsgs(threadId);
    if (local.length) {
      setMsgs(local);
    }
    (async () => {
      try {
        const res = await api.getAgentThread(threadId);
        if (cancelled) return;
        const remote = res?.data?.messages;
        if (!Array.isArray(remote) || !remote.length) return;
        const mapped = remote
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
          .map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            text: String(m.text || ''),
            ms: typeof m.ms === 'number' ? m.ms : undefined,
          }));
        if (!mapped.length) return;
        // Prefer remote if richer; else keep local
        setMsgs((cur) => {
          if (cur.length > mapped.length) return cur;
          try {
            sessionStorage.setItem(msgsKey(threadId), JSON.stringify(mapped.slice(-40)));
          } catch { /* */ }
          return mapped.slice(-40);
        });
        if (res?.data?.title) {
          setThreads((prev) => {
            const next = [
              { id: threadId, title: String(res.data.title).slice(0, 48), updated: Date.now() },
              ...prev.filter((x) => x.id !== threadId),
            ].slice(0, 20);
            saveThreads(next);
            return next;
          });
        }
      } catch {
        /* offline / rate limit — local history only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, open]);

  // Sync thread list from R2 index when panel opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listAgentThreads();
        if (cancelled) return;
        const remote = res?.data;
        if (!Array.isArray(remote) || !remote.length) return;
        setThreads((prev) => {
          const byId = new Map<string, ThreadMeta>();
          for (const t of prev) byId.set(t.id, t);
          for (const r of remote) {
            const id = String(r.id || '');
            if (!id) continue;
            const updated = r.updated_at ? new Date(r.updated_at).getTime() : Date.now();
            const existing = byId.get(id);
            byId.set(id, {
              id,
              title: String(r.title || existing?.title || 'Sans titre').slice(0, 48),
              updated: Math.max(existing?.updated || 0, updated || 0),
            });
          }
          const next = [...byId.values()].sort((a, b) => b.updated - a.updated).slice(0, 20);
          saveThreads(next);
          return next;
        });
      } catch { /* */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (prevPath.current === location.pathname) return;
    prevPath.current = location.pathname;
    if (!open) return;
    if (isPhoneShell) return;
    // Keep existing thread messages when navigating — restore from session if state was empty
    setMsgs((m) => {
      let base = m;
      if (!base.length) {
        const local = loadMsgs(threadId);
        if (local.length) base = local;
      }
      return [
        ...base,
        {
          role: 'assistant' as const,
          text: `Vous êtes sur « ${page.title} ». ${page.hint} Que puis-je faire ici ?`,
        },
      ];
    });
  }, [location.pathname, open, page.title, page.hint, isPhoneShell, threadId]);

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

  const streamText = (full: string, meta: Omit<Msg, 'role' | 'text' | 'streaming'>, replaceStreaming = true) => {
    const idPlaceholder = { role: 'assistant' as const, text: '', streaming: true, ...meta };
    setMsgs((m) => {
      if (replaceStreaming) {
        const idx = [...m].map((x, i) => (x.streaming && x.role === 'assistant' ? i : -1)).filter((i) => i >= 0).pop();
        if (typeof idx === 'number' && idx >= 0) {
          const copy = [...m];
          const prev = copy[idx];
          const variants = prev.variants ? [...prev.variants] : [];
          copy[idx] = { ...idPlaceholder, variants, variantIndex: variants.length };
          return copy;
        }
      }
      return [...m, idPlaceholder];
    });
    let i = 0;
    if (streamTimer.current) window.clearInterval(streamTimer.current);
    streamTimer.current = window.setInterval(() => {
      i += Math.max(2, Math.ceil(full.length / 40));
      const slice = full.slice(0, i);
      setMsgs((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.streaming) {
          const done = i >= full.length;
          let variants = last.variants ? [...last.variants] : [];
          let variantIndex = last.variantIndex ?? 0;
          if (done) {
            variants = [...variants, full];
            variantIndex = variants.length - 1;
          }
          copy[copy.length - 1] = {
            ...last,
            text: slice,
            streaming: !done,
            variants: done ? variants : last.variants,
            variantIndex: done ? variantIndex : last.variantIndex,
            ...meta,
          };
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
            text: `Action préparée : ${action.label}. ${why}`,
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
      const reader = new FileReader();
      reader.onload = () => {
        const data_url = String(reader.result || '');
        setAttachments((prev) => [...prev, { name: f.name, type: f.type || 'application/octet-stream', data_url }].slice(-5));
      };
      reader.readAsDataURL(f);
    }
  };

  const lastReportedLen = useRef(0);
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant' && msgs.length > lastReportedLen.current) {
      lastReportedLen.current = msgs.length;
      // v233 — the server charges real tokens; we just refresh the quota display
      api.getAgentPolicy()
        .then((res: any) => { if (res?.data) setAgentPolicy(res.data); })
        .catch(() => { /* */ });
    }
  }, [msgs]);

  const send = useCallback(
    async (raw?: string, isRetry = false, retryAtIndex?: number) => {
      const q = (raw ?? input).trim();
      const files = isRetry ? [] : attachments;
      if ((!q && !files.length) || busy) return;
      /* v225 security: blocked users and exhausted quotas cannot talk to the agent */
      if (agentPolicy?.blocked) {
        setMsgs((m) => [...m, { role: 'assistant', text: "⛔ Accès à Atlas Agent suspendu pour votre compte (abus ou injection de prompt détecté). Contactez un administrateur pour le rétablir." }]);
        return;
      }
      if (agentPolicy && !agentPolicy.isAdmin && agentPolicy.dailyUsed >= agentPolicy.dailyLimit) {
        setMsgs((m) => [...m, { role: 'assistant', text: `📉 Quota quotidien de jetons atteint. Il se rafraîchira ${fmtReset(agentPolicy.dailyResetsAt)} (minuit UTC) — chaque jour à la même heure. Les administrateurs ne sont pas limités.` }]);
        return;
      }
      if (agentPolicy && !agentPolicy.isAdmin && agentPolicy.weeklyUsed >= agentPolicy.weeklyLimit) {
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
      if (!isRetry) {
        setMsgs((m) => [...m, { role: 'user', text: userText, images: files.filter((f) => (f.type || '').startsWith('image/')).map((f) => sanitizeImageDataUrl(f.data_url)).filter(Boolean).slice(0, 4) }]);
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
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const t0 = performance.now();
      try {
        // Send the user text cleanly; page is context only (never inject "quoi faire"
        // into every prompt — that was matching local canned tips and making the agent dumb).
        const isGreeting = /^(bonjour|bonsoir|salut|hello|hi|hey|coucou|salam|bonne\s*(journée|soirée)|merci)[\s!.?]*$/i.test(q);
        const prompt = isGreeting
          ? q
          : [
              `Contexte page: ${page.title} (${page.path}). ${page.hint}`,
              'Réponds en français, de façon utile et naturelle (2–5 phrases max sauf si on demande un détail).',
              'Si la question est un salut ou hors sujet page, réponds normalement sans forcer un tutoriel de la page.',
              'Ne propose pas d\'ouvrir la page courante.',
              `Message: ${q || 'Analyse des pièces jointes (noms uniquement — contenu binaire non renvoyé au modèle).'}`,
              files.length
                ? `Fichiers joints (cette requête uniquement): ${files.map((f) => `${f.name} (${f.type})`).join('; ')}. Ne redemande pas de fichier si l'utilisateur n'en a pas fourni.`
                : 'Aucun fichier joint — ne demande pas de pièce jointe sauf si indispensable.',
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
            text: (friendlyError(e) || 'Je ne peux pas répondre pour le moment.') + '\n\n💡 Exemples de demandes que je sais traiter : « Résumé stock bas », « Rapport des ventes du jour », « Créer un client », « Ajouter une dépense de 200 DH », « Combien d\'actions en attente ? », « Que faire sur cette page ? ».',
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
    [busy, input, attachments, page, threadId, applyAction, location.pathname],
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
    try {
      localStorage.setItem(ACTIVE_THREAD_KEY, id);
    } catch { /* */ }
  };

  const refreshHistoryFromR2 = useCallback(async () => {
    try {
      const res = await api.listAgentThreads();
      const remote = (res.data || []).map((th: any) => ({
        id: String(th.id),
        title: String(th.title || 'Sans titre'),
        updated: th.updated_at ? new Date(th.updated_at).getTime() : Date.now(),
      }));
      setThreads((local) => {
        const map = new Map<string, ThreadMeta>();
        for (const t of local) map.set(t.id, t);
        for (const t of remote) {
          const prev = map.get(t.id);
          map.set(t.id, {
            id: t.id,
            title: t.title || prev?.title || 'Sans titre',
            updated: Math.max(prev?.updated || 0, t.updated || 0),
          });
        }
        const merged = Array.from(map.values())
          .sort((a, b) => b.updated - a.updated)
          .slice(0, 40);
        saveThreads(merged);
        return merged;
      });
    } catch {
      /* keep local */
    }
  }, []);

  const openThread = async (id: string) => {
    setThreadId(id);
    try {
      localStorage.setItem(ACTIVE_THREAD_KEY, id);
    } catch { /* */ }
    const local = loadMsgs(id);
    setMsgs(local.length ? local : [{ role: 'assistant', text: 'Chargement de la conversation…' }]);
    try {
      const res = await api.getAgentThread(id);
      const remoteMsgs = Array.isArray(res.data?.messages) ? res.data!.messages! : [];
      const mapped: Msg[] = remoteMsgs
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
        .map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          text: String(m.text),
          ms: m.ms,
        }));
      if (mapped.length) {
        setMsgs(mapped);
        try {
          sessionStorage.setItem(msgsKey(id), JSON.stringify(mapped.slice(-80)));
        } catch { /* */ }
        return;
      }
      if (!local.length) setMsgs([WELCOME]);
    } catch {
      if (!local.length) {
        setMsgs([
          {
            role: 'assistant',
            text: 'Impossible de charger cette conversation (R2). Réessayez ou ouvrez une nouvelle discussion.',
          },
        ]);
      }
    }
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

  const hideAgent = ['/settings', '/about', '/whats-new', '/login', '/welcome', '/privacy', '/terms'].some(
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
            <button type="button" className="atlas-agent-close atlas-agent-close--danger" aria-label="Fermer" title="Fermer" onClick={() => {
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


        


        <div className="atlas-agent-pagechip" title={page.path}>
          <span className="dot" />
          <div>
            <em>Page actuelle</em>
            <strong>{page.title}</strong>
          </div>
        </div>


        {msgs.length <= 1 && (
          <div className="atlas-agent-greeting">
            <strong>{timeGreeting().hello}</strong>
            <span>{timeGreeting().sub}</span>
            <div className="atlas-agent-chips atlas-agent-chips--readable">
              {(isPhoneShell
                ? [
                    { label: 'Stock bas', prompt: 'Résumé stock bas' },
                    { label: 'Actions', prompt: 'Combien d’actions en attente ?' },
                  ]
                : [
                    { label: 'Nouveau client', prompt: 'Créer un client' },
                    { label: 'Dépense', prompt: 'Ajouter une dépense' },
                    { label: 'Rapport du jour', prompt: 'Rapport des ventes du jour' },
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
          {msgs.filter((m) => !(m.streaming && !String(m.text || '').trim())).map((m, i) => (
            <div key={i} className={`atlas-agent-msg ${m.role}`}>
              <div className="atlas-agent-bubble">
                {m.role === 'assistant' ? renderMiniMarkdown(String(m.text || '')) : m.text}
                {m.role === 'user' && (m.images || []).length ? (
                  <div className="atlas-agent-msg-imgs">
                    {(m.images || []).map((raw, k) => (
                      <img
                        key={k}
                        src={sanitizeImageDataUrl(raw)}
                        alt={`Pièce jointe ${k + 1}`}
                        title="Ouvrir l’image"
                        style={{ cursor: 'zoom-in' }}
                        onClick={() => setLightbox({ src: sanitizeImageDataUrl(raw), name: `Pièce jointe ${k + 1}` })}
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
                  {m.prompt ? (
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
              <div className="atlas-agent-bubble thinking atlas-agent-thinking-row">
                <LatticeLoader
                  status="working"
                  label="Réflexion"
                  doneLabel="Terminé en"
                  errorLabel="Échec après"
                  pattern="orbit"
                  grid={3}
                  shape="round"
                  color="#0f172a"
                  doneColor="#71717a"
                  errorColor="#ef4444"
                  cellSize={6}
                  gap={2}
                  fontSize={14}
                  step={90}
                  idleOpacity={0.15}
                  showTimer
                />
                <button type="button" className="atlas-agent-stop secondary" onClick={stop}>
                  Arrêter
                </button>
              </div>
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
          {agentPolicy?.blocked && (
            <div className="atlas-agent-lock" role="alert">
              <strong>Accès Atlas Agent suspendu</strong>
              <span>
                Détection d’abus ou d’injection de prompt. L’accès est verrouillé jusqu’à rétablissement par un
                administrateur (Paramètres → Atlas Agent & Sécurité).
              </span>
            </div>
          )}
          {agentPolicy && !agentPolicy.isAdmin && !agentPolicy.blocked && (
            <div
              className="atlas-agent-quota"
              title={`Jetons utilisés (jour / semaine) — rafraîchit ${fmtReset(agentPolicy.dailyResetsAt)} / ${fmtReset(agentPolicy.weeklyResetsAt)}`}
            >
              {Math.min(100, Math.round((agentPolicy.dailyUsed / agentPolicy.dailyLimit) * 100))}% du quota jour · {Math.min(100, Math.round((agentPolicy.weeklyUsed / agentPolicy.weeklyLimit) * 100))}% semaine
              {agentPolicy.dailyUsed >= agentPolicy.dailyLimit || agentPolicy.weeklyUsed >= agentPolicy.weeklyLimit
                ? ` — rafraîchit ${fmtReset(agentPolicy.dailyUsed >= agentPolicy.dailyLimit ? agentPolicy.dailyResetsAt : agentPolicy.weeklyResetsAt)}`
                : ''}
            </div>
          )}
          <PromptBar
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
            busy={busy || !!agentPolicy?.blocked}
            onSend={(text) => {
              setInput(text);
              void send(text);
            }}
            onStop={stop}
            attachments={attachments.map((a) => ({
              name: a.name,
              preview: (a.type || '').startsWith('image/') ? sanitizeImageDataUrl(a.data_url) || undefined : undefined,
            }))}
            onRemoveAttachment={(i) =>
              setAttachments((prev) => (i === -1 ? [] : prev.filter((_, j) => j !== i)))
            }
            onEditAttachment={(i) => {
              const a = attachments[i];
              const safeSrc = a ? sanitizeImageDataUrl(a.data_url) : '';
              if (a && safeSrc) setAnnotator({ index: i, src: safeSrc, name: a.name });
            }}
            onPreviewAttachment={(i) => {
              const a = attachments[i];
              if (a) setLightbox({ src: a.data_url, name: a.name });
            }}
            onAttach={() => {
              fileInputRef.current?.click();
            }}
            background="#f4f4f5"
            color="#0f172a"
            menuBackground="#ffffff"
            sparkColor="#3f3f46"
            width={720}
            radius={16}
            maxRows={5}
            className="atlas-agent-prompt-bar"
          />
        </footer>
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
              setAttachments((prev) => prev.map((a, j) => (j === idx ? { ...a, data_url: dataUrl, type: 'image/png' } : a)));
            }}
          />
        )}
      </aside>
    </>
  );
}
