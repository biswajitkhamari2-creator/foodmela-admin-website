import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

/** Normalize Indian mobile numbers: strip +91/91 so all formats merge. */
export function normPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('911')) return digits.slice(3);
  return digits;
}

function isPlaceholder(n: string): boolean {
  const t = n.trim().toLowerCase();
  return t === '' || t === '—' || t === '-' || t === 'customer' || t === 'user' || t === 'food mela user';
}

/**
 * LIVE customer-name map: normalized phone → fresh profile name from
 * users/{phone} docs. Every admin page (Dashboard, Orders, OrderDetail,
 * Customers) resolves names through this, so a profile rename reflects
 * EVERYWHERE instantly — never a stale order-snapshot name.
 *
 * Priority: users doc (fresh) wins; order history fills gaps only.
 */
function tsMillis(v: unknown): number {
  try {
    if (!v) return 0;
    if (typeof (v as { toMillis?: unknown }).toMillis === 'function') {
      return ((v as { toMillis: () => number }).toMillis() as number) || 0;
    }
    if (typeof v === 'string') {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof v === 'number') return v;
  } catch { /* ignore */ }
  return 0;
}

export function useCustomerNames() {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const un1 = onSnapshot(collection(db, 'users'), (snap) => {
      // Newest write wins per phone — a fresh rename always beats stale docs.
      const best = new Map<string, { name: string; ts: number }>();
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if ((data.role as string) !== 'customer') return;
        const clean = normPhone(d.id) || normPhone(data.phone);
        if (!clean) return;
        const name = String(data.name ?? data.fullName ?? '').trim();
        if (!name) return;
        const ts = tsMillis(data.updatedAt);
        const prev = best.get(clean);
        if (!prev) {
          best.set(clean, { name, ts });
        } else if (isPlaceholder(prev.name) && !isPlaceholder(name)) {
          best.set(clean, { name, ts });
        } else if (!isPlaceholder(name) && ts >= prev.ts) {
          best.set(clean, { name, ts });
        }
      });
      const next = new Map<string, string>();
      best.forEach((v, k) => next.set(k, v.name));
      setNames(next);
    }, () => {});
    return () => un1();
  }, []);

  return names;
}

/** Resolve the freshest name: live profile map first, order snapshot last. */
export function freshName(names: Map<string, string>, phone: unknown, fallback: unknown): string {
  const clean = normPhone(phone);
  if (clean && names.has(clean)) return names.get(clean)!;
  const fb = String(fallback ?? '').trim();
  return fb || '—';
}
