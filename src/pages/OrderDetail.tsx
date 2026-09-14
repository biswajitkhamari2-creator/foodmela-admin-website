import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { StageBadge, ConfirmDialog, Toast } from '../components/UI';
import CallLogsPlayer from '../components/CallLogsPlayer';
import type { OrderRecord } from '../types';
import { useCustomerNames, freshName } from '../hooks/useCustomerNames';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export default function OrderDetail() {
  const { orderId } = useParams();
  const { user, adminName } = useAuth();
  const names = useCustomerNames();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | 'deliver' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleOrderAction = async () => {
    if (!confirm || !order) return;
    setProcessing(true);
    try {
      const isAccept = confirm === 'accept';
      const isDeliver = confirm === 'deliver';
      await updateDoc(doc(db, 'orders', order.id), isAccept ? {
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
        targetId: order.orderId ?? order.id,
        targetType: 'order',
        metadata: { docId: order.id },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: isAccept ? 'Order accepted ✅' : isDeliver ? 'Delivery closed — no OTP needed 🏁' : 'Order rejected', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Action failed', type: 'error' });
    }
    setProcessing(false);
    setConfirm(null);
  };

  useEffect(() => {
    if (!orderId) return;
    const unsub = onSnapshot(doc(db, 'orders', orderId), (snap) => {
      if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
      setOrder({ id: snap.id, ...snap.data() } as OrderRecord);
      setLoading(false);
    }, () => { setNotFound(true); setLoading(false); });
    return () => unsub();
  }, [orderId]);

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  if (notFound || !order) return <div className="page"><div className="empty-state"><div className="empty-icon">🧾</div><h3>Order not found</h3><p>Order {orderId} does not exist.</p><Link to="/orders" className="btn btn-primary">Back to Orders</Link></div></div>;

  const createdAt = tsToDate(order.createdAt);
  const updatedAt = tsToDate(order.updatedAt);
  const acceptedAt = tsToDate(order.acceptedAt);
  const deliveredAt = tsToDate(order.deliveredAt);
  const cancelledAt = tsToDate(order.cancelledAt);

  // Build timeline from real timestamps only
  const events: { title: string; time: Date | null; subtitle?: string; success: boolean }[] = [];
  if (createdAt) events.push({ title: 'ORDER CREATED', time: createdAt, success: true });
  if (acceptedAt) events.push({ title: 'ORDER ACCEPTED', time: acceptedAt, subtitle: order.riderName ? `Partner: ${order.riderName}${order.riderId ? ` (${(order.riderId as string).replace(/^FM-/, '')})` : ''}` : undefined, success: true });
  else if ((order.stage ?? 0) >= 1 && order.riderName && updatedAt) events.push({ title: 'ORDER ACCEPTED', time: updatedAt, subtitle: `Partner: ${order.riderName}${order.riderId ? ` (${(order.riderId as string).replace(/^FM-/, '')})` : ''}`, success: true });
  if (order.stage === 2 && updatedAt) events.push({ title: 'OUT FOR DELIVERY', time: updatedAt, success: true });
  if (order.stage === 3) {
    const dt = deliveredAt ?? updatedAt;
    if (dt) events.push({ title: 'DELIVERED', time: dt, success: true });
  }
  if (order.stage === -1) {
    const dt = cancelledAt ?? updatedAt;
    if (dt) events.push({ title: 'CANCELLED', time: dt, subtitle: order.status, success: false });
  }

  const items = Array.isArray(order.items) ? order.items as Record<string, unknown>[] : [];
  const summary = order.itemsSummary ?? '';

  return (
    <div className="page">
      <Link to="/orders" className="back-link">← Back to Orders</Link>

      <Card title="Order Information">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 700 }}>{(order.orderId ?? order.id ?? '').replace(/^FM-/, '')}</span>
          <StageBadge stage={order.stage ?? 0} />
        </div>
        {(order.stage === 0 || order.stage === 1 || order.stage === 2 || order.stage === -1) && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {(order.stage === 0 || order.stage === -1) && (
              <button className="btn btn-success" disabled={processing} onClick={() => setConfirm('accept')}>✅ Accept Order</button>
            )}
            {(order.stage === 1 || order.stage === 2) && (
              <button className="btn btn-primary" disabled={processing} onClick={() => setConfirm('deliver')}>🏁 Close Delivery (no OTP)</button>
            )}
            {(order.stage === 0 || order.stage === 1 || order.stage === 2) && (
              <button className="btn btn-danger" disabled={processing} onClick={() => setConfirm('reject')}>🚫 Reject Order</button>
            )}
          </div>
        )}
        <Row label="Order ID" value={(order.orderId ?? order.id ?? '').replace(/^FM-/, '')} />
        <Row label="Category" value={`${order.orderCategoryLabel ?? 'GENERAL'} (${order.orderCategory ?? 'general'})`} />
        <Row label="Status" value={order.status || '—'} />
        <Row label="Stage" value={String(order.stage ?? 0)} />
        <Row label="Created" value={fmtDateTime(createdAt)} />
        <Row label="Last Updated" value={fmtDateTime(updatedAt)} />
        <Row label="Delivery OTP" value={order.deliveryOtp ?? '—'} />
        {order.pincode && <Row label="Pincode" value={order.pincode} />}
        {order.locality && <Row label="Locality" value={order.locality} />}
      </Card>

      <Card title="Order Timeline / Audit Trail">
        {events.length === 0 ? <p className="muted">No timeline events yet</p> : (
          <div className="timeline">
            {events.map((ev, i) => (
              <div key={i} className="timeline-row">
                <div className="timeline-dot" style={{ background: ev.success ? '#059669' : '#DC2626' }} />
                {i < events.length - 1 && <div className="timeline-line" />}
                <div className="timeline-content">
                  <strong style={{ color: ev.success ? '#059669' : '#DC2626', fontSize: 11, letterSpacing: 0.5 }}>{ev.title}</strong>
                  <span className="timeline-time">{fmtDateTime(ev.time)}</span>
                  {ev.subtitle && <span className="timeline-sub">{ev.subtitle}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Customer Information">
        <Row label="Name" value={order ? freshName(names, order.customerPhone, order.customerName) : '—'} />
        <Row label="Phone" value={order.customerPhone || '—'} />
        <Row label="Address" value={order.address || '—'} />
      </Card>

      <Card title="Order Items">
        {items.length > 0 ? (
          items.map((item, i) => {
            const name = (item.itemName as string) ?? (item.name as string) ?? (item.itemId as string) ?? 'Item';
            const qty = (item.quantity as number) ?? 1;
            const price = (item.price as number) ?? (item.unitPrice as number) ?? 0;
            const unit = (item.unit as string) ?? '';
            return (
              <div key={i} className="item-row">
                <div>
                  <strong>{name}</strong>
                  {unit && <span className="muted"> — {unit}</span>}
                </div>
                <div className="item-pricing">
                  <span>x{qty}</span>
                  <span>₹{price}</span>
                  <strong>₹{price * qty}</strong>
                </div>
              </div>
            );
          })
        ) : summary ? <p>{summary}</p> : <p className="muted">No item details available</p>}
      </Card>

      <Card title="Delivery Partner">
        {!order.riderId && !order.riderName ? (
          <div className="info-banner">No partner assigned yet</div>
        ) : (
          <>
            <Row label="Name" value={order.riderName ?? '—'} />
            <Row label="Partner ID" value={(order.riderId ?? '—').replace(/^FM-/, '')} />
            <Row label="Accepted At" value={fmtDateTime(acceptedAt)} />
          </>
        )}
      </Card>

      <CallLogsPlayer orderId={order.id} />

      <Card title="Payment & Charges">
        <Row label="Total Amount" value={`₹${(order.totalAmount ?? 0).toLocaleString('en-IN')}`} />
        <Row label="Delivery Fee" value={`₹${order.deliveryFee ?? 0}`} />
        <Row label="Discount" value={`₹${order.discount ?? 0}`} />
        <Row label="Tax" value={`₹${order.tax ?? 0}`} />
        <Row label="Payment Method" value={order.paymentMethod ?? '—'} />
        <Row label="Payment Status" value={order.paymentStatus ?? '—'} />
        {order.specialInstructions && <Row label="Instructions" value={order.specialInstructions} />}
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'accept' ? 'Accept this order?' : confirm === 'deliver' ? 'Close delivery without OTP?' : 'Reject this order?'}
        message={confirm === 'accept'
          ? 'This order will move to ACCEPTED. Use this to accept a new order, or to re-accept a previously rejected one.'
          : confirm === 'deliver'
            ? 'This active delivery will be marked DELIVERED immediately — no customer OTP required. The rider app will stop tracking it.'
            : 'This order will move to CANCELLED / REJECTED. Use this to reject a new order, or to reject a previously accepted one.'}
        confirmLabel={confirm === 'accept' ? 'Accept Order' : confirm === 'deliver' ? 'Close Delivery' : 'Reject Order'}
        confirmColor={confirm === 'accept' ? '#059669' : confirm === 'deliver' ? '#F15A24' : '#DC2626'}
        onConfirm={handleOrderAction}
        onCancel={() => setConfirm(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
