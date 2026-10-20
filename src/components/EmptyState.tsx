/** Consistent empty / next-action panels with SVG icons (no emoji) */

import { EmptyIcon, type EmptyIconName } from './Icons';

type Props = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Named SVG icon — never emoji */
  icon?: EmptyIconName;
};

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon = 'inbox',
}: Props) {
  return (
    <div className="atlas-empty" role="status">
      <div className="atlas-empty-icon" aria-hidden>
        <EmptyIcon name={icon} size={40} />
      </div>
      <h3 className="atlas-empty-title">{title}</h3>
      {description ? (
        <p className="atlas-empty-desc">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <button type="button" className="atlas-empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
