/**
 * Floating icon dock (desktop/mobile chrome).
 * Pass items with lucide icons + optional onClick / to.
 */
import { useState, type FC, type ReactNode } from 'react';
import { motion, type Transition } from 'motion/react';
import { Search, FileText, PlusSquare, Bell, Settings } from 'lucide-react';

export interface DockItem {
  id: string | number;
  label?: string;
  icon: ReactNode;
  onClick?: () => void;
}

interface DockProps {
  items?: DockItem[];
  className?: string;
  onSelect?: (id: string | number) => void;
}

const DEFAULT_ITEMS: DockItem[] = [
  { id: 'search', label: 'Recherche', icon: <Search size={22} /> },
  { id: 'notes', label: 'Notes', icon: <FileText size={22} /> },
  { id: 'add', label: 'Ajouter', icon: <PlusSquare size={22} /> },
  { id: 'alerts', label: 'Alertes', icon: <Bell size={22} /> },
  { id: 'settings', label: 'Réglages', icon: <Settings size={22} /> },
];

const dockSpring: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 22,
  mass: 0.7,
};

export const AppDock: FC<DockProps> = ({ items, className = '', onSelect }) => {
  const dockItems = items ?? DEFAULT_ITEMS;
  const [selected, setSelected] = useState<string | number | null>(null);
  const [pulse, setPulse] = useState<string | number | null>(null);

  const handleClick = (item: DockItem) => {
    setSelected(item.id);
    setPulse(item.id);
    window.setTimeout(() => setPulse(null), 200);
    item.onClick?.();
    onSelect?.(item.id);
  };

  return (
    <div className={`ac-dock-wrap ${className}`.trim()}>
      <motion.div layout transition={dockSpring} className="ac-dock">
        {dockItems.map((item) => (
          <motion.button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label || String(item.id)}
            aria-pressed={selected === item.id}
            className="ac-dock-item"
            style={{ transformOrigin: 'bottom' }}
            initial={{ scale: 1 }}
            whileHover={{ y: -4 }}
            animate={{
              scale: pulse === item.id ? 1.25 : 1,
              y: pulse === item.id ? -6 : 0,
            }}
            transition={{ type: 'spring', stiffness: 550, damping: 15, mass: 1.1 }}
            onClick={() => handleClick(item)}
          >
            <span className={`ac-dock-icon${selected === item.id ? ' is-selected' : ''}`}>
              {item.icon}
            </span>
            <span className={`ac-dock-dot${selected === item.id ? ' is-on' : ''}`} />
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
};

export default AppDock;
