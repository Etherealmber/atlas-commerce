/**
 * Example surface that respects Liquid Glass + density priority rules.
 *
 * - Uses CSS utility `.liquid-glass-surface` and design tokens from index.css
 * - Effective glass is controlled by `data-glass` / `data-liquid-glass` on <html>
 *   (set by density.ts — Compact Mode always forces solid surfaces)
 *
 * Usage:
 *   <LiquidGlassCard title="Stock faible">…</LiquidGlassCard>
 */
import type { ReactNode } from 'react';
import { isLiquidGlassActive } from '../lib/density';

type Props = {
  title?: string;
  children?: ReactNode;
  className?: string;
};

export default function LiquidGlassCard({ title, children, className = '' }: Props) {
  // Optional JS-side class for debugging / analytics; visual state is CSS-driven
  const active = isLiquidGlassActive();

  return (
    <section
      className={`liquid-glass-surface card ${active ? 'is-glass' : 'is-solid'} ${className}`.trim()}
      data-glass-active={active ? '1' : '0'}
    >
      {title ? <h3 className="card-title" style={{ marginTop: 0, marginBottom: 8 }}>{title}</h3> : null}
      {children}
    </section>
  );
}
