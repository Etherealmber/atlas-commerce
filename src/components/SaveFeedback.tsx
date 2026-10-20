type Props = {
  message: string;
  type?: 'success' | 'error' | 'saving';
};

export default function SaveFeedback({ message, type = 'success' }: Props) {
  if (!message) return null;

  const colors = {
    success: { bg: 'var(--ok-bg, rgba(99, 102, 241, 0.1))', color: 'var(--ok, #3f3f46)' },
    error: { bg: 'var(--bad-bg)', color: 'var(--bad)' },
    saving: { bg: 'rgba(59,130,246,0.08)', color: 'var(--muted)' },
  };
  const style = colors[type];

  return (
    <div
      className="save-feedback"
      role="status"
      aria-live="polite"
      style={{
        marginBottom: 16,
        padding: '12px 16px',
        borderRadius: 10,
        background: style.bg,
        color: style.color,
        fontSize: 14,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {type === 'saving' && <span className="save-spinner" aria-hidden />}
      {message}
    </div>
  );
}
