/**
 * Number field that never shows a lone 0.
 * Uses local string state so clearing stays blank and "0.5" can be typed.
 * Parent still receives a number (empty → 0).
 */
import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number | string | null | undefined;
  onValueChange: (n: number) => void;
};

function toDisplay(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(v);
}

function toNumber(raw: string): number {
  const t = raw.trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export default function NumberField({
  value,
  onValueChange,
  onBlur,
  onFocus,
  ...rest
}: Props) {
  const [text, setText] = useState(() => toDisplay(value));
  const [focused, setFocused] = useState(false);

  // Sync from parent when not focused (e.g. form reset / load)
  useEffect(() => {
    if (!focused) setText(toDisplay(value));
  }, [value, focused]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      placeholder={rest.placeholder ?? ''}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        // Push number to parent; empty → 0 (save still works)
        onValueChange(toNumber(raw));
      }}
      onBlur={(e) => {
        setFocused(false);
        const n = toNumber(text);
        onValueChange(n);
        // Normalize display: 0 → empty, else clean number string
        setText(n === 0 ? '' : String(n));
        onBlur?.(e);
      }}
    />
  );
}
