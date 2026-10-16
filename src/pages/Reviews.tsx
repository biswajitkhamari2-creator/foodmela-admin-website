import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate, fmtDateTime, formatOrderId } from '../utils/helpers';
import { EmptyState, Pagination, Toast } from '../components/UI';
import type { OrderRecord } from '../types';

const PAGE_SIZE = 20;

interface RatedOrder extends OrderRecord {
  riderRating?: number;
  riderFeedback?: string[];
  foodRating?: number;
  foodFeedback?: string[];
  ratedAt?: unknown;
}

function Stars({ value }: { value?: number }) {
  if (value == null) return <span style={{ color: '#999' }}>—</span>;
  return (
    <span style={{ color: '#F5A623', fontWeight: 800, whiteSpace: 'nowrap' }}>
      {'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}
      <span style={{ color: '#333', marginLeft: 4 }}>{value}</span>
    </span>
  );
}

export default function Reviews({ globalSearch }: { globalSearch?: string }) {
  const [orders, setOrders] = useState<RatedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minStars, setMinStars] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: RatedOrder[] = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as RatedOrder))
          .filter((o) => o.riderRating != null || o.foodRating != null);
        // Realtime alert when a brand-new rating lands
        if (prevIdsRef.current.size > 0) {
          for (const o of list) {
            if (!prevIdsRef.current.has(o.id)) {
              setToast({
                message: `⭐ New review: Order ${formatOrderId(o.orderId || o.id)} — rider ${o.riderRating ?? '—'}★, food ${o.foodRating ?? '—'}★`,
                type: 'success',
              });
              break;
            }
          }
        }
        prevIdsRef.current = new Set(list.map((o) => o.id));
        setOrders(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    return orders.filter((o) => {
      if (minStars !== 'all') {
        const best = Math.max(o.riderRating ?? 0, o.foodRating ?? 0);
        if (best < Number(minStars)) return false;
      }
      if (s) {
        const hay =
          `${o.orderId ?? o.id} ${o.customerName ?? ''} ${o.customerPhone ?? ''} ${o.riderName ?? ''} ${(o.riderFeedback ?? []).join(' ')} ${(o.foodFeedback ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [orders, search, globalSearch, minStars]);

  const avg = useMemo(() => {
    const rs = orders.map((o) => o.riderRating).filter((v): v is number => v != null);
    const fs = orders.map((o) => o.foodRating).filter((v): v is number => v != null);
    const mean = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—');
    return { rider: mean(rs), food: mean(fs), count: orders.length };
  }, [orders]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page">
      <div className="stat-row" style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div className="stat-card" style={{ flex: 1 }}><div className="stat-label">Total reviews</div><div className="stat-value">{avg.count}</div></div>
        <div className="stat-card" style={{ flex: 1 }}><div className="stat-label">Avg rider rating</div><div className="stat-value">⭐ {avg.rider}</div></div>
        <div className="stat-card" style={{ flex: 1 }}><div className="stat-label">Avg food rating</div><div className="stat-value">⭐ {avg.food}</div></div>
      </div>

      <div className="toolbar" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Search order, customer, rider, feedback…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: 1 }}
        />
        <select className="input" value={minStars} onChange={(e) => { setMinStars(e.target.value); setPage(1); }} style={{ maxWidth: 180 }}>
          <option value="all">All ratings</option>
          <option value="4">4★ & up</option>
          <option value="3">3★ & up</option>
          <option value="2">2★ & below</option>
        </select>
      </div>

      {loading ? (
        <div className="card">Loading reviews…</div>
      ) : pageRows.length === 0 ? (
        <EmptyState icon="⭐" title="No reviews yet" subtitle="Customer ratings appear here in real time after delivery." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Rider</th>
                <th>Rider ★</th>
                <th>Food ★</th>
                <th>Feedback</th>
                <th>Rated at</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 700 }}>{formatOrderId(o.orderId || o.id)}</td>
                  <td>{o.customerName || o.customerPhone || '—'}</td>
                  <td>{o.riderName || '—'}</td>
                  <td><Stars value={o.riderRating} /></td>
                  <td><Stars value={o.foodRating} /></td>
                  <td style={{ maxWidth: 260, fontSize: 12, color: '#555' }}>
                    {[...(o.riderFeedback ?? []), ...(o.foodFeedback ?? [])].join(' · ') || '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(tsToDate(o.ratedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={pages} onPageChange={setPage} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
