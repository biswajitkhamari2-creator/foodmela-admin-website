import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { StageBadge, EmptyState, Pagination, ConfirmDialog, Toast } from '../components/UI';
import type { OrderRecord } from '../types';
import { useCustomerNames, freshName } from '../hooks/useCustomerNames';

const PAGE_SIZE = 20;

export default function Orders({ globalSearch }: { globalSearch?: string }) {
  const nav = useNavigate();
  const { user, adminName } = useAuth();
  const names = useCustomerNames();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ docId: string; label: string; action: 'accept' | 'reject' | 'deliver' } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      const list: OrderRecord[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderRecord));
      setOrders(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    const isDigits = /^\d{1,4}$/.test(s);
    return orders.filter((o) => {
      const stage = o.stage ?? 0;
      const cat = (o.orderCategory ?? '').toLowerCase();
      const hay = `${o.orderId ?? o.id} ${o.customerName ?? ''} ${o.customerPhone ?? ''} ${o.riderName ?? ''} ${o.riderId ?? ''} ${cat}`.toLowerCase();
      if (stageFilter !== 'all' && String(stage) !== stageFilter) return false;
      if (categoryFilter !== 'all' && cat !== categoryFilter) return false;
      if (s) {
        if (hay.includes(s)) { /* pass */ }
        else if (isDigits) {
          const orderDigits = (o.orderId ?? o.id ?? '').replace(/[^0-9]/g, '');
          const partnerDigits = (o.riderId ?? '').replace(/[^0-9]/g, '');
          if (!(orderDigits.includes(s) || orderDigits.endsWith(s) || partnerDigits.includes(s) || partnerDigits.endsWith(s))) return false;
        } else return false;
      }
      const createdAt = tsToDate(o.createdAt);
      if (dateFrom && createdAt && createdAt < new Date(dateFrom)) return false;
      if (dateTo && createdAt && createdAt > new Date(new Date(dateTo).getTime() + 86400000 - 1)) return false;
      return true;
    });
  }, [orders, search, globalSearch, stageFilter, categoryFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, globalSearch, stageFilter, categoryFilter, dateFrom, dateTo]);

  const handleOrderAction = async () => {
    if (!confirm) return;
    setProcessing(true);
    try {
      const isAccept = confirm.action === 'accept';
      const isDeliver = confirm.action === 'deliver';
      await updateDoc(doc(db, 'orders', confirm.docId), isAccept ? {
        stage: 1,
        status: 'Accepted by Admin ✅',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } : isDeliver ? {
        stage: 3,
        status: 'Delivered by Admin 🏁 (no OTP)',
        deliveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } : {
        stage: -1,
        status: 'Rejected by Admin 🚨',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: isAccept ? 'orderAccepted' : isDeliver ? 'orderDeliveredNoOtp' : 'orderRejected',
        targetId: confirm.label,
        targetType: 'order',
        metadata: { docId: confirm.docId },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: isAccept ? `Order ${confirm.label} accepted ✅` : isDeliver ? `Order ${confirm.label} delivered — no OTP 🏁` : `Order ${confirm.label} rejected`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Action failed', type: 'error' });
    }
    setProcessing(false);
    setConfirm(null);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  if (orders.length === 0) return <div className="page"><EmptyState icon="🧾" title="No orders yet" subtitle="Orders will appear here as customers place them." /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search by 4-digit ID, customer, partner..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="date-input" />
          <span className="date-sep">—</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="date-input" />
          {(dateFrom || dateTo) && <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>}
        </div>
        <div className="filters-row">
          <span className="filter-label">Status:</span>
          {[
            ['all', 'All'], ['0', 'Pending'], ['1', 'Accepted'], ['2', 'Out for Delivery'], ['3', 'Delivered'], ['-1', 'Cancelled'],
          ].map(([v, l]) => (
            <button key={v} className={`chip ${stageFilter === v ? 'chip-active' : ''}`} onClick={() => setStageFilter(v)}>{l}</button>
          ))}
          <span className="filter-label">Category:</span>
          {[
            ['all', 'All'], ['grocery', 'Grocery'], ['cooked_food', 'Cooked'], ['vegetables', 'Vegetables'],
          ].map(([v, l]) => (
            <button key={v} className={`chip ${categoryFilter === v ? 'chip-active' : ''}`} onClick={() => setCategoryFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matching orders" subtitle="Try adjusting your search or filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Partner</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => {
                  const stage = o.stage ?? 0;
                  const docId = o.id;
                  const label = (o.orderId ?? o.id ?? '').replace(/^FM-/, '');
                  const actionable = stage === 0 || stage === 1 || stage === 2 || stage === -1;
                  return (
                  <tr key={o.id} className="clickable" onClick={() => nav(`/orders/${o.orderId ?? o.id}`)}>
                    <td><span className="order-id">{label}</span></td>
                    <td>
                      <div className="cell-main">{freshName(names, o.customerPhone, o.customerName)}</div>
                      <div className="cell-sub">{o.customerPhone || ''}</div>
                    </td>
                    <td>{o.orderCategoryLabel || 'GENERAL'}</td>
                    <td><strong>₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</strong></td>
                    <td><StageBadge stage={stage} /></td>
                    <td>
                      <div className="cell-main">{o.riderName || '—'}</div>
                      <div className="cell-sub">{(o.riderId || '').replace(/^FM-/, '')}</div>
                    </td>
                    <td className="cell-sub">{fmtDateTime(tsToDate(o.createdAt))}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {actionable ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(stage === 0 || stage === -1) && (
                            <button className="btn btn-sm btn-success" disabled={processing} onClick={() => setConfirm({ docId, label, action: 'accept' })}>Accept</button>
                          )}
                          {(stage === 1 || stage === 2) && (
                            <button className="btn btn-sm btn-primary" disabled={processing} onClick={() => setConfirm({ docId, label, action: 'deliver' })}>Close (no OTP)</button>
                          )}
                          {(stage === 0 || stage === 1 || stage === 2) && (
                            <button className="btn btn-sm btn-danger" disabled={processing} onClick={() => setConfirm({ docId, label, action: 'reject' })}>Reject</button>
                          )}
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'accept' ? `Accept order ${confirm?.label}?` : confirm?.action === 'deliver' ? `Close delivery ${confirm?.label} without OTP?` : `Reject order ${confirm?.label}?`}
        message={confirm?.action === 'accept'
          ? 'This order will move to ACCEPTED. Use this to accept a new order, or to re-accept a previously rejected one.'
          : confirm?.action === 'deliver'
            ? 'This active delivery will be marked DELIVERED immediately — no customer OTP required. The rider app will stop tracking it.'
            : 'This order will move to CANCELLED / REJECTED. Use this to reject a new order, or to reject a previously accepted one.'}
        confirmLabel={confirm?.action === 'accept' ? 'Accept Order' : confirm?.action === 'deliver' ? 'Close Delivery' : 'Reject Order'}
        confirmColor={confirm?.action === 'accept' ? '#059669' : confirm?.action === 'deliver' ? '#F15A24' : '#DC2626'}
        onConfirm={handleOrderAction}
        onCancel={() => setConfirm(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
