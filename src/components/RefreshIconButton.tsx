import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  label?: string;
};

/**
 * Icon-only refresh.
 * Uses a filled path (not stroke) so the glyph always paints.
 * Comfort = round pill; Compact = slight radius (set in CSS).
 */
export default function RefreshIconButton({
  loading = false,
  label = 'Actualiser',
  className = '',
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={`icon-refresh-btn secondary ${loading ? 'is-loading' : ''} ${className}`.trim()}
      title={label}
      aria-label={label}
      disabled={disabled || loading}
      {...rest}
    >
      <svg
        className={loading ? 'icon-refresh-spin' : undefined}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', width: 20, height: 20, flexShrink: 0 }}
      >
        {/* Material-style filled refresh — does not depend on stroke CSS */}
        <path
          fill="#0f172a"
          d="M17.65 6.35A7.958 7.958 0 0 0 12 4V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8c0-2.21-.9-4.2-2.35-5.65z"
        />
      </svg>
    </button>
  );
}
