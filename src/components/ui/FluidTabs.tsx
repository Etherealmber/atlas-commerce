/**
 * Fluid pill tabs (mobile-friendly section switcher).
 */
import { useState, type ReactNode, type FC } from 'react';
import { motion } from 'motion/react';
import { Landmark, Inbox, PieChart } from 'lucide-react';

export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
}

const DEFAULT_TABS: TabItem[] = [
  { id: 'accounts', label: 'Comptes', icon: <Landmark size={18} /> },
  { id: 'deposits', label: 'Dépôts', icon: <Inbox size={18} /> },
  { id: 'funds', label: 'Fonds', icon: <PieChart size={18} /> },
];

export interface FluidTabsProps {
  tabs?: TabItem[];
  defaultActive?: string;
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export const FluidTabs: FC<FluidTabsProps> = ({
  tabs = DEFAULT_TABS,
  defaultActive,
  value,
  onChange,
  className = '',
}) => {
  const [internal, setInternal] = useState(defaultActive ?? tabs[0]?.id ?? '');
  const active = value ?? internal;
  const handleChange = (id: string) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  return (
    <div className={`ac-fluid-tabs ${className}`.trim()} role="tablist">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => handleChange(tab.id)}
            className="ac-fluid-tab"
          >
            {isActive && (
              <motion.div
                layoutId="ac-fluid-tab-pill"
                className="ac-fluid-tab-pill"
                transition={{ type: 'spring', stiffness: 280, damping: 25, mass: 0.8 }}
              />
            )}
            <motion.span
              className={`ac-fluid-tab-inner${isActive ? ' is-active' : ''}`}
              animate={{ filter: isActive ? ['blur(0px)', 'blur(3px)', 'blur(0px)'] : 'blur(0px)' }}
              transition={{ duration: 0.28 }}
            >
              <motion.span
                className="ac-fluid-tab-ico"
                animate={{ scale: isActive ? 1.04 : 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              >
                {tab.icon}
              </motion.span>
              <span className="ac-fluid-tab-label">{tab.label}</span>
            </motion.span>
          </button>
        );
      })}
    </div>
  );
};

export default FluidTabs;
