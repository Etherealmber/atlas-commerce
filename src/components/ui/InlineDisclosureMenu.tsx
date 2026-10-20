import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion, type Transition, type Variants } from 'motion/react';
import { MoreHorizontal } from 'lucide-react';

export type DisclosureMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  items: DisclosureMenuItem[];
  title?: string;
  showDelete?: boolean;
  deleteLabel?: string;
  confirmDeleteLabel?: string;
  cancelLabel?: string;
  onDelete?: () => void;
  align?: 'left' | 'right';
  triggerClassName?: string;
  /** Controlled open (optional) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const spring: Transition = { type: 'spring', bounce: 0, duration: 0.35 };

const menuVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring },
};

export const InlineDisclosureMenu: FC<Props> = ({
  items,
  title = 'Plus d’options',
  showDelete = false,
  deleteLabel = 'Supprimer',
  confirmDeleteLabel = 'Oui, supprimer',
  cancelLabel = 'Annuler',
  onDelete,
  align = 'right',
  triggerClassName = '',
  open: controlledOpen,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    onOpenChange?.(next);
    if (controlledOpen === undefined) setInternalOpen(next);
    if (!next) setConfirm(false);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="ac-disclosure-menu" style={{ position: 'relative', display: 'inline-flex' }}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        className={`icon-refresh-btn secondary mailbox-more-trigger ${triggerClassName}`.trim()}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        aria-label={title}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            variants={menuVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="ac-disclosure-panel"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              [align === 'right' ? 'right' : 'left']: 0,
              zIndex: 80,
              width: 280,
              overflow: 'hidden',
              borderRadius: 16,
              border: '1px solid #e8eaef',
              background: '#fff',
              boxShadow: '0 12px 40px rgba(15,23,42,0.12)',
            }}
          >
            <div
              style={{
                borderBottom: '1px solid #eef0f4',
                background: '#fafafc',
                padding: '10px 16px',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#828287' }}>{title}</span>
            </div>
            <LayoutGroup>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 8 }}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick?.();
                      setOpen(false);
                    }}
                    className="ac-disclosure-item"
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'center',
                      gap: 12,
                      borderRadius: 12,
                      padding: '10px 12px',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: item.disabled ? 'not-allowed' : 'pointer',
                      color: item.danger ? '#e94447' : '#363538',
                      fontSize: 15,
                      fontWeight: 500,
                      opacity: item.disabled ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = '#f6f5fa';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    {item.icon ? <span style={{ color: item.danger ? '#e94447' : '#6b7280', display: 'inline-flex' }}>{item.icon}</span> : null}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              {showDelete && onDelete && (
                <div style={{ position: 'relative', height: 56, overflow: 'hidden', borderTop: '1px solid #eef0f4' }}>
                  <AnimatePresence custom={confirm} mode="popLayout" initial={false}>
                    {!confirm ? (
                      <motion.div
                        key="delete"
                        initial={{ y: 40, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -40, opacity: 0 }}
                        transition={spring}
                        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 8px' }}
                      >
                        <button
                          type="button"
                          className="ac-disclosure-item"
                          onClick={() => setConfirm(true)}
                          style={{
                            display: 'flex',
                            width: '100%',
                            alignItems: 'center',
                            gap: 12,
                            borderRadius: 12,
                            padding: '10px 12px',
                            border: 'none',
                            background: 'transparent',
                            color: '#e94447',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {deleteLabel}
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="confirm"
                        initial={{ y: 40, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -40, opacity: 0 }}
                        transition={spring}
                        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onDelete();
                            setOpen(false);
                          }}
                          style={{
                            flex: 1,
                            height: 40,
                            borderRadius: 12,
                            border: 'none',
                            background: '#f24140',
                            color: '#fff',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {confirmDeleteLabel}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setConfirm(false)}
                          style={{ flex: 1, height: 40, borderRadius: 12 }}
                        >
                          {cancelLabel}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default InlineDisclosureMenu;
