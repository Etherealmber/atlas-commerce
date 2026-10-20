import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronUp,
  Globe,
  MapPin,
  Users,
  Package,
  TrendingUp,
} from 'lucide-react';

export type CompanyProfileCardProps = {
  name: string;
  subtitle?: string;
  logoUrl?: string;
  location?: string;
  products?: number | string;
  clients?: number | string;
  revenueLabel?: string;
  trend?: number[];
  tags?: string[];
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function CompanyProfileCard({
  name,
  subtitle = 'Atlas Commerce',
  logoUrl,
  location = 'Maroc',
  products = '—',
  clients = '—',
  revenueLabel = '—',
  trend = [4, 8, 6, 12, 10, 14, 16],
  tags = ['Stock', 'Facturation'],
}: CompanyProfileCardProps) {
  const [open, setOpen] = useState(false);
  const path = trend
    .map((v, i) => {
      const x = (i / Math.max(1, trend.length - 1)) * 78 + 1;
      const y = 18 - (v / Math.max(...trend, 1)) * 14;
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');

  return (
    <motion.div layout transition={spring} className="ac-profile-card">
      <button type="button" className="ac-profile-card-head" onClick={() => setOpen((v) => !v)}>
        <div className="ac-profile-card-brand">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="ac-profile-card-logo" loading="lazy" decoding="async" />
          ) : (
            <span className="ac-profile-card-logo ac-profile-card-logo--ini">{name.slice(0, 1)}</span>
          )}
          <span className="ac-profile-card-name">{name}</span>
        </div>
        <div className="ac-profile-card-right">
          <svg viewBox="0 0 80 20" className="ac-profile-card-spark" aria-hidden>
            <path d={path} fill="none" stroke="var(--ac-ok)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <motion.span animate={{ rotate: open ? 0 : 180 }} className="ac-profile-card-chev">
            <ChevronUp size={18} />
          </motion.span>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="ac-profile-card-body-wrap"
          >
            <div className="ac-profile-card-body">
              <Row icon={<Globe size={15} />} label="Espace">{subtitle}</Row>
              <Row icon={<MapPin size={15} />} label="Localisation">{location}</Row>
              <Row icon={<Package size={15} />} label="Produits">{String(products)}</Row>
              <Row icon={<Users size={15} />} label="Clients">{String(clients)}</Row>
              <Row icon={<TrendingUp size={15} />} label="CA période">{revenueLabel}</Row>
              {tags.length > 0 && (
                <div className="ac-profile-card-tags">
                  {tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="ac-profile-card-row">
      <span className="ac-profile-card-row-l">
        {icon}
        {label}
      </span>
      <span className="ac-profile-card-row-v">{children}</span>
    </div>
  );
}

export default CompanyProfileCard;
