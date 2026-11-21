import { useEffect, useRef, type ReactNode } from 'react';
import { FloatingPortal } from '../components/FloatingPortal';

type Props = { titleId: string; onClose: () => void; children: ReactNode; className?: string };

function DialogContent({ titleId, onClose, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = ref.current;
    if (!modal) return;
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] || modal).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); modal.focus(); return; }
      const current = items.indexOf(document.activeElement as HTMLElement);
      if (current === -1 || (event.shiftKey && current === 0) || (!event.shiftKey && current === items.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className={`ph-modal-bg${className ? ` ${className}` : ''}`} onClick={onClose}>
    <div ref={ref} className="ph-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>{children}</div>
  </div>;
}

export default function PhoneDialog(props: Props) {
  return <FloatingPortal><DialogContent {...props} /></FloatingPortal>;
}
