import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import RefreshIconButton from '../components/RefreshIconButton';
import EmptyState from '../components/EmptyState';
import { buildOfficePreview, type OfficeSlide } from '../lib/officePreview';
import { useUi } from '../components/AppDialogs';
import { InlineDisclosureMenu } from '../components/ui/InlineDisclosureMenu';
import { ComposeEmailCard } from '../components/mailbox/ComposeEmailCard';
import { ListPager } from '../components/ui/ListPager';
import { Archive, MailWarning, Printer, Link2, FileText, Inbox } from 'lucide-react';

type MailRow = {
  id: number;
  direction: 'in' | 'out';
  from_addr: string;
  to_addr: string;
  subject: string;
  status: string;
  thread_key?: string;
  preview?: string;
  created_at: string;
  has_attachments?: number | boolean;
  meta_json?: string;
};

type MailDetail = MailRow & {
  body_text?: string;
  body_html?: string;
  meta_json?: string;
};

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}


type AttMeta = { filename: string; mimeType: string; size: number; r2_key: string };

function attKind(a: AttMeta): 'image' | 'pdf' | 'video' | 'audio' | 'office' | 'other' {
  const mt = (a.mimeType || '').toLowerCase();
  const name = (a.filename || '').toLowerCase();
  if (mt.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
  if (mt === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mt.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(name)) return 'video';
  if (mt.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/i.test(name)) return 'audio';
  if (
    /officedocument|msword|ms-excel|ms-powerpoint|opendocument/i.test(mt) ||
    /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|txt)$/i.test(name)
  ) return 'office';
  return 'other';
}

function mimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.mp4') || n.endsWith('.m4v')) return 'video/mp4';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (n.endsWith('.wav')) return 'audio/wav';
  if (n.endsWith('.ogg')) return 'audio/ogg';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  return fallback;
}

const QUICK_REPLIES: { label: string; body: string }[] = [
  { label: 'Merci', body: 'Bonjour,\n\nMerci pour votre message. Nous revenons vers vous rapidement.\n\nCordialement,' },
  { label: 'Bien reçu', body: 'Bonjour,\n\nBien reçu, merci.\n\nCordialement,' },
  { label: 'Disponible', body: 'Bonjour,\n\nOui, nous sommes disponibles. Quand souhaitez-vous échanger ?\n\nCordialement,' },
  { label: 'Devis', body: 'Bonjour,\n\nNous préparons un devis et vous le transmettons dès que possible.\n\nCordialement,' },
  { label: 'Paiement', body: 'Bonjour,\n\nPourriez-vous nous indiquer la date de règlement prévue ?\n\nCordialement,' },
  { label: 'Relance douce', body: 'Bonjour,\n\nSauf erreur de notre part, une facture reste en attente. Pouvez-vous nous confirmer ?\n\nCordialement,' },
];

function attIcon(kind: ReturnType<typeof attKind>): string {
  switch (kind) {
    case 'image': return '🖼️';
    case 'pdf': return '📄';
    case 'video': return '🎬';
    case 'audio': return '🎵';
    case 'office': return '📑';
    default: return '📎';
  }
}

function parseAttachments(meta_json?: string): AttMeta[] {
  if (!meta_json) return [];
  try {
    const m = JSON.parse(meta_json);
    return Array.isArray(m?.attachments) ? m.attachments : [];
  } catch {
    return [];
  }
}

function fmtDate(s: string): string {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Renders a real HTML email body safely, without needing a sanitizer
 * dependency: an iframe with sandbox="allow-same-origin" only (no
 * allow-scripts, no allow-forms, no allow-popups) executes no script and
 * submits nothing, while still rendering the sender's actual layout, fonts,
 * and inline images/logos exactly as sent. Auto-grows to fit its content.
 */
type CidAtt = { filename?: string; mimeType?: string; r2_key?: string; content_id?: string };

const MAIL_REMOTE_IMAGES_KEY = 'atlas_mail_load_remote_images';

function getMailRemoteImagesPref(): boolean {
  try {
    return localStorage.getItem(MAIL_REMOTE_IMAGES_KEY) === '1';
  } catch {
    return false;
  }
}

function setMailRemoteImagesPref(on: boolean) {
  try {
    localStorage.setItem(MAIL_REMOTE_IMAGES_KEY, on ? '1' : '0');
  } catch { /* */ }
}

function rewriteMailHtml(html: string, attachments: CidAtt[], loadRemote: boolean): string {
  let out = html || '';
  for (const a of attachments) {
    const cid = String(a.content_id || '').replace(/[<>]/g, '').trim();
    if (!cid || !a.r2_key) continue;
    const url =
      `/api/admin/mailbox/attachment?key=${encodeURIComponent(a.r2_key)}` +
      `&inline=1&filename=${encodeURIComponent(a.filename || 'image')}`;
    const re = new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    out = out.replace(re, url);
  }
  if (!loadRemote) {
    const placeholder = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="160" viewBox="0 0 280 160">
        <rect width="100%" height="100%" rx="12" fill="#f5f2eb"/>
        <rect x="24" y="24" width="232" height="112" rx="8" fill="#efebe3"/>
        <g fill="none" stroke="#9aa8a2" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="108" y="52" width="64" height="48" rx="6"/>
          <circle cx="126" cy="70" r="6"/>
          <path d="M116 90l16-14 12 10 10-8 18 16"/>
        </g>
        <text x="140" y="130" text-anchor="middle" fill="#9aa3b5" font-family="system-ui,sans-serif" font-size="12">Image non chargée</text>
      </svg>`.replace(/\s+/g, ' '),
    );
    out = out.replace(
      /(<img\b[^>]*\bsrc\s*=\s*["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi,
      (_m, a, src, b) =>
        `${a}data:image/svg+xml,${placeholder}${b} data-blocked-src="${src}" class="mail-img-blocked"`,
    );
  }
  return out;
}

function HtmlMailBody({ html, attachments = [] }: { html: string; attachments?: CidAtt[] }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  const [loadRemote, setLoadRemote] = useState(() => getMailRemoteImagesPref());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasRemote = useMemo(
    () => /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(html || ''),
    [html],
  );

  const doc = useMemo(() => {
    const body = rewriteMailHtml(html, attachments, loadRemote);
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <base target="_blank">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        html,body{margin:0;padding:20px 16px 28px;font-family:-apple-system,'IBM Plex Sans',system-ui,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;background:#fff;word-break:break-word;overflow:hidden !important;}
        img{max-width:100%;height:auto;display:block;margin:12px auto;}
        img.mail-img-blocked{margin-left:auto;margin-right:auto;border-radius:12px;}
        a{color:#3a6ea5;}
        table{max-width:100% !important;width:100% !important;}
        h1,h2,h3{line-height:1.3;}
        *{box-sizing:border-box;}
      </style>
    </head><body>${body}</body></html>`;
  }, [html, attachments, loadRemote]);

  const lastH = useRef(0);

  const resize = () => {
    try {
      const iframe = ref.current;
      const doc2 = iframe?.contentDocument;
      if (!iframe || !doc2?.body) return;
      // Collapse to content size first — avoids scrollHeight feedback loops
      const htmlEl = doc2.documentElement;
      const body = doc2.body;
      htmlEl.style.height = 'auto';
      body.style.height = 'auto';
      body.style.minHeight = '0';
      // Measure content only (not the iframe viewport)
      let h = 0;
      const kids = body.children;
      if (kids.length) {
        const last = kids[kids.length - 1] as HTMLElement;
        const top = (kids[0] as HTMLElement).offsetTop || 0;
        h = last.offsetTop + last.offsetHeight - top;
      }
      h = Math.max(
        h,
        body.scrollHeight,
        htmlEl.scrollHeight,
      );
      // body padding ~20+28
      h = Math.ceil(h + 8);
      h = Math.min(Math.max(h, 200), 30000);
      // Only grow/shrink when change is real (prevents endless blank pages)
      if (Math.abs(h - lastH.current) < 12) return;
      lastH.current = h;
      setHeight(h);
    } catch { /* */ }
  };

  useEffect(() => {
    setConfirmOpen(false);
    lastH.current = 0;
    setHeight(400);
    if (getMailRemoteImagesPref()) setLoadRemote(true);
  }, [html]);

  // NO setInterval — that was expanding white space forever while scrolling

  const onFrameLoad = () => {
    lastH.current = 0;
    resize();
    // Second measure after layout/fonts
    requestAnimationFrame(() => resize());
    window.setTimeout(resize, 100);
    window.setTimeout(resize, 400);
    try {
      const doc2 = ref.current?.contentDocument;
      if (!doc2) return;
      doc2.querySelectorAll('img').forEach((img) => {
        if (img.complete) return;
        img.addEventListener('load', () => resize(), { once: true });
        img.addEventListener('error', () => resize(), { once: true });
      });
    } catch { /* */ }
  };

  const confirmLoadImages = () => {
    setMailRemoteImagesPref(true);
    setLoadRemote(true);
    setConfirmOpen(false);
  };

  return (
    <div className="mailbox-html-body">
      {hasRemote && !loadRemote && (
        <div className="mailbox-images-banner">
          {!confirmOpen ? (
            <button
              type="button"
              className="secondary"
              style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => setConfirmOpen(true)}
            >
              Afficher les images
            </button>
          ) : (
            <div className="mailbox-images-confirm">
              <p>
                Charger les images distantes peut contacter les serveurs de l’expéditeur
                (suivi / pixels) et augmenter le trafic stocké. Cela peut affecter la
                confidentialité. Continuer&nbsp;?
              </p>
              <div className="mailbox-images-confirm-actions">
                <button type="button" className="secondary" onClick={() => setConfirmOpen(false)}>
                  Annuler
                </button>
                <button type="button" onClick={confirmLoadImages}>
                  Oui, charger une fois pour toutes
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <iframe
        ref={ref}
        title="Contenu du message"
        srcDoc={doc}
        onLoad={onFrameLoad}
        sandbox="allow-same-origin"
        scrolling="no"
        referrerPolicy="no-referrer"
        style={{
          width: '100%',
          height,
          border: 'none',
          borderRadius: 8,
          background: '#fff',
          display: 'block',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}

function MailIcon({ d, title }: { d: string; title?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', width: 20, height: 20, flexShrink: 0 }}
    >
      <path fill="#0f172a" d={d} />
    </svg>
  );
}
function IconBack() {
  return <MailIcon d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />;
}
function IconArchive() {
  return <MailIcon d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17l-5-5h3V9h4v3h3l-5 5z" />;
}
function IconTrash() {
  return <MailIcon d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />;
}
function IconSpam() {
  return <MailIcon d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V9h2v3z" />;
}
function IconTranslate() {
  return <MailIcon d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />;
}
function IconMore() {
  return <MailIcon d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />;
}

export default function Mailbox() {
  const { alert } = useUi();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCompose = /\/mailbox\/compose\/?$/.test(location.pathname);
  const routeMatch = location.pathname.match(/\/mailbox\/m\/(\d+)/);
  const routeId = routeMatch ? Number(routeMatch[1]) : null;
  const [list, setList] = useState<MailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  type MailFolder = 'inbox' | 'sent' | 'spam' | 'archived' | 'all';
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [statusFilter, setStatusFilter] = useState('');

  const folderFilters = (f: MailFolder): { direction: '' | 'in' | 'out'; status: string } => {
    // status '' → server hides spam & archived
    // status 'all' was wrong (included spam/archived)
    if (f === 'inbox') return { direction: 'in', status: '' }; // received only
    if (f === 'sent') return { direction: 'out', status: '' }; // sent only
    if (f === 'spam') return { direction: '', status: 'spam' };
    if (f === 'archived') return { direction: '', status: 'archived' };
    if (f === 'all') return { direction: '', status: '' }; // all except spam & archived
    return { direction: 'in', status: '' };
  };

  const folderFromUrl = (): MailFolder => {
    const raw = (searchParams.get('folder') || 'inbox').toLowerCase();
    const allowed: MailFolder[] = ['inbox', 'sent', 'spam', 'archived', 'all'];
    return (allowed.includes(raw as MailFolder) ? raw : 'inbox') as MailFolder;
  };

  const applyFolder = (f: MailFolder, opts?: { navigate?: boolean }) => {
    const filters = folderFilters(f);
    setFolder(f);
    setPage(0);
    setDirection(filters.direction);
    setStatusFilter(filters.status);
    setSelectedId(null);
    setSelected(null);
    setList([]); // clear stale rows immediately when switching tabs
    if (opts?.navigate !== false) {
      navigate(f === 'inbox' ? '/mailbox' : `/mailbox?folder=${f}`, { replace: true });
    }
  };

  // URL is source of truth for folder tabs
  useEffect(() => {
    const f = folderFromUrl();
    if (f !== folder) {
      applyFolder(f, { navigate: false });
      setPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [search, setSearch] = useState('');
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<MailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [sending, setSending] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  useEffect(() => {
    if (isCompose) setComposeOpen(true);
  }, [isCompose]);
  useEffect(() => {
    const open = () => setComposeOpen(true);
    window.addEventListener('atlas-mailbox-compose', open);
    return () => window.removeEventListener('atlas-mailbox-compose', open);
  }, []);
  // Lock body scroll while compose is open (no list jump / refresh feel)
  useEffect(() => {
    if (!composeOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [composeOpen]);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [translateBusy, setTranslateBusy] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translateEngine, setTranslateEngine] = useState('');
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.mailbox-more-menu, .mailbox-more-trigger')) return;
      setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAtt, setPreviewAtt] = useState<AttMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewGoogle, setPreviewGoogle] = useState<string | null>(null);
  const [previewSlides, setPreviewSlides] = useState<OfficeSlide[] | null>(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  useEffect(() => {
    const to = searchParams.get('to') || '';
    const client = searchParams.get('client') || '';
    if (to) setComposeTo(to);
    if (client && !composeSubject) setComposeSubject(`AF Marbre — ${client}`);
  }, [searchParams]);

  // Deep-link open — do not clear selection when opening/closing compose overlay
  useEffect(() => {
    if (routeId && !Number.isNaN(routeId)) {
      if (selectedId !== routeId) openMessage(routeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const load = (soft = false, pageOverride?: number, folderOverride?: MailFolder) => {
    if (soft) setRefreshing(true); else setLoading(true);
    const pageIdx = pageOverride != null ? pageOverride : page;
    const f = folderOverride || folderFromUrl();
    const filters = folderFilters(f);
    if (!soft) setList([]); // hard load: drop previous page immediately
    api.mailboxList({
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        q: search || undefined,
        limit: PAGE_SIZE,
        offset: pageIdx * PAGE_SIZE,
      })
      .then((r: any) => {
        // Ignore stale responses if user switched folder mid-flight
        if (folderFromUrl() !== f) return;
        const rows = (r.data || []) as MailRow[];
        rows.sort((a, b) => {
          const ta = Date.parse(String(a.created_at || '').replace(' ', 'T')) || 0;
          const tb = Date.parse(String(b.created_at || '').replace(' ', 'T')) || 0;
          if (tb !== ta) return tb - ta;
          return Number(b.id) - Number(a.id);
        });
        setList(rows);
        setTotalCount(Number(r?.meta?.total ?? rows.length));
      })
      .catch((e: any) => flash(e?.message || 'Erreur de chargement', 'error'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => {
    const f = folderFromUrl();
    setFolder(f);
    const filters = folderFilters(f);
    setDirection(filters.direction);
    setStatusFilter(filters.status);
    setList([]); // never keep previous page rows
    load(false, page, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('folder'), page]);

  useEffect(() => {
    const onRefresh = () => { load(true, undefined, folderFromUrl()); };
    const onSync = () => { void syncResend(); };
    window.addEventListener('atlas-mailbox-refresh', onRefresh);
    window.addEventListener('atlas-mailbox-sync', onSync);
    return () => {
      window.removeEventListener('atlas-mailbox-refresh', onRefresh);
      window.removeEventListener('atlas-mailbox-sync', onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      load(true, 0, folderFromUrl());
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openMessage = (id: number) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setReplyOpen(false); setReplyFiles([]);
    setTranslatedText(null);
    setTranslateEngine('');
    setSummaryText(null);
    setMoreOpen(false);
    api.mailboxGet(id)
      .then(async (r: any) => {
        setSelected(r.data);
        // Mark inbound as read (Gmail-style)
        if (r?.data?.direction === 'in' && r?.data?.status !== 'read' && r?.data?.status !== 'spam') {
          try {
            await api.mailboxSetStatus(id, 'read');
            load(true);
          } catch { /* non-blocking */ }
        }
      })
      .catch((e: any) => flash(e?.message || 'Erreur de chargement', 'error'))
      .finally(() => setLoadingDetail(false));
  };

  const thread = useMemo(() => {
    if (!selected) return [];
    if (!selected.thread_key) return [selected as MailRow];
    return list.filter((m) => m.thread_key === selected.thread_key).sort((a, b) => a.id - b.id);
  }, [selected, list]);

  const startReply = () => {
    if (!selected) return;
    const counterpart = selected.direction === 'in' ? selected.from_addr : selected.to_addr;
    setReplyTo(counterpart);
    setReplySubject(selected.subject?.toLowerCase().startsWith('re:') ? selected.subject : `Re: ${selected.subject || ''}`);
    setReplyText('');
    setReplyOpen(true);
  };

  const sendReply = async () => {
    if (!selected || !replyTo.includes('@') || !replySubject.trim()) {
      flash('Destinataire et sujet requis', 'error');
      return;
    }
    for (const f of replyFiles) {
      if (f.size > 25 * 1024 * 1024) {
        flash(`Fichier trop volumineux: ${f.name} (max 25 Mo)`, 'error');
        return;
      }
    }
    setSending(true);
    try {
      const attachments = [];
      for (const f of replyFiles) {
        const content_base64 = await fileToBase64(f);
        attachments.push({ filename: f.name, mimeType: f.type || 'application/octet-stream', content_base64 });
      }
      await api.mailboxSend({
        to: replyTo,
        subject: replySubject,
        text: replyText,
        reply_to_id: selected.id,
        attachments: attachments.length ? attachments : undefined,
      });
      flash(attachments.length ? `Message envoyé avec ${attachments.length} pièce(s) jointe(s).` : 'Message envoyé.');
      setReplyOpen(false);
      setReplyText('');
      setReplyFiles([]);
      load(true);
      if (selectedId) openMessage(selectedId);
    } catch (e: any) {
      flash(e?.message || 'Échec de l\'envoi', 'error');
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: number) => {
    try {
      await api.mailboxDelete(id);
      flash('Message supprimé.');
      if (selectedId === id) {
        setSelectedId(null);
        setSelected(null);
        navigate('/mailbox');
      }
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Échec de la suppression', 'error');
    }
  };

  const syncResend = async () => {
    setSyncing(true);
    try {
      const r: any = await api.mailboxSyncResend(150);
      flash(r.message || 'Synchronisation terminée.');
      load(true);
    } catch (e: any) {
      const msg = e?.message || '';
      if (String(msg).includes('EMAIL_NOT_CONFIGURED') || String(msg).toLowerCase().includes('resend_api_key') || String(msg).toLowerCase().includes('clé api')) {
        await alert('La synchronisation e-mail n\'est pas configurée sur le serveur (secret API manquant).', 'E-mail non configuré');
      } else if (/404|not found|introuvable/i.test(String(msg))) {
        flash('Synchronisation indisponible — redéployez le Worker (route sync manquante).', 'error');
      } else {
        flash(msg || 'Échec de la synchronisation', 'error');
      }
    } finally {
      setSyncing(false);
    }
  };


  const closeAttachmentPreview = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewUrl); } catch { /* */ }
    }
    setPreviewAtt(null);
    setPreviewUrl(null);
    setPreviewGoogle(null);
    setPreviewSlides(null);
    setPreviewSlideIdx(0);
    setPreviewError('');
    setPreviewLoading(false);
  };

  const openAttachmentPreview = async (a: AttMeta) => {
    // Revoke previous blob without clearing the modal flash
    setPreviewUrl((prev) => {
      if (prev && prev.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev); } catch { /* */ }
      }
      return null;
    });
    setPreviewGoogle(null);
    setPreviewSlides(null);
    setPreviewSlideIdx(0);
    setPreviewError('');
    setPreviewAtt(a);
    setPreviewLoading(true);
    const kind = attKind(a);
    try {
      if (kind === 'office') {
        // Local in-browser preview (Google Docs Viewer is unreliable for PPTX)
        const { blob } = await api.mailboxFetchAttachmentBlob(a.r2_key, a.filename);
        if (!blob || blob.size === 0) {
          setPreviewError('Fichier vide ou illisible.');
        } else {
          const slides = await buildOfficePreview(blob, a.filename || '');
          if (slides && slides.length) {
            setPreviewSlides(slides);
            setPreviewSlideIdx(0);
          } else {
            setPreviewError('Aperçu local impossible pour ce format. Utilisez Télécharger.');
          }
        }
      } else if (kind === 'other') {
        const name = (a.filename || '').toLowerCase();
        if (/\.(docx|pptx|xlsx)$/i.test(name)) {
          const { blob } = await api.mailboxFetchAttachmentBlob(a.r2_key, a.filename);
          const slides = blob ? await buildOfficePreview(blob, a.filename || '') : null;
          if (slides?.length) {
            setPreviewSlides(slides);
            setPreviewSlideIdx(0);
          } else {
            setPreviewError('Aperçu non disponible. Utilisez Télécharger.');
          }
        } else {
          setPreviewError('Aperçu non disponible pour ce type de fichier. Utilisez Télécharger.');
        }
      } else {
        const { blob, contentType } = await api.mailboxFetchAttachmentBlob(a.r2_key, a.filename);
        if (!blob || blob.size === 0) {
          setPreviewError('Fichier vide ou illisible.');
        } else {
          const typed =
            contentType && contentType !== 'application/octet-stream'
              ? contentType
              : (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : mimeFromName(a.filename, contentType || blob.type || 'application/octet-stream'));
          const fixed = blob.type === typed ? blob : blob.slice(0, blob.size, typed);
          const url = URL.createObjectURL(fixed);
          setPreviewUrl(url);
        }
      }
    } catch (e: any) {
      setPreviewError(e?.message || 'Impossible de prévisualiser');
    } finally {
      setPreviewLoading(false);
    }
  };


  const backToList = () => {
    setSelectedId(null);
    setSelected(null);
    setReplyOpen(false);
    setReplyFiles([]);
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
    setComposeFiles([]);
    navigate('/mailbox');
  };

  const selectMessage = (id: number) => {
    if (selectedId !== id) openMessage(id);
    const dest = `/mailbox`;
    if (location.pathname !== dest) navigate(dest);
  };

  const sendCompose = async () => {
    if (!composeTo.includes('@') || !composeSubject.trim()) {
      flash('Destinataire et sujet requis', 'error');
      return;
    }
    for (const f of composeFiles) {
      if (f.size > 25 * 1024 * 1024) {
        flash(`Fichier trop volumineux: ${f.name} (max 25 Mo)`, 'error');
        return;
      }
    }
    setSending(true);
    try {
      const attachmentsOut: { filename: string; mimeType: string; content_base64: string }[] = [];
      for (const f of composeFiles) {
        const content_base64 = await fileToBase64(f);
        attachmentsOut.push({ filename: f.name, mimeType: f.type || 'application/octet-stream', content_base64 });
      }
      await api.mailboxSend({
        to: composeTo,
        subject: composeSubject,
        text: composeBody,
        attachments: attachmentsOut.length ? attachmentsOut : undefined,
      });
      flash(attachmentsOut.length ? `Message envoyé avec ${attachmentsOut.length} pièce(s) jointe(s).` : 'Message envoyé.');
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setComposeFiles([]);
      load(true);
      navigate('/mailbox');
    } catch (e: any) {
      flash(e?.message || 'Échec de l\'envoi', 'error');
    } finally {
      setSending(false);
    }
  };

  const runAiDraft = async (mode: 'compose' | 'reply') => {
    setAiBusy(true);
    try {
      const context =
        mode === 'reply'
          ? (selected?.body_text || htmlToPlainText(selected?.body_html || '') || '')
          : composeBody;
      const r: any = await api.mailboxAiDraft({
        instruction:
          aiInstruction ||
          (mode === 'reply'
            ? 'Rédige une réponse professionnelle, claire et concise en français.'
            : 'Rédige un email professionnel, clair et concis en français.'),
        mode,
        context,
        lang: 'fr',
      });
      const body = r?.data?.body || '';
      const subject = r?.data?.subject;
      if (mode === 'reply') {
        if (body) setReplyText(body);
        if (subject) setReplySubject(subject);
      } else {
        if (body) setComposeBody(body);
        if (subject) setComposeSubject(subject);
      }
      flash('Brouillon IA généré.');
    } catch (e: any) {
      flash(e?.message || 'IA indisponible', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const translateSelected = async (target = 'fr') => {
    if (!selected) return;
    setTranslateBusy(true);
    setTranslatedText(null);
    try {
      const text = selected.body_text || htmlToPlainText(selected.body_html || '');
      if (!text.trim()) {
        flash('Rien à traduire.', 'error');
        return;
      }
      const r: any = await api.mailboxTranslate({ text, target });
      const translated = r?.data?.text || '';
      const engine = r?.data?.engine || '';
      if (!translated) throw new Error('Traduction vide');
      if (/MYMEMORY WARNING|YOU USED ALL AVAILABLE/i.test(translated)) {
        throw new Error('Quota de traduction dépassé. Réessayez plus tard.');
      }
      setTranslatedText(translated);
      setTranslateEngine(engine);
      flash(engine === 'google' ? 'Traduit avec Google Translate.' : 'Message traduit.');
    } catch (e: any) {
      const msg = e?.message || 'Traduction impossible';
      flash(
        /NO_AI_KEY|non configurée|GROQ/i.test(msg)
          ? 'Configurez GROQ_API_KEY (secret Worker) pour la traduction IA.'
          : msg,
        'error',
      );
    } finally {
      setTranslateBusy(false);
    }
  };

  const summarizeSelected = async () => {
    if (!selected) return;
    setSummaryBusy(true);
    setSummaryText(null);
    const text = selected.body_text || htmlToPlainText(selected.body_html || '');
    const subject = selected.subject || '';
    const extractive = () => {
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const pick = lines.slice(0, 5).join(' ');
      return (subject ? '• Sujet : ' + subject + '\n' : '') + '• ' + pick.slice(0, 600);
    };
    try {
      if (!text.trim()) {
        flash('Rien à résumer.', 'error');
        return;
      }
      try {
        const r: any = await api.mailboxSummarize({ text, subject, lang: 'fr' });
        const summary = r?.data?.summary || '';
        if (summary) {
          setSummaryText(summary);
          flash('Résumé généré.');
          return;
        }
      } catch {
        /* use local extractive */
      }
      setSummaryText(extractive());
      flash('Résumé (aperçu local).');
    } catch (e: any) {
      setSummaryText(extractive());
      flash(e?.message || 'Résumé local affiché', 'error');
    } finally {
      setSummaryBusy(false);
    }
  };

  const markUnread = async () => {
    if (!selected) return;
    try {
      await api.mailboxSetStatus(selected.id, 'unread');
      flash('Marqué comme non lu.');
      setMoreOpen(false);
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Action impossible', 'error');
    }
  };

  const markSpam = async () => {
    if (!selected) return;
    try {
      await api.mailboxSetStatus(selected.id, 'spam');
      flash('Déplacé vers les spams.');
      setMoreOpen(false);
      backToList();
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Action impossible', 'error');
    }
  };

  const markArchive = async () => {
    if (!selected) return;
    try {
      await api.mailboxSetStatus(selected.id, 'archived');
      flash('Message archivé.');
      setMoreOpen(false);
      backToList();
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Action impossible', 'error');
    }
  };

  const markInbox = async () => {
    if (!selected) return;
    try {
      await api.mailboxSetStatus(selected.id, 'read');
      flash('Déplacé vers la boîte de réception.');
      setMoreOpen(false);
      backToList();
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Action impossible', 'error');
    }
  };

  /**
   * Multi-signal spam heuristics (Gmail-style: content + sender + pattern),
   * not a single keyword blacklist.
   */
  const spamHints = (m: MailRow): string[] => {
    const hints: string[] = [];
    const subj = String(m.subject || '');
    const prev = String(m.preview || '');
    const from = String(m.from_addr || '');
    const blob = `${subj} ${prev} ${from}`.toLowerCase();
    let score = 0;

    // Content / social-engineering patterns
    if (/\b(viagra|cialis|crypto\s*giveaway|you have won|claim your prize|lottery winner|nigerian?\s*prince)\b/i.test(blob)) {
      score += 3;
      hints.push('arnaque connue');
    }
    if (/\b(verify your account|password (will )?expire|suspend(ed)? account|confirm your identity|unusual activity)\b/i.test(blob)) {
      score += 2;
      hints.push('phishing compte');
    }
    if (/\b(urgent|agir maintenant|immediate action|within 24 hours)\b/i.test(blob) && /\b(http|www\.|bit\.ly|t\.co|\$|usd|btc|wallet)\b/i.test(blob)) {
      score += 2;
      hints.push('urgence + lien');
    }
    // Link / shortener density in preview
    const linkHits = (blob.match(/https?:\/\/|www\.|bit\.ly|tinyurl/g) || []).length;
    if (linkHits >= 3) {
      score += 1;
      hints.push('liens multiples');
    }
    // Sender identity risk (free disposable / risky TLD)
    const domain = (from.split('@')[1] || '').replace(/>.*/, '').trim().toLowerCase();
    if (domain && /\.(ru|tk|ml|ga|cf|gq|top|xyz|click|loan)\s*$/i.test(domain)) {
      score += 2;
      hints.push('domaine à risque');
    }
    // Display name spoofing common brands
    if (/\b(paypal|apple id|microsoft|google security|amazon prime)\b/i.test(subj) && domain && !/(paypal|apple|microsoft|google|amazon)\./i.test(domain)) {
      score += 3;
      hints.push('usurpation expéditeur');
    }
    // ALL CAPS subject
    if (subj.length > 12 && subj === subj.toUpperCase() && /[A-Z]/.test(subj)) {
      score += 1;
      hints.push('sujet majuscules');
    }

    if (score >= 3) return hints.slice(0, 3);
    if (score >= 2) return hints.slice(0, 2);
    return [];
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeFiles([]);
    // Stay on current folder — only leave /compose path without full reload
    if (isCompose) {
      try {
        const folder = searchParams.get('folder');
        navigate(folder && folder !== 'inbox' ? `/mailbox?folder=${folder}` : '/mailbox', { replace: true });
      } catch { /* */ }
    }
  };

  const startForward = () => {
    if (!selected) return;
    const body =
      `\n\n---------- Message transféré ----------\n` +
      `De : ${selected.from_addr}\n` +
      `Date : ${selected.created_at}\n` +
      `Sujet : ${selected.subject || ''}\n\n` +
      (selected.body_text || htmlToPlainText(selected.body_html || ''));
    setComposeTo('');
    setComposeSubject(selected.subject?.toLowerCase().startsWith('fwd:') ? selected.subject : `Fwd: ${selected.subject || ''}`);
    setComposeBody(body);
    setMoreOpen(false);
    setComposeOpen(true);
  };

  const printSelected = () => {
    if (!selected) return;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      flash('Autorisez les pop-ups pour imprimer.', 'error');
      return;
    }
    const body = selected.body_html || `<pre style="white-space:pre-wrap;font-family:inherit">${(selected.body_text || '').replace(/</g, '&lt;')}</pre>`;
    w.document.write(`<!DOCTYPE html><html><head><title>${(selected.subject || 'Message').replace(/</g, '')}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}
      .meta{color:#555;font-size:13px;margin-bottom:16px}</style></head><body>
      <h1 style="font-size:20px">${(selected.subject || '(sans objet)').replace(/</g, '')}</h1>
      <div class="meta">De : ${selected.from_addr}<br/>À : ${selected.to_addr}<br/>${fmtDate(selected.created_at)}</div>
      ${body}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* */ } }, 300);
    setMoreOpen(false);
  };

  const copySignedLink = async () => {
    if (!selected) return;
    try {
      const r: any = await api.mailboxSignedLink(selected.id);
      const url = r?.data?.url || '';
      if (!url) throw new Error('Lien indisponible');
      await navigator.clipboard.writeText(url);
      flash('Lien sécurisé copié.');
      setMoreOpen(false);
    } catch (e: any) {
      flash(e?.message || 'Impossible de copier le lien', 'error');
    }
  };

    const attachments = parseAttachments(selected?.meta_json);
  const hasHtml = !!selected?.body_html?.trim();

  return (
    <>
    <div className="mailbox-page atlas-crm">
      <div className="page-header mailbox-page-header" hidden>
        <h1 className="mailbox-page-title-sr">Messagerie</h1>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="mailbox-shell">
      <nav className="settings-nav mailbox-folders mailbox-folders--legacy" aria-label="Dossiers" hidden>
        <div className="settings-nav-group">
          <div className="settings-nav-group-label">Dossiers</div>
          {(
            [
              {
                id: 'inbox' as const,
                label: 'Boîte de réception',
                to: '/mailbox',
                icon: 'M4 6h16v12H4z M4 8l8 5 8-5',
              },
              {
                id: 'sent' as const,
                label: 'Envoyés',
                to: '/mailbox?folder=sent',
                icon: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
              },
              {
                id: 'spam' as const,
                label: 'Spam',
                to: '/mailbox?folder=spam',
                icon: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h16.9a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
              },
              {
                id: 'archived' as const,
                label: 'Archives',
                to: '/mailbox?folder=archived',
                icon: 'M3 7h18v3H3z M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9 M10 14h4',
              },
              {
                id: 'all' as const,
                label: 'Tous',
                to: '/mailbox?folder=all',
                icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
              },
            ] as const
          ).map((f) => (
            <Link
              key={f.id}
              to={f.to}
              className={folder === f.id ? 'settings-nav-item active' : 'settings-nav-item'}
              onClick={() => applyFolder(f.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={f.icon} />
              </svg>
              <span>{f.label}</span>
            </Link>
          ))}
        </div>
      </nav>
      <div className="mailbox-main">
      <div className="card mailbox-toolbar-card" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <div className="mailbox-toolbar">
          <div className="search-bar mailbox-toolbar-search">
            <input
              className="search-input"
              placeholder="Recherche : texte, from:, to:, subject:, has:attachment…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mailbox-toolbar-right">
            <ListPager
              page={page}
              pageSize={PAGE_SIZE}
              total={totalCount}
              onPageChange={setPage}
              pageBase={0}
              loading={loading}
              className="mailbox-pager"
            />
          </div>
        </div>
      </div>

      <div
        className={`card mailbox-split${
          selectedId && !isCompose ? ' is-reading' : ' is-inbox'
        }`}
      >
        <div className="mailbox-list">
          {loading ? (
            <div className="empty" style={{ padding: 20 }}>Chargement...</div>
          ) : !list.length ? (
            <div className="mailbox-list-empty">
              <EmptyState
                icon="inbox"
                title="Aucun message"
                description="Les emails envoyés depuis les factures et ceux reçus sur le domaine apparaîtront ici."
              />
            </div>
          ) : (
            list.map((m) => {
              const who = m.direction === 'in' ? (m.from_addr || '') : (m.to_addr || '');
              const whoShort = who.replace(/<.*>/, '').trim() || who;
              const snippet = (m.preview || '').replace(/\s+/g, ' ').trim();
              const hasPj =
                m.has_attachments === 1 ||
                m.has_attachments === true ||
                parseAttachments(m.meta_json).length > 0;
              const unread = m.status === 'unread' || (m.direction === 'in' && m.status === 'received');
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectMessage(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectMessage(m.id);
                    }
                  }}
                  className={`mailbox-item${selectedId === m.id && !isCompose ? ' is-active' : ''}${
                    unread ? ' is-unread' : ''
                  }`}
                >
                  <div className="mailbox-item-main">
                    <span className="mailbox-item-from" title={who}>
                      {whoShort}
                    </span>
                    <span className="mailbox-item-line" title={`${m.subject || ''} ${snippet}`}>
                      <span className="mailbox-item-subject">{m.subject || '(sans objet)'}</span>
                      {snippet ? <span className="mailbox-item-snippet"> — {snippet}</span> : null}
                    </span>
                    <span className="mailbox-item-date">{fmtDate(m.created_at)}</span>
                  </div>
                  {(hasPj || m.status === 'unmatched' || m.status === 'spam' || spamHints(m).length > 0) && (
                    <div className="mailbox-item-meta">
                      {hasPj && (
                        <span
                          className="badge"
                          style={{ fontSize: 10, background: 'rgba(15,118,110,0.12)', color: '#8b9cff' }}
                          title="Pièces jointes"
                        >
                          📎
                        </span>
                      )}
                      {m.status === 'unmatched' && (
                        <span className="badge warn" style={{ fontSize: 10 }}>
                          Non rattaché
                        </span>
                      )}
                      {m.status === 'spam' && (
                        <span className="badge warn" style={{ fontSize: 10 }}>
                          Spam
                        </span>
                      )}
                      {m.status !== 'spam' && spamHints(m).length > 0 && (
                        <span className="badge warn" style={{ fontSize: 10 }} title={spamHints(m).join(', ')}>
                          Suspect
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {(!isCompose && selectedId) && (
          <div className="mailbox-pane mailbox-reader">
            {loadingDetail ? (
              <div className="empty">Chargement du message...</div>
            ) : selected ? (
              <div className="mailbox-reader-inner">
                <div className="mailbox-topbar">
                  <div className="mailbox-topbar-left">
                    <button type="button" className="icon-refresh-btn secondary" title="Retour à la boîte de réception" aria-label="Retour" onClick={backToList} hidden>
                      <IconBack />
                    </button>
                    <button type="button" className="icon-refresh-btn secondary" title="Archiver" aria-label="Archiver" onClick={markArchive}>
                      <IconArchive />
                    </button>
                    <button
                      type="button"
                      className="icon-refresh-btn secondary"
                      title="Supprimer"
                      aria-label="Supprimer"
                      onClick={() => deleteMessage(selected.id)}
                    >
                      <IconTrash />
                    </button>
                    <button type="button" className="icon-refresh-btn secondary" title="Signaler comme spam" aria-label="Spam" onClick={markSpam}>
                      <IconSpam />
                    </button>
                  </div>
                  <div className="mailbox-topbar-right" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="icon-refresh-btn secondary"
                      disabled={translateBusy}
                      title="Traduire"
                      aria-label="Traduire"
                      onClick={() => translateSelected('fr')}
                    >
                      <IconTranslate />
                    </button>
                    <InlineDisclosureMenu
                      open={moreOpen}
                      onOpenChange={setMoreOpen}
                      title="Plus d’options"
                      align="right"
                      showDelete
                      deleteLabel="Supprimer"
                      onDelete={() => { void deleteMessage(selected.id); }}
                      items={[
                        {
                          id: 'unread',
                          label: 'Marquer comme non lu',
                          icon: <MailWarning size={18} />,
                          onClick: () => markUnread(),
                        },
                        ...(selected.status === 'spam' || selected.status === 'archived'
                          ? [{
                              id: 'inbox',
                              label: 'Boîte de réception',
                              icon: <Inbox size={18} />,
                              onClick: () => markInbox(),
                            }]
                          : [
                              {
                                id: 'spam',
                                label: 'Signaler comme spam',
                                icon: <MailWarning size={18} />,
                                onClick: () => markSpam(),
                              },
                              {
                                id: 'archive',
                                label: 'Archiver',
                                icon: <Archive size={18} />,
                                onClick: () => markArchive(),
                              },
                            ]),
                        {
                          id: 'print',
                          label: 'Imprimer',
                          icon: <Printer size={18} />,
                          onClick: () => printSelected(),
                        },
                        {
                          id: 'link',
                          label: 'Copier le lien',
                          icon: <Link2 size={18} />,
                          onClick: () => copySignedLink(),
                        },
                        {
                          id: 'summary',
                          label: summaryBusy ? 'Résumé…' : 'Résumer cet e-mail',
                          icon: <FileText size={18} />,
                          disabled: summaryBusy,
                          onClick: () => { void summarizeSelected(); },
                        },
                      ]}
                    />
                  </div>
                </div>

                <div className="mailbox-reader-scroll">
                  <h2 className="mailbox-reader-subject">{selected.subject || '(sans objet)'}</h2>

                  {summaryText && (
                    <div className="mailbox-summary-card">
                      <div className="mailbox-summary-title">Résumé</div>
                      <pre className="mailbox-summary-body">{summaryText}</pre>
                      <button type="button" className="ghost" style={{ fontSize: 12 }} onClick={() => setSummaryText(null)}>
                        Masquer
                      </button>
                    </div>
                  )}

                  {translatedText && (
                    <div className="mailbox-translate-card">
                      <div className="mailbox-summary-title">
                        Traduction{' '}
                        {translateEngine
                          ? `(${translateEngine === 'google' ? 'Google Translate' : translateEngine})`
                          : ''}
                      </div>
                      <pre className="mailbox-summary-body">{translatedText}</pre>
                      <button type="button" className="ghost" style={{ fontSize: 12 }} onClick={() => setTranslatedText(null)}>
                        Masquer
                      </button>
                    </div>
                  )}

                  <div className="mailbox-thread">
                    {thread.map((m) => {
                      const isFull = m.id === selected.id;
                      const atts = isFull ? attachments : [];
                      const hints = spamHints(m);
                      return (
                        <div key={m.id} className={`mailbox-msg-card${m.status === 'spam' ? ' is-spam' : ''}`}>
                          <div className="mailbox-msg-meta">
                            <span>
                              <span
                                className={`badge ${m.direction === 'in' ? 'info' : 'success'}`}
                                style={{ fontSize: 10, marginRight: 8 }}
                              >
                                {m.direction === 'in' ? 'Reçu' : 'Envoyé'}
                              </span>
                              {m.direction === 'in' ? m.from_addr : `À : ${m.to_addr}`}
                              {m.status === 'spam' && (
                                <span className="badge warn" style={{ fontSize: 10, marginLeft: 8 }}>
                                  Spam
                                </span>
                              )}
                              {hints.map((h) => (
                                <span key={h} className="badge warn" style={{ fontSize: 10, marginLeft: 6 }}>
                                  {h}
                                </span>
                              ))}
                            </span>
                            <span>{fmtDate(m.created_at)}</span>
                          </div>
                          <div className="mailbox-msg-body">
                            {isFull && hasHtml ? (
                              <HtmlMailBody html={selected.body_html!} attachments={attachments} />
                            ) : isFull && selected.body_text ? (
                              <pre className="mailbox-msg-pre">{selected.body_text}</pre>
                            ) : (
                              <pre className="mailbox-msg-pre" style={{ color: m.preview ? undefined : 'var(--muted)' }}>
                                {m.preview || '(pas de contenu)'}
                              </pre>
                            )}
                          </div>
                          {!!atts.length && (
                            <div className="mailbox-msg-atts">
                              <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--muted)', marginBottom: 8 }}>
                                Pièces jointes ({atts.length})
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {atts.map((a, i) => {
                                  const kind = attKind(a);
                                  return (
                                    <div key={i} className="mailbox-att-chip">
                                      <span>{attIcon(kind)}</span>
                                      <button
                                        type="button"
                                        className="ghost"
                                        style={{ padding: '2px 4px', minHeight: 0, fontWeight: 600 }}
                                        onClick={() => openAttachmentPreview(a)}
                                      >
                                        {a.filename}
                                        {a.size ? ` (${fmtSize(a.size)})` : ''}
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary"
                                        style={{ padding: '4px 8px', fontSize: 12, minHeight: 0 }}
                                        onClick={() =>
                                          api
                                            .mailboxDownloadAttachment(a.r2_key, a.filename)
                                            .catch((e: any) => flash(e?.message || 'Téléchargement échoué', 'error'))
                                        }
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="mailbox-msg-actions">
                            <button type="button" className="secondary" onClick={() => { if (m.id !== selected.id) selectMessage(m.id); setTimeout(() => startReply(), 0); }}>
                              Répondre
                            </button>
                            <button type="button" className="secondary" onClick={() => { if (m.id !== selected.id) selectMessage(m.id); setTimeout(() => startForward(), 0); }}>
                              Transférer
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {replyOpen && (
                  <div style={{ marginTop: 20, padding: '8px 0 24px' }}>
                    <ComposeEmailCard
                      title={replySubject.startsWith('Tr:') || replySubject.startsWith('Fwd:') ? 'Transférer' : 'Répondre'}
                      to={replyTo}
                      subject={replySubject}
                      body={replyText}
                      files={replyFiles}
                      aiInstruction={aiInstruction}
                      sending={sending}
                      aiBusy={aiBusy}
                      onToChange={setReplyTo}
                      onSubjectChange={setReplySubject}
                      onBodyChange={setReplyText}
                      onAiInstructionChange={setAiInstruction}
                      onAddFiles={(fs) => setReplyFiles((prev) => [...prev, ...fs].slice(0, 5))}
                      onRemoveFile={(i) => setReplyFiles((prev) => prev.filter((_, j) => j !== i))}
                      onAiDraft={() => void runAiDraft('reply')}
                      onSend={() => void sendReply()}
                      onClose={() => { setReplyOpen(false); setReplyFiles([]); }}
                      quickReplies={QUICK_REPLIES.map((q) => ({ label: q.label, text: q.body }))}
                    />
                  </div>
                )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      </div>{/* mailbox-main */}
      </div>{/* mailbox-shell */}

      {previewAtt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu pièce jointe"
          onClick={closeAttachmentPreview}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10040,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(960px, 96vw)',
              maxHeight: '92vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
              <strong style={{ flex: 1, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {attIcon(attKind(previewAtt))} {previewAtt.filename}
              </strong>
              <button
                type="button"
                className="secondary"
                style={{ padding: '6px 10px', fontSize: 12 }}
                onClick={() => api.mailboxDownloadAttachment(previewAtt.r2_key, previewAtt.filename).catch((e: any) => flash(e?.message || 'Téléchargement échoué', 'error'))}
              >
                Télécharger
              </button>
              <button type="button" className="ghost" style={{ padding: '6px 10px' }} onClick={closeAttachmentPreview}>Fermer</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', minHeight: 280, background: '#0f172a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
              {previewLoading && <div className="empty">Chargement de l’aperçu…</div>}
              {!previewLoading && previewError && (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <p style={{ color: 'var(--muted)' }}>{previewError}</p>
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 12 }}
                    onClick={() => api.mailboxDownloadAttachment(previewAtt.r2_key, previewAtt.filename).catch((e: any) => flash(e?.message || 'Échec', 'error'))}
                  >
                    Télécharger le fichier
                  </button>
                </div>
              )}
              {!previewLoading && !previewError && previewAtt && attKind(previewAtt) === 'image' && previewUrl && (
                <img key={previewUrl} src={previewUrl} alt={previewAtt.filename} style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }} />
              )}
              {!previewLoading && !previewError && previewAtt && attKind(previewAtt) === 'pdf' && previewUrl && (
                <iframe
                  key={previewUrl}
                  title={previewAtt.filename}
                  src={previewUrl}
                  style={{ width: '100%', height: '75vh', border: 'none', borderRadius: 8, background: '#fff' }}
                />
              )}
              {!previewLoading && !previewError && previewAtt && attKind(previewAtt) === 'video' && previewUrl && (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 8, background: '#000' }}
                >
                  <source src={previewUrl} type={mimeFromName(previewAtt.filename, previewAtt.mimeType || 'video/mp4')} />
                </video>
              )}
              {!previewLoading && !previewError && previewAtt && attKind(previewAtt) === 'audio' && previewUrl && (
                <audio key={previewUrl} src={previewUrl} controls preload="metadata" style={{ width: '100%', maxWidth: 480 }} />
              )}
              {!previewLoading && !previewError && previewAtt && previewSlides && previewSlides.length > 0 && (
                <div className="mailbox-gdocs-reader">
                  <div className="mailbox-gdocs-toolbar">
                    <button
                      type="button"
                      className="secondary"
                      disabled={previewSlideIdx <= 0}
                      onClick={() => setPreviewSlideIdx((i) => Math.max(0, i - 1))}
                      aria-label="Précédent"
                    >
                      ←
                    </button>
                    <span className="mailbox-gdocs-counter">
                      {previewSlideIdx + 1} / {previewSlides.length}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={previewSlideIdx >= previewSlides.length - 1}
                      onClick={() => setPreviewSlideIdx((i) => Math.min(previewSlides.length - 1, i + 1))}
                      aria-label="Suivant"
                    >
                      →
                    </button>
                  </div>
                  <div className="mailbox-gdocs-stage">
                    <div className="mailbox-gdocs-slide">
                      {(() => {
                        const s = previewSlides[previewSlideIdx] || previewSlides[0]!;
                        const isDoc = (previewAtt.filename || '').toLowerCase().endsWith('.docx');
                        const isXlsx = (previewAtt.filename || '').toLowerCase().endsWith('.xlsx');
                        return (
                          <>
                            {(isXlsx || !isDoc) && (
                              <h2 className="mailbox-gdocs-title">{isXlsx ? s.title : (s.lines[0] || s.title)}</h2>
                            )}
                            <div className={`mailbox-gdocs-body${isDoc ? ' is-doc' : ''}${isXlsx ? ' is-sheet' : ''}`}>
                              {s.table && s.table.length > 0 ? (
                                <div className="mailbox-gdocs-table-wrap">
                                  <table className="mailbox-gdocs-table">
                                    <tbody>
                                      {s.table.map((row, ri) => (
                                        <tr key={ri}>
                                          {row.map((cell, ci) =>
                                            ri === 0 ? (
                                              <th key={ci}>{cell}</th>
                                            ) : (
                                              <td key={ci}>{cell}</td>
                                            ),
                                          )}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <>
                                  {(isDoc ? s.lines : s.lines.slice(1)).map((line, li) => (
                                    <p key={li}>{line}</p>
                                  ))}
                                </>
                              )}
                              {s.images.map((src, ii) => (
                                <img key={ii} src={src} alt="" className="mailbox-gdocs-img" />
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {previewSlides.length > 1 && (
                    <div className="mailbox-gdocs-dots" role="tablist" aria-label="Diapositives">
                      {previewSlides.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={i === previewSlideIdx ? 'is-active' : ''}
                          aria-label={`Diapositive ${i + 1}`}
                          onClick={() => setPreviewSlideIdx(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>


      {replyOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="mailbox-compose-overlay" role="presentation" onClick={() => { setReplyOpen(false); setReplyFiles([]); }}>
            <div className="mailbox-compose-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <ComposeEmailCard
                title={replySubject.startsWith('Tr:') || replySubject.startsWith('Fwd:') ? 'Transférer' : 'Répondre'}
                to={replyTo}
                subject={replySubject}
                body={replyText}
                files={replyFiles}
                aiInstruction={aiInstruction}
                sending={sending}
                aiBusy={aiBusy}
                onToChange={setReplyTo}
                onSubjectChange={setReplySubject}
                onBodyChange={setReplyText}
                onAiInstructionChange={setAiInstruction}
                onAddFiles={(fs) => setReplyFiles((prev) => [...prev, ...fs].slice(0, 5))}
                onRemoveFile={(i) => setReplyFiles((prev) => prev.filter((_, j) => j !== i))}
                onAiDraft={() => void runAiDraft('reply')}
                onSend={() => void sendReply()}
                onClose={() => { setReplyOpen(false); setReplyFiles([]); }}
                quickReplies={QUICK_REPLIES.map((q) => ({ label: q.label, text: q.body }))}
              />
            </div>
          </div>,
          document.body,
        )}

      {composeOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="mailbox-compose-overlay"
            role="presentation"
            onClick={() => closeCompose()}
          >
            <div
              className="mailbox-compose-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Nouveau message"
              onClick={(e) => e.stopPropagation()}
            >
              <ComposeEmailCard
                title="Nouveau message"
                to={composeTo}
                subject={composeSubject}
                body={composeBody}
                files={composeFiles}
                aiInstruction={aiInstruction}
                sending={sending}
                aiBusy={aiBusy}
                onToChange={setComposeTo}
                onSubjectChange={setComposeSubject}
                onBodyChange={setComposeBody}
                onAiInstructionChange={setAiInstruction}
                onAddFiles={(fs) => setComposeFiles((prev) => [...prev, ...fs].slice(0, 5))}
                onRemoveFile={(i) => setComposeFiles((prev) => prev.filter((_, j) => j !== i))}
                onAiDraft={() => void runAiDraft('compose')}
                onSend={() => void sendCompose()}
                onClose={closeCompose}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
