import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Renders children into document.body to escape overflow:hidden ancestors. */
export function FloatingPortal({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!enabled || !mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
