import { useRef, useState, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail,
  Paperclip,
  Send,
  Sparkles,
  X,
  Minus,
  Smile,
  Link2,
  MoreHorizontal,
} from 'lucide-react';

export type ComposeEmailCardProps = {
  to: string;
  subject: string;
  body: string;
  files: File[];
  aiInstruction: string;
  sending?: boolean;
  aiBusy?: boolean;
  title?: string;
  onToChange: (v: string) => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onAiInstructionChange: (v: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onAiDraft: () => void;
  onSend: () => void;
  onClose: () => void;
  quickReplies?: { label: string; text: string }[];
  footerHint?: ReactNode;
};

const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 1 };

function fmtSize(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

const EMOJIS = ['😊', '👍', '🙌', '🔥', '💡', '✅', '🚀', '💼', '📊', '🎯', '💬', '🤝', '⭐', '📌', '🎉', '💪'];

export const ComposeEmailCard: FC<ComposeEmailCardProps> = ({
  to,
  subject,
  body,
  files,
  aiInstruction,
  sending,
  aiBusy,
  title = 'Nouveau message',
  onToChange,
  onSubjectChange,
  onBodyChange,
  onAiInstructionChange,
  onAddFiles,
  onRemoveFile,
  onAiDraft,
  onSend,
  onClose,
  quickReplies = [
    { label: 'Merci', text: 'Bonjour,\n\nMerci pour votre message.\n\nCordialement,' },
    { label: 'Bien reçu', text: 'Bonjour,\n\nBien reçu, je reviens vers vous rapidement.\n\nCordialement,' },
    { label: 'Disponible', text: 'Bonjour,\n\nJe suis disponible pour en discuter. Quand vous conviendrait-il ?\n\nCordialement,' },
  ],
  footerHint,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  return (
    <motion.div
      className="ac-compose-card ac-compose-card--v121"
      initial={{ opacity: 0, y: 36, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, damping: 38 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 'min(560px, 96vw)',
        maxHeight: 'min(92vh, 820px)',
        overflow: 'hidden',
        borderRadius: 24,
        border: '1px solid rgba(0,0,0,0.08)',
        background: '#f5f5f7',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        color: '#374151',
      }}
    >

      <style>{`
        .ac-compose-card--v121 input::placeholder,
        .ac-compose-card--v121 textarea::placeholder {
          color: #9ca3af !important;
          opacity: 1 !important;
          font-weight: 400 !important;
        }
        .ac-compose-card--v121 input:focus,
        .ac-compose-card--v121 textarea:focus {
          outline: none;
          border-color: #c4b5fd !important;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.12);
        }
      `}</style>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          flexShrink: 0,
          background: '#f5f5f7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: '#6b5ff5',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Mail size={18} strokeWidth={1.6} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 650, color: '#29292b', letterSpacing: '-0.02em' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            title="Réduire"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              borderRadius: 8,
              padding: 8,
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            title="Fermer"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              borderRadius: 8,
              padding: 8,
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* White card body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          margin: '0 12px',
          borderRadius: 18,
          border: '1px solid #e5e5e5',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '16px 20px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ width: 52, color: '#9ca3af', flexShrink: 0 }}>À</span>
            <input
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              placeholder="destinataire@exemple.com"
              style={{
                flex: 1,
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                padding: '8px 14px',
                fontSize: 13,
                outline: 'none',
                background: '#fff',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, borderBottom: '1px solid #f3f4f6', paddingBottom: 10 }}>
            <span style={{ width: 52, color: '#9ca3af', flexShrink: 0 }}>Objet</span>
            <input
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="Objet du message"
              style={{
                flex: 1,
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                outline: 'none',
                color: '#1f2937',
                background: 'transparent',
              }}
            />
          </label>
        </div>

        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Écrivez votre message…"
          rows={10}
          style={{
            flex: 1,
            minHeight: 180,
            border: 'none',
            resize: 'vertical',
            padding: '8px 20px 16px',
            fontSize: 14,
            lineHeight: 1.55,
            color: '#374151',
            outline: 'none',
            fontFamily: 'inherit',
            background: 'transparent',
          }}
        />

        {(files.length > 0 || quickReplies.length > 0) && (
          <div style={{ padding: '0 20px 16px' }}>
            {files.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: '#a7a7a9', marginBottom: 10, textTransform: 'uppercase' }}>
                  Pièces jointes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 12 }}>
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        border: '1.5px solid #f1f2f8',
                        borderRadius: 14,
                        padding: 8,
                        background: '#fff',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          background: '#f3f4f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#9ca3af',
                          flexShrink: 0,
                        }}
                      >
                        {(f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtSize(f.size)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveFile(i)}
                        style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', padding: 4 }}
                        aria-label="Retirer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {quickReplies.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {quickReplies.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => onBodyChange(q.text)}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 999,
                      background: '#f9fafb',
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#4b5563',
                      cursor: 'pointer',
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 16px 14px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          <button
            type="button"
            title="Modèles rapides"
            style={iconBtn}
            onClick={() => {
              if (!body.trim()) onBodyChange(quickReplies[0]?.text || '');
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          <div style={{ position: 'relative' }}>
            <button type="button" title="Emoji" style={iconBtn} onClick={() => setEmojiOpen((v) => !v)}>
              <Smile size={18} />
            </button>
            <AnimatePresence>
              {emojiOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 8,
                    width: 200,
                    padding: 12,
                    borderRadius: 16,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                    zIndex: 20,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 4,
                  }}
                >
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        onBodyChange(body + e);
                        setEmojiOpen(false);
                      }}
                      style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', padding: 4, borderRadius: 8 }}
                    >
                      {e}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            type="button"
            title="Joindre"
            style={iconBtn}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <button type="button" title="Lien" style={iconBtn} onClick={() => onBodyChange(body + '\nhttps://')}>
            <Link2 size={18} />
          </button>
          <button
            type="button"
            title="Suggestion IA"
            style={{ ...iconBtn, color: aiBusy ? '#6b5ff5' : undefined }}
            disabled={aiBusy}
            onClick={() => onAiDraft()}
          >
            <Sparkles size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              if (list.length) onAddFiles(list);
              e.target.value = '';
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          {footerHint ?? (
            <span style={{ fontSize: 11, color: '#c6c5ca', fontWeight: 500 }}>Brouillon local</span>
          )}
          <div style={{ display: 'flex', gap: 6, maxWidth: 160 }}>
            <input
              value={aiInstruction}
              onChange={(e) => onAiInstructionChange(e.target.value)}
              placeholder="IA : ton pro…"
              style={{
                width: 100,
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 11,
                outline: 'none',
              }}
            />
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={sending}
            onClick={onSend}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              borderRadius: 999,
              background: '#0f0f0f',
              color: '#fff',
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: sending ? 'wait' : 'pointer',
              opacity: sending ? 0.7 : 1,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            <Send size={14} />
            {sending ? 'Envoi…' : 'Envoyer'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

const iconBtn: import("react").CSSProperties = {
  border: 'none',
  background: 'transparent',
  borderRadius: 8,
  padding: 8,
  color: '#9ca3af',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default ComposeEmailCard;
