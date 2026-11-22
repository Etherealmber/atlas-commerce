import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Team creation is not mounted until requested, so browsers cannot fill it at startup. */
export default function SettingsUserDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="modal-overlay" onClick={onClose}>
    <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="create-team-user-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') || []);
      if (!nodes.length) return;
      const i = nodes.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!e.shiftKey && i === nodes.length - 1) { e.preventDefault(); nodes[0].focus(); }
    }}>
      {children}
    </div>
  </div>, document.body);
}
