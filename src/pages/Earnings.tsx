import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState } from '../components/UI';
import type { OrderRecord } from '../types';

const EARNING_PER_DELIVERY = 40;

export default function Earnings() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'orders'), where('stage', '==', 3));
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderRecord)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const earnings = useMemo(() => {
    // Only delivered, non-cancelled, non-deleted orders
    const valid = orders.filter((o) => !o.isDeleted && !(o.status ?? '').toLowerCase().includes('cancel'));
    const byPartner = new Map<string, { name: string; count: number; total: number }>();
    for (const o of valid) {
      const pid = o.riderId ?? 'Unknown';
      const name = o.riderName ?? pid;
      const entry = byPartner.get(pid) ?? { name, count: 0, total: 0 };
      entry.count++;
      entry.total += EARNING_PER_DELIVERY;
      byPartner.set(pid, entry);
    }
    return { valid, byPartner };
  }, [orders]);

  const totalEarnings = earnings.valid.length * EARNING_PER_DELIVERY;

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="earnings-summary">
        <div className="earnings-card">
          <span>Total Deliveries</span>
          <strong>{earnings.valid.length}</strong>
        </div>
        <div className="earnings-card">
          <span>Total Earnings Paid</span>
          <strong>₹{totalEarnings.toLocaleString('en-IN')}</strong>
        </div>
        <div className="earnings-card">
          <span>Per Delivery</span>
          <strong>₹{EARNING_PER_DELIVERY}</strong>
        </div>
      </div>

      <p className="card-hint" style={{ marginBottom: 16 }}>
        Earning is credited only after successful delivery (stage 3). Each delivered order = ₹{EARNING_PER_DELIVERY}. No duplicate credits.
      </p>

      {earnings.byPartner.size > 0 && (
        <>
          <h3 className="section-title">Earnings by Partner</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Partner</th><th>Partner ID</th><th>Deliveries</th><th>Total Earnings</th></tr></thead>
              <tbody>
                {Array.from(earnings.byPartner.entries()).map(([pid, data]) => (
                  <tr key={pid}>
                    <td>{data.name}</td>
                    <td><span className="partner-id">{pid.replace(/^FM-/, '')}</span></td>
                    <td>{data.count}</td>
                    <td><strong>₹{data.total.toLocaleString('en-IN')}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="section-title">Delivery History</h3>
      {earnings.valid.length === 0 ? <EmptyState icon="💰" title="No earnings yet" subtitle="Earnings will appear after partners successfully deliver orders." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Order ID</th><th>Partner</th><th>Partner ID</th><th>Earning</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {earnings.valid.map((o) => (
                <tr key={o.id}>
                  <td><span className="order-id">{(o.orderId ?? o.id ?? '').replace(/^FM-/, '')}</span></td>
                  <td>{o.riderName ?? '—'}</td>
                  <td><span className="partner-id">{(o.riderId ?? '—').replace(/^FM-/, '')}</span></td>
                  <td><strong>₹{EARNING_PER_DELIVERY}</strong></td>
                  <td className="cell-sub">{fmtDateTime(tsToDate(o.deliveredAt ?? o.updatedAt ?? o.createdAt))}</td>
                  <td><span className="badge badge-active">DELIVERED</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
