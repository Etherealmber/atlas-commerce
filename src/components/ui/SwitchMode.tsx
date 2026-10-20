import { type FC } from 'react';
import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';

type Props = {
  isDark: boolean;
  onToggle: () => void;
  width?: number;
  height?: number;
  label?: string;
};

/** Animated sun/moon theme switch — Atlas theme (no next-themes). */
export const SwitchMode: FC<Props> = ({
  isDark,
  onToggle,
  width = 72,
  height = 36,
  label = 'Thème',
}) => {
  const iconSize = height * 0.42;
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={isDark}
      onClick={onToggle}
      className="ac-switch-mode"
      style={{ width, height, borderColor: isDark ? '#4C4C50' : '#D8D6E0' }}
    >
      <motion.div
        className="ac-switch-mode-track"
        animate={{ backgroundColor: isDark ? '#0B0B0B' : '#FFFFFF' }}
        transition={{ duration: 0.35 }}
      />
      <motion.div
        className="ac-switch-mode-knob"
        layout
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        style={{
          width: height - 4,
          height: height - 4,
          left: isDark ? undefined : 2,
          right: isDark ? 2 : undefined,
          backgroundColor: isDark ? '#2A2A2E' : '#F3F2F7',
          borderColor: isDark ? '#4C4C50' : '#D8D6E0',
        }}
      />
      <span className="ac-switch-mode-side" style={{ width: height, height }}>
        <Sun size={iconSize} className={isDark ? 'dim' : 'hot'} />
      </span>
      <span className="ac-switch-mode-side" style={{ width: height, height }}>
        <Moon size={iconSize} className={isDark ? 'hot' : 'dim'} />
      </span>
    </motion.button>
  );
};

export default SwitchMode;
