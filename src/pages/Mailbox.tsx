import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import RefreshIconButton from '../components/RefreshIconButton';
import EmptyState from '../components/EmptyState';
import { useUi } from '../components/AppDialogs';

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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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
function HtmlMailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);

  const doc = useMemo(() => {
    // Base stylesheet: larger type so the full invoice / message is easy to read.
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <base target="_blank">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        html,body{margin:0;padding:20px 16px 28px;font-family:-apple-system,'IBM Plex Sans',system-ui,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;background:#fff;word-break:break-word;}
        img{max-width:100%;height:auto;}
        a{color:#3a6ea5;}
        table{max-width:100% !important;width:100% !important;}
        h1,h2,h3{line-height:1.3;}
        *{box-sizing:border-box;}
      </style>
    </head><body>${html}</body></html>`;
  }, [html]);

  const resize = () => {
    try {
      const doc2 = ref.current?.contentDocument;
      const h = doc2?.documentElement?.scrollHeight || doc2?.body?.scrollHeight;
      // Allow tall messages (full invoice pages) — up to ~8000px
      if (h) setHeight(Math.min(Math.max(h + 32, 400), 20000));
    } catch { /* cross-origin-ish quirk, keep last known height */ }
  };

  return (
    <iframe
      ref={ref}
      title="Contenu du message"
      srcDoc={doc}
      onLoad={resize}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, border: 'none', borderRadius: 8, background: '#fff', display: 'block' }}
    />
  );
}

export default function Mailbox() {
  const { alert } = useUi();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const routeId = params.id ? Number(params.id) : null;
  const isCompose = typeof window !== 'undefined' && window.location.pathname.includes('/mailbox/compose');
  const [list, setList] = useState<MailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<MailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [sending, setSending] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [translateBusy, setTranslateBusy] = useState(false);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAtt, setPreviewAtt] = useState<AttMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewGoogle, setPreviewGoogle] = useState<string | null>(null);
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

  // Deep-link / Gmail-style open
  useEffect(() => {
    if (routeId && !Number.isNaN(routeId)) {
      openMessage(routeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const load = (soft = false) => {
    if (soft) setRefreshing(true); else setLoading(true);
    api.mailboxList({
        direction: direction || undefined,
        status: statusFilter || undefined,
        q: search || undefined,
        limit: 200,
      })
      .then((r: any) => {
        const rows = (r.data || []) as MailRow[];
        // Newest first (defensive client sort)
        rows.sort((a, b) => {
          const ta = Date.parse(String(a.created_at || '').replace(' ', 'T')) || 0;
          const tb = Date.parse(String(b.created_at || '').replace(' ', 'T')) || 0;
          if (tb !== ta) return tb - ta;
          return Number(b.id) - Number(a.id);
        });
        setList(rows);
      })
      .catch((e: any) => flash(e?.message || 'Erreur de chargement', 'error'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [direction, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => load(true), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openMessage = (id: number) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setReplyOpen(false); setReplyFiles([]);
    api.mailboxGet(id)
      .then((r: any) => setSelected(r.data))
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
      if (selectedId === id) { setSelectedId(null); setSelected(null); }
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Échec de la suppression', 'error');
    }
  };

  const syncResend = async () => {
    setSyncing(true);
    try {
      const r: any = await api.mailboxSyncResend(150);
      flash(r.message || 'Synchronisation Resend terminée.');
      load(true);
    } catch (e: any) {
      const msg = e?.message || '';
      if (String(msg).includes('EMAIL_NOT_CONFIGURED') || String(msg).toLowerCase().includes('resend_api_key')) {
        await alert('RESEND_API_KEY n\'est pas défini sur ce Worker (wrangler secret put RESEND_API_KEY).', 'Email non configuré');
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
    setPreviewError('');
    setPreviewAtt(a);
    setPreviewLoading(true);
    const kind = attKind(a);
    try {
      if (kind === 'office') {
        const r: any = await api.mailboxAttachmentPreviewUrl(a.r2_key, a.filename);
        setPreviewGoogle(r?.data?.google_viewer_url || null);
        setPreviewUrl(r?.data?.public_url || null);
      } else if (kind === 'other') {
        setPreviewError('Aperçu non disponible pour ce type de fichier. Utilisez Télécharger.');
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

  const attachments = parseAttachments(selected?.meta_json);
  const hasHtml = !!selected?.body_html?.trim();

  return (
    <div>
      <div className="page-header">
        <h1>Messagerie</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(isCompose || selectedId) && (
            <button type="button" className="secondary" onClick={backToList}>← Boîte de réception</button>
          )}
          <button type="button" onClick={() => navigate('/mailbox/compose')}>Nouveau message</button>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button className="secondary" onClick={syncResend} disabled={syncing}>
            {syncing ? 'Synchronisation...' : 'Synchroniser Resend'}
          </button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      {isCompose ? (
        <div className="card" style={{ padding: 20, maxWidth: 820, margin: '0 auto' }}>
          <h2 style={{ marginTop: 0 }}>Nouveau message</h2>
          <div className="form-row"><label>À</label>
            <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="client@example.com" />
          </div>
          <div className="form-row"><label>Sujet</label>
            <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
          </div>
          <div className="form-row"><label>Message</label>
            <textarea rows={12} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} style={{ minHeight: 220 }} />
          </div>
          <div className="form-row">
            <label>Réponses rapides</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_REPLIES.map((q) => (
                <button key={q.label} type="button" className="secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setComposeBody(q.body)}>{q.label}</button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>Rédiger avec l’IA</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input style={{ flex: 1, minWidth: 180 }} value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Ex. Relancer le devis pour carrelage, ton poli" />
              <button type="button" className="secondary" disabled={aiBusy} onClick={() => runAiDraft('compose')}>
                {aiBusy ? 'Rédaction…' : 'Écrire avec l’IA'}
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>Pièces jointes</label>
            <input ref={composeFileRef} type="file" multiple style={{ display: 'none' }}
              onChange={(e) => { setComposeFiles((p) => [...p, ...Array.from(e.target.files || [])].slice(0, 5)); e.target.value = ''; }} />
            <button type="button" className="secondary" onClick={() => composeFileRef.current?.click()}>📎 Joindre</button>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>Max 5 × 25 Mo</span>
            {!!composeFiles.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {composeFiles.map((f, i) => (
                  <span key={i} style={{ fontSize: 12 }}>{f.name} ({fmtSize(f.size)})
                    <button type="button" className="ghost" onClick={() => setComposeFiles((p) => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="form-actions">
            <button onClick={sendCompose} disabled={sending}>{sending ? 'Envoi…' : 'Envoyer'}</button>
            <button className="secondary" onClick={backToList}>Annuler</button>
          </div>
        </div>
      ) : selectedId && selected && !loadingDetail ? (
        <div className="card mailbox-reader" style={{ padding: 0, overflow: 'visible', maxWidth: 960, margin: '0 auto' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border, #e2e8f0)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="secondary" onClick={backToList}>← Retour</button>
            <button type="button" className="secondary" onClick={startReply}>Répondre</button>
            <button type="button" className="secondary" disabled={translateBusy} onClick={() => translateSelected('fr')}>
              {translateBusy ? 'Traduction…' : 'Traduire'}
            </button>
            <button type="button" className="secondary" onClick={copySignedLink}>Copier lien sécurisé</button>
            <button type="button" className="danger" onClick={() => deleteMessage(selected.id)}>Supprimer</button>
          </div>
          <div style={{ padding: '20px 24px 32px' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{selected.subject || '(sans objet)'}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {selected.direction === 'in' ? selected.from_addr : `À : ${selected.to_addr}`} · {fmtDate(selected.created_at)}
            </div>
            <div style={{ lineHeight: 1.55, fontSize: 15 }}>
              {selected.body_html?.trim() ? (
                <HtmlMailBody html={selected.body_html} />
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{selected.body_text || '(pas de contenu)'}</pre>
              )}
            </div>
            {!!attachments.length && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>Pièces jointes ({attachments.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {attachments.map((a, i) => (
                    <div key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                      <button type="button" className="ghost" onClick={() => openAttachmentPreview(a)}>{attIcon(attKind(a))} {a.filename}</button>
                      <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => api.mailboxDownloadAttachment(a.r2_key, a.filename).catch((e: any) => flash(e?.message || 'Échec', 'error'))}>↓</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {replyOpen && (
              <div className="card" style={{ marginTop: 20, padding: 16 }}>
                <div className="form-row"><label>À</label><input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} /></div>
                <div className="form-row"><label>Sujet</label><input value={replySubject} onChange={(e) => setReplySubject(e.target.value)} /></div>
                <div className="form-row"><label>Message</label>
                  <textarea rows={8} value={replyText} onChange={(e) => setReplyText(e.target.value)} style={{ minHeight: 160 }} />
                </div>
                <div className="form-row">
                  <label>Réponses rapides</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {QUICK_REPLIES.map((q) => (
                      <button key={q.label} type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setReplyText(q.body)}>{q.label}</button>
                    ))}
                  </div>
                </div>
                <div className="form-row">
                  <label>IA (réponse)</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input style={{ flex: 1 }} value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)} placeholder="Ex. Accepter le délai, demander un acompte" />
                    <button type="button" className="secondary" disabled={aiBusy} onClick={() => runAiDraft('reply')}>{aiBusy ? '…' : 'Rédiger avec l’IA'}</button>
                  </div>
                </div>
                <div className="form-row">
                  <label>Pièces jointes</label>
                  <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                    onChange={(e) => { setReplyFiles((p) => [...p, ...Array.from(e.target.files || [])].slice(0, 5)); e.target.value = ''; }} />
                  <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>📎 Joindre</button>
                  {!!replyFiles.length && replyFiles.map((f, i) => (
                    <span key={i} style={{ fontSize: 12, marginLeft: 8 }}>{f.name}
                      <button type="button" className="ghost" onClick={() => setReplyFiles((p) => p.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                </div>
                <div className="form-actions">
                  <button onClick={sendReply} disabled={sending}>{sending ? 'Envoi…' : 'Envoyer'}</button>
                  <button className="secondary" onClick={() => { setReplyOpen(false); setReplyFiles([]); }}>Annuler</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
      <>
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div
          className="mailbox-toolbar"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <div className="search-bar" style={{ width: '100%', minWidth: 0, margin: 0 }}>
            <input
              className="search-input"
              placeholder="Rechercher par sujet, expéditeur, destinataire..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', height: 40, boxSizing: 'border-box' }}
            />
          </div>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as any)}
            aria-label="Filtrer par direction"
            style={{ height: 40, minWidth: 150, width: 'auto', boxSizing: 'border-box' }}
          >
            <option value="">Tous les messages</option>
            <option value="in">Reçus</option>
            <option value="out">Envoyés</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrer par statut"
            style={{ height: 40, minWidth: 140, width: 'auto', boxSizing: 'border-box' }}
          >
            <option value="">Tous statuts</option>
            <option value="sent">Envoyés (statut)</option>
            <option value="received">Reçus (statut)</option>
            <option value="delivered">Délivrés</option>
            <option value="bounced">Rebondis</option>
            <option value="unmatched">Non rattachés</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0, display: 'flex', minHeight: 'calc(100vh - 160px)', height: 'auto', overflow: 'visible' }}>
        {/* LIST */}
        <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--border, #2c3441)', overflowY: 'auto', height: '100%' }}>
          {loading ? (
            <div className="empty" style={{ padding: 20 }}>Chargement...</div>
          ) : !list.length ? (
            <div style={{ padding: 8 }}>
              <EmptyState
                icon="inbox"
                title="Aucun message"
                description="Les emails envoyés depuis les factures et ceux reçus sur le domaine apparaîtront ici."
              />
            </div>
          ) : (
            list.map((m) => (
              <div
                key={m.id}
                onClick={() => openMessage(m.id)}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border, #2c3441)',
                  cursor: 'pointer',
                  background: selectedId === m.id ? 'var(--hover, rgba(110,156,151,0.08))' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span className={`badge ${m.direction === 'in' ? 'info' : 'success'}`} style={{ fontSize: 10 }}>
                    {m.direction === 'in' ? 'Reçu' : 'Envoyé'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(m.created_at)}</span>
                </div>
                <div style={{ fontWeight: 600, marginTop: 4, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.subject || '(sans objet)'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.direction === 'in' ? m.from_addr : m.to_addr}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(m.has_attachments === 1 || m.has_attachments === true || parseAttachments(m.meta_json).length > 0) && (
                    <span className="badge" style={{ fontSize: 10, background: 'rgba(15,118,110,0.12)', color: '#0f766e' }} title="Pièces jointes">📎 PJ</span>
                  )}
                  {m.status === 'unmatched' && (
                    <span className="badge warn" style={{ fontSize: 10 }}>Non rattaché</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* DETAIL */}
        <div style={{ flex: 1, overflowY: 'auto', height: '100%', padding: selected ? '16px 24px 40px' : 0 }}>
          {!selectedId ? (
            <div style={{ padding: 24 }}>
              <EmptyState icon="inbox" title="Sélectionnez un message" description="Choisissez un email dans la liste pour lire la conversation." />
            </div>
          ) : loadingDetail ? (
            <div className="empty">Chargement du message...</div>
          ) : selected ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.3 }}>{selected.subject || '(sans objet)'}</h2>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={startReply}>Répondre</button>
                  <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteMessage(selected.id)}>Suppr.</button>
                </div>
              </div>

              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {thread.map((m) => {
                  const isFull = m.id === selected.id;
                  const atts = isFull ? attachments : [];
                  return (
                    <div key={m.id} className="card" style={{ padding: '20px 24px', background: 'var(--panel-2, rgba(255,255,255,0.02))', overflow: 'visible' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                        <span>
                          <span className={`badge ${m.direction === 'in' ? 'info' : 'success'}`} style={{ fontSize: 10, marginRight: 8 }}>
                            {m.direction === 'in' ? 'Reçu' : 'Envoyé'}
                          </span>
                          {m.direction === 'in' ? m.from_addr : `À : ${m.to_addr}`}
                        </span>
                        <span>{fmtDate(m.created_at)}</span>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        {isFull && hasHtml ? (
                          <HtmlMailBody html={selected.body_html!} />
                        ) : isFull && selected.body_text ? (
                          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', fontSize: 15 }}>{selected.body_text}</pre>
                        ) : (
                          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', fontSize: 15, color: m.preview ? undefined : 'var(--muted)' }}>
                            {m.preview || '(pas de contenu)'}
                          </pre>
                        )}
                      </div>
                      {!!atts.length && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--muted)', marginBottom: 8 }}>
                            Pièces jointes ({atts.length})
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {atts.map((a, i) => {
                              const kind = attKind(a);
                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '4px 6px 4px 10px',
                                    borderRadius: 10,
                                    border: '1px solid var(--border, #e2e8f0)',
                                    background: 'var(--panel-2, #f8fafc)',
                                    fontSize: 13,
                                  }}
                                >
                                  <span>{attIcon(kind)}</span>
                                  <button
                                    type="button"
                                    className="ghost"
                                    style={{ padding: '2px 4px', minHeight: 0, fontWeight: 600 }}
                                    onClick={() => openAttachmentPreview(a)}
                                    title="Aperçu"
                                  >
                                    {a.filename}{a.size ? ` (${fmtSize(a.size)})` : ''}
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    style={{ padding: '4px 8px', fontSize: 12, minHeight: 0 }}
                                    onClick={() => api.mailboxDownloadAttachment(a.r2_key, a.filename).catch((e: any) => flash(e?.message || 'Téléchargement échoué', 'error'))}
                                    title="Télécharger"
                                  >
                                    ↓
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {replyOpen && (
                <div className="card" style={{ marginTop: 16, padding: 16 }}>
                  <div className="form-row"><label>À</label><input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} /></div>
                  <div className="form-row"><label>Sujet</label><input value={replySubject} onChange={(e) => setReplySubject(e.target.value)} /></div>
                  <div className="form-row"><label>Message</label><textarea rows={6} value={replyText} onChange={(e) => setReplyText(e.target.value)} /></div>
                  <div className="form-row">
                    <label>Pièces jointes</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setReplyFiles((prev) => {
                          const next = [...prev, ...files].slice(0, 5);
                          return next;
                        });
                        e.target.value = '';
                      }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: '6px 12px', fontSize: 13 }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        📎 Joindre un fichier
                      </button>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Max 5 fichiers · 25 Mo chacun (limite proche Resend)</span>
                    </div>
                    {!!replyFiles.length && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {replyFiles.map((f, i) => (
                          <span
                            key={`${f.name}-${i}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 10px',
                              borderRadius: 8,
                              background: 'var(--panel-2, rgba(0,0,0,0.04))',
                              border: '1px solid var(--border, #e2e8f0)',
                              fontSize: 12,
                            }}
                          >
                            📎 {f.name} ({fmtSize(f.size)})
                            <button
                              type="button"
                              className="ghost"
                              style={{ padding: '0 4px', minHeight: 0, fontSize: 14, lineHeight: 1 }}
                              aria-label="Retirer"
                              onClick={() => setReplyFiles((prev) => prev.filter((_, j) => j !== i))}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    <button onClick={sendReply} disabled={sending}>{sending ? 'Envoi...' : 'Envoyer'}</button>
                    <button className="secondary" onClick={() => { setReplyOpen(false); setReplyFiles([]); }}>Annuler</button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      </>
      )}

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
              {!previewLoading && !previewError && previewAtt && attKind(previewAtt) === 'office' && previewGoogle && (
                <iframe
                  title={previewAtt.filename}
                  src={previewGoogle}
                  style={{ width: '100%', height: '75vh', border: 'none', borderRadius: 8, background: '#fff' }}
                />
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
