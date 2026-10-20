/**
 * Atlas action buttons — inspired by Watermelon button variants.
 * Uses lucide icons + ac-* tokens (no react-icons / base-ui).
 */
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  Trash2,
  Copy,
  Check,
  Plus,
  ArrowLeft,
  ArrowRight,
  Save,
  Ban,
} from 'lucide-react';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  className?: string;
};

export function DeleteButton({ className = '', children = 'Supprimer', ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`ac-btn ac-btn-delete ${className}`.trim()}
      {...rest}
    >
      <Trash2 size={16} />
      {children}
    </button>
  );
}

export function CopyButton({
  text,
  className = '',
  label = 'Copier',
  copiedLabel = 'Copié !',
  ...rest
}: BtnProps & { text: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`ac-btn ac-btn-outline ${className}`.trim()}
      disabled={copied || rest.disabled}
      onClick={async (e) => {
        rest.onClick?.(e);
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch { /* */ }
      }}
    >
      <span className={`ac-btn-ico-swap${copied ? ' is-on' : ''}`}>
        <Check size={16} className="ac-btn-check" />
        <Copy size={16} className="ac-btn-copy" />
      </span>
      {copied ? copiedLabel : label}
    </button>
  );
}

export function AddIconButton({ className = '', title = 'Ajouter', ...rest }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`ac-btn ac-btn-icon-round ${className}`.trim()}
      {...rest}
    >
      <Plus size={18} />
    </button>
  );
}

export function BackButton({ className = '', children = 'Retour', ...rest }: BtnProps) {
  return (
    <button type="button" className={`ac-btn ac-btn-ghost ac-btn-back ${className}`.trim()} {...rest}>
      <ArrowLeft size={16} className="ac-btn-back-arrow" />
      {children}
    </button>
  );
}

export function SaveButton({ className = '', children = 'Enregistrer', ...rest }: BtnProps) {
  return (
    <button type="button" className={`ac-btn ac-btn-save ${className}`.trim()} {...rest}>
      <Save size={16} />
      {children}
    </button>
  );
}

export function LoadingButton({ className = '', children = 'Chargement', ...rest }: BtnProps) {
  return (
    <button type="button" disabled className={`ac-btn ac-btn-loading ${className}`.trim()} {...rest}>
      <span>{children}</span>
      <span className="ac-btn-dots" aria-hidden>
        <span /><span /><span />
      </span>
    </button>
  );
}

export function PrevNextButtons({
  onPrev,
  onNext,
  prevLabel = 'Préc.',
  nextLabel = 'Suiv.',
  disablePrev,
  disableNext,
  className = '',
}: {
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  disablePrev?: boolean;
  disableNext?: boolean;
  className?: string;
}) {
  return (
    <div className={`ac-btn-pair ${className}`.trim()}>
      <button type="button" className="ac-btn ac-btn-outline" disabled={disablePrev} onClick={onPrev}>
        <ArrowLeft size={16} /> {prevLabel}
      </button>
      <button type="button" className="ac-btn ac-btn-outline" disabled={disableNext} onClick={onNext}>
        {nextLabel} <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function DisabledButton({ className = '', children = 'Désactivé', ...rest }: BtnProps) {
  return (
    <button type="button" disabled className={`ac-btn ${className}`.trim()} {...rest}>
      <Ban size={16} />
      {children}
    </button>
  );
}
