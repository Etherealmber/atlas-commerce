type Props = { size?: number; engaged?: boolean };

/** Friendly face adapted from Android's AtlasAgentMascot; decorative, not a fake action. */
export default function AtlasAgentMascot({ size = 32, engaged = false }: Props) {
  return <span className={`ph-mascot${engaged ? ' is-engaged' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 40 40" width="100%" height="100%" fill="none" focusable="false">
      <g className="ph-mascot-eyes"><ellipse cx="14.5" cy="18" rx="3.5" ry="4.5" fill="var(--mascot-eye)" /><ellipse cx="25.5" cy="18" rx="3.5" ry="4.5" fill="var(--mascot-eye)" /><ellipse cx="14.5" cy="18.3" rx="1.5" ry="2" fill="#40516f" /><ellipse cx="25.5" cy="18.3" rx="1.5" ry="2" fill="#40516f" /></g>
      <path d="M14.5 26 Q20 31 25.5 26" stroke="#40516f" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M31 5.2l1.1 2.7 2.8 1.1-2.8 1.1-1.1 2.8-1.1-2.8L27 9l2.9-1.1L31 5.2Z" fill="var(--mascot-sparkle)" />
    </svg>
  </span>;
}
