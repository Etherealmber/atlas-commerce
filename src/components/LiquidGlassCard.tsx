/**
 * Solid card surface (liquid glass removed from product).
 */
import type { ReactNode } from 'react';

type Props = {
  title?: string;
  children?: ReactNode;
  className?: string;
};

export default function LiquidGlassCard({ title, children, className = '' }: Props) {
  return (
    <section
      className={`liquid-glass-surface card is-solid ${className}`.trim()}
      data-glass-active="0"
    >
      {title ? <h3 className="card-title" style={{ marginTop: 0, marginBottom: 8 }}>{title}</h3> : null}
      {children}
    </section>
  );
}
