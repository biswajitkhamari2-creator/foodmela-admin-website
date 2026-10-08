import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot, serverTimestamp, addDoc, setDoc, doc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../utils/adminApi';
import { tsToDate, fmtDateTime, formatOrderId } from '../utils/helpers';
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
  const prevMapRef = useRef<Map<string, OrderRecord>>(new Map());

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      const list: OrderRecord[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderRecord));
      
      // Real-time alert when an active order gets converted to prepaid online
      if (prevMapRef.current.size > 0) {
        for (const docChange of snap.docChanges()) {
          if (docChange.type === 'modified') {
            const data = docChange.doc.data() as OrderRecord;
            const prev = prevMapRef.current.get(docChange.doc.id);
            const isNowConverted = Boolean(data.isConvertedFromCOD || data.paymentConversion?.isConvertedFromCOD);
            const wasConverted = Boolean(prev?.isConvertedFromCOD || prev?.paymentConversion?.isConvertedFromCOD);
            if (!wasConverted && isNowConverted) {
              setToast({
                message: `⚡ Payment Alert: Order ${formatOrderId(data.orderId || docChange.doc.id)} converted to PAID ONLINE (₹${data.totalAmount})!`,
                type: 'success'
              });
            }
          }
        }
      }

      const newMap = new Map<string, OrderRecord>();
      list.forEach((o) => newMap.set(o.id, o));
      prevMapRef.current = newMap;

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
      const target = orders.find((o) => o.id === confirm.docId);
      const targetDocId = confirm.docId;
      const orderIdStr = target?.orderId ?? targetDocId;

      // 1. Direct Firestore state update (Instant live sync for customer, rider & admin)
      if (isAccept) {
        await setDoc(doc(db, 'orders', targetDocId), {
          stage: 1,
          status: 'Accepted',
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else if (isDeliver) {
        await setDoc(doc(db, 'orders', targetDocId), {
          stage: 3,
          status: 'Delivered',
          deliveredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        await setDoc(doc(db, 'orders', targetDocId), {
          stage: -1,
          status: 'Cancelled by Admin',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      // 2. Best-effort backend API trigger (catch & suppress 405 / auth errors)
      try {
        const opId = `${confirm.docId}-${confirm.action}-${Date.now()}`;
        const endpoint = isAccept ? '/api/orders/accept'
          : isDeliver ? '/api/orders/update-stage' : '/api/orders/cancel';
        const payload = isAccept
          ? { orderId: orderIdStr, driverName: adminName || 'Admin', opId }
          : isDeliver
            ? { orderId: orderIdStr, newStage: 3, opId }
            : { orderId: orderIdStr };
        await adminFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
      } catch {
        // Ignore background API mirror errors
      }

      // 3. Write Admin Audit Log
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: isAccept ? 'orderAccepted' : isDeliver ? 'orderDeliveredNoOtp' : 'orderRejected',
        targetId: confirm.label,
        targetType: 'order',
        metadata: { docId: confirm.docId },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      }).catch(() => {});

      setToast({
        message: isAccept
          ? `Order ${confirm.label} accepted ✅`
          : isDeliver
          ? `Order ${confirm.label} delivered — no OTP 🏁`
          : `Order ${confirm.label} rejected`,
        type: 'success',
      });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Action failed', type: 'error' });
    }
    setProcessing(false);
    setConfirm(null);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      {/* Top Navigation Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-primary"
            style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>⚡</span> Live Orders
            <span style={{ background: '#fff', color: '#4f46e5', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 800 }}>
              {orders.length}
            </span>
          </button>
          <button
            onClick={() => nav('/archived-orders')}
            className="btn btn-ghost"
            style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.8 }}
          >
            <span>📦</span> Archived Orders
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--card-bg, #fff)', borderRadius: 12, border: '1px solid var(--border-color, #e2e8f0)', marginTop: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>Active Orders Cleared & Ready</h3>
          <p style={{ color: 'var(--text-muted, #64748b)', maxWidth: 520, margin: '0 auto 20px', fontSize: 14 }}>
            All past orders have been safely migrated to the <strong>Archived Orders</strong> section.
            The live database and rider dispatch queue are completely fresh!
          </p>
          <button onClick={() => nav('/archived-orders')} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>📦</span> Open Archived Orders Archive
          </button>
        </div>
      ) : (
        <>
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
                  <th>Payment</th>
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
                  const label = formatOrderId(o.orderId ?? o.id);
                  const actionable = stage === 0 || stage === 1 || stage === 2 || stage === -1;
                  const isConverted = Boolean(o.isConvertedFromCOD || o.paymentConversion?.isConvertedFromCOD);
                  const rawMethod = ((o as any).paymentMethod || (o as any).paymentMode || (o as any).paymentType || 'COD').toUpperCase();
                  const paidStatus = String((o as any).paymentStatus || '').toUpperCase();
                  const addrUpper = String((o as any).address || '').toUpperCase();
                  const isPrepaid = rawMethod.includes('PREPAID') || rawMethod.includes('UPI') || rawMethod.includes('CARD') || rawMethod.includes('PAYU') || isConverted || paidStatus === 'PAID' || addrUpper.includes('PREPAID');
                  return (
                  <tr key={o.id} className="clickable" onClick={() => nav(`/orders/${o.orderId ?? o.id}`)}>
                    <td>
                      <span className="order-id">{label}</span>
                    </td>
                    <td>
                      <div className="cell-main">{freshName(names, o.customerPhone, o.customerName)}</div>
                      <div className="cell-sub">{o.customerPhone || ''}</div>
                    </td>
                    <td>{o.orderCategoryLabel || 'GENERAL'}</td>
                    <td><strong>₹{(o.totalAmount ?? 0).toLocaleString('en-IN')}</strong></td>
                    <td>
                      {isConverted ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '11px', background: '#ede9fe', color: '#6d28d9', padding: '3px 8px', borderRadius: 6, fontWeight: 800 }}>
                          ⚡ COD➔PREPAID
                        </span>
                      ) : isPrepaid ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '11px', background: '#ecfdf5', color: '#059669', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
                          💳 PREPAID ({rawMethod.replace(/ONLINE|PAYU/g, '').trim() || 'UPI'})
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '11px', background: '#fffbeb', color: '#b45309', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
                          💵 COD
                        </span>
                      )}
                    </td>
                    <td><StageBadge stage={stage} /></td>
                    <td>
                      <div className="cell-main">{o.riderName || '—'}</div>
                      <div className="cell-sub">{o.riderId || ''}</div>
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
