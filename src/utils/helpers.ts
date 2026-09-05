import type { Timestamp } from 'firebase/firestore';

export function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Firestore Timestamp
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fmtTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function stageLabel(stage: number): string {
  switch (stage) {
    case 0: return 'Pending';
    case 1: return 'Accepted';
    case 2: return 'Out for Delivery';
    case 3: return 'Delivered';
    case -1: return 'Cancelled';
    default: return `Stage ${stage}`;
  }
}

export function stageColor(stage: number): { bg: string; color: string; border: string } {
  switch (stage) {
    case 0: return { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' };
    case 1: return { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' };
    case 2: return { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' };
    case 3: return { bg: '#ECFDF5', color: '#059669', border: '#A7F3D0' };
    case -1: return { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' };
    default: return { bg: '#F1F5F9', color: '#64748B', border: '#E2E8F0' };
  }
}

export function generatePartnerId(name: string): string {
  const clean = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = clean.length >= 3 ? clean.slice(0, 3) : (clean + 'XXX').slice(0, 3);
  const suffix = String(1000 + Math.floor(Math.random() * 9000));
  return `${prefix}-${suffix}`;
}

// ── ID helpers — clean display + 4-digit search ────────────────────────────
export function displayId(raw: string | undefined | null): string {
  if (!raw) return '—';
  // Strip FM- prefix if present (legacy), show clean XXX-XXXX
  return raw.replace(/^FM-/, '');
}

export function matchesIdSearch(raw: string | undefined | null, query: string): boolean {
  if (!raw || !query) return false;
  const q = query.toLowerCase().trim();
  const clean = raw.toLowerCase().replace(/^fm-/, '');
  const digits = clean.replace(/[^0-9]/g, '');
  // Match full ID, clean ID, or last 4 digits
  return clean.includes(q) || raw.toLowerCase().includes(q) || digits.endsWith(q) || digits.includes(q);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
