import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Bell, ChevronDown, ShoppingCart, Users } from 'lucide-react';

type Props = { open: boolean; setOpen: Dispatch<SetStateAction<boolean>>; pending: number; allowSell: boolean; allowClients?: boolean; onNavigate: (path: string) => void };

/** The small Android-style dropdown does not cover the page with a scroll-blocking backdrop. */
export default function PhoneQuickActions({ open, setOpen, pending, allowSell, allowClients = false, onNavigate }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onOutside); };
  }, [open, setOpen]);
  const openPage = (path: string) => { setOpen(false); onNavigate(path); };
  const badge = pending > 99 ? '99+' : pending;
  return <div className="ph-quick-wrap" ref={wrap}>
    <button ref={trigger} type="button" className="ph-quick-ball" aria-label={pending > 0 ? `Menu rapide, ${pending} actions en attente` : 'Menu rapide'} aria-expanded={open} aria-controls={open ? 'phone-quick-menu' : undefined} onClick={() => setOpen(value => !value)}>
      {pending > 0 && <span className="ph-quick-count" aria-hidden="true">{badge}</span>}
      <ChevronDown size={20} className={open ? 'chev open' : 'chev'} aria-hidden="true" />
    </button>
    {open && <div id="phone-quick-menu" className="ph-quick-menu" aria-label="Menu rapide">
      <button type="button" className="ph-quick-item theme-toggle" onClick={() => openPage('/m/inbox')}><Bell size={20} aria-hidden="true" /><span className="ph-quick-item-txt"><strong>Notifications</strong><small>{pending > 0 ? `${pending} action${pending > 1 ? 's' : ''} en attente` : 'Boîte d’alertes & activité'}</small></span>{pending > 0 && <span className="ph-quick-badge" aria-hidden="true">{badge}</span>}</button>
      {allowSell && <button type="button" className="ph-quick-item theme-toggle" onClick={() => openPage('/m/vente')}><ShoppingCart size={20} aria-hidden="true" /><span className="ph-quick-item-txt"><strong>Vente</strong><small>Nouvelle vente / caisse</small></span></button>}
      {allowClients && <button type="button" className="ph-quick-item theme-toggle" onClick={() => openPage('/m/clients')}><Users size={20} aria-hidden="true" /><span className="ph-quick-item-txt"><strong>Clients</strong><small>Annuaire &amp; situation de crédit</small></span></button>}
    </div>}
  </div>;
}
