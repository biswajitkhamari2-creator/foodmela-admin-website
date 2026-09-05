import React from 'react';

export function Badge({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span className="badge" style={{ background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: number }) {
  const map: Record<number, { label: string; bg: string; color: string; border: string }> = {
    0: { label: 'PENDING', bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
    1: { label: 'ACCEPTED', bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
    2: { label: 'OUT FOR DELIVERY', bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' },
    3: { label: 'DELIVERED', bg: '#ECFDF5', color: '#059669', border: '#A7F3D0' },
    [-1]: { label: 'CANCELLED', bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' },
  };
  const s = map[stage] ?? { label: `STAGE ${stage}`, bg: '#F1F5F9', color: '#64748B', border: '#E2E8F0' };
  return <Badge label={s.label} bg={s.bg} color={s.color} border={s.border} />;
}

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} />;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmColor = '#DC2626',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" style={{ background: confirmColor, color: '#fff' }} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ message, type = 'success', onClose }: { message: string; type?: 'success' | 'error'; onClose: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return <div className={`toast toast-${type}`}>{message}</div>;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        ← Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}
