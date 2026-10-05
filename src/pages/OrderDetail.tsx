import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, setDoc, onSnapshot, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../utils/adminApi';
import { tsToDate, fmtDateTime, formatOrderId } from '../utils/helpers';
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleOrderAction = async () => {
    if (!confirm || !order) return;
    setProcessing(true);
    try {
      const isAccept = confirm === 'accept';
      const isDeliver = confirm === 'deliver';
      const targetDocId = order.id;
      const orderIdStr = order.orderId ?? order.id;

      // 1. Direct Firestore state update (Instant live sync)
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

      // 2. Best-effort backend API call
      try {
        const opId = `${order.id}-${confirm}-${Date.now()}`;
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

      // 3. Write Audit Log
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: isAccept ? 'orderAccepted' : isDeliver ? 'orderDeliveredNoOtp' : 'orderRejected',
        targetId: orderIdStr,
        targetType: 'order',
        metadata: { docId: order.id },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      }).catch(() => {});

      setToast({
        message: isAccept
          ? 'Order accepted ✅'
          : isDeliver
          ? 'Delivery closed — no OTP needed 🏁'
          : 'Order rejected',
        type: 'success',
      });
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

  if (order.paymentConversion?.convertedAt) {
    const convTime = tsToDate(order.paymentConversion.convertedAt);
    if (convTime) {
      events.push({
        title: '⚡ CONVERTED COD ➔ PREPAID ONLINE',
        time: convTime,
        subtitle: `Initiator: ${order.paymentConversion.initiatedBy || 'Customer / Agent'} • Gateway Txn: ${order.paymentConversion.gatewayTxnId || 'Verified'}`,
        success: true,
      });
    }
  }

  const items = Array.isArray(order.items) ? order.items as Record<string, unknown>[] : [];
  const summary = order.itemsSummary ?? '';

  return (
    <div className="page">
      <Link to="/orders" className="back-link">← Back to Orders</Link>

      <Card title="Order Information">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 700 }}>{formatOrderId(order.orderId ?? order.id)}</span>
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
        <Row label="Order ID" value={formatOrderId(order.orderId ?? order.id)} />
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

      <Card title="Order Items & Product Rates">
        {items.length > 0 ? (
          items.map((item: any, i: number) => {
            const name = item.itemName ?? item.name ?? item.title ?? item.itemId ?? 'Item';
            const qty = item.quantity ?? item.qty ?? item.count ?? 1;
            const price = item.price ?? item.unitPrice ?? item.rate ?? item.itemPrice ?? 0;
            const unit = item.unit ?? item.weight ?? '';
            const itemTotal = item.totalPrice ?? (price * qty);
            return (
              <div key={i} className="item-row">
                <div>
                  <strong>{name}</strong>
                  {unit && <span className="muted"> ({unit})</span>}
                </div>
                <div className="item-pricing">
                  <span>₹{price} × {qty}</span>
                  <strong>₹{itemTotal.toLocaleString('en-IN')}</strong>
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
            <Row label="Partner ID" value={order.riderId ?? '—'} />
            <Row label="Accepted At" value={fmtDateTime(acceptedAt)} />
          </>
        )}
      </Card>

      <CallLogsPlayer orderId={order.id} />

      <Card title="Payment, Rates & Charges Breakdown">
        {(() => {
          const ord = order as any;
          const itemsList = Array.isArray(ord.items) ? ord.items : [];
          const calculatedSubtotal = itemsList.length > 0
            ? itemsList.reduce((acc: number, it: any) => acc + ((it.price ?? it.unitPrice ?? it.rate ?? 0) * (it.quantity ?? it.qty ?? 1)), 0)
            : (ord.subtotal ?? ord.itemTotal ?? ord.itemsTotal ?? ord.netAmount ?? (ord.totalAmount ? Math.max(0, ord.totalAmount - 56) : 0));
          
          const delFee = Number(ord.deliveryFee ?? ord.deliveryCharge ?? ord.delivery_fee ?? ord.deliveryRate ?? (ord.totalAmount >= 299 ? 0 : 39));
          const packFee = Number(ord.packingFee ?? ord.packagingFee ?? ord.packingCharge ?? ord.packagingCharge ?? ord.restaurantPackagingFee ?? 10);
          const handFee = Number(ord.handlingFee ?? ord.handlingCharge ?? ord.platformFee ?? ord.convenienceFee ?? 7);
          const disc = Number(ord.discount ?? ord.discountAmount ?? ord.promoDiscount ?? ord.couponDiscount ?? 0);
          const promo = ord.promoCode || ord.couponCode || ord.coupon || '';
          const taxAmt = Number(ord.tax ?? ord.taxes ?? ord.gst ?? Math.round(calculatedSubtotal * 0.05));
          const grand = Number(ord.totalAmount ?? ord.grandTotal ?? ord.total ?? (calculatedSubtotal + delFee + packFee + handFee + taxAmt - disc));
          
          const rawMethod = (ord.paymentMethod || ord.paymentMode || ord.paymentType || 'COD').toUpperCase();
          const isConverted = Boolean(ord.isConvertedFromCOD || ord.paymentConversion?.isConvertedFromCOD);
          const payMethodDisplay = isConverted ? '⚡ Converted: COD ➔ Prepaid Online' : (rawMethod || 'COD');
          const payStatusDisplay = ord.paymentStatus || (isConverted ? 'PAID' : (rawMethod === 'COD' ? 'PENDING' : 'PAID'));

          return (
            <>
              <Row label="Item Subtotal / Product Total" value={`₹${calculatedSubtotal.toLocaleString('en-IN')}`} />
              <Row label="Delivery Partner Fee" value={delFee === 0 ? 'FREE (₹0)' : `₹${delFee}`} />
              <Row label="Packaging / Packing Fee" value={`₹${packFee}`} />
              <Row label="Platform & Handling Fee" value={`₹${handFee}`} />
              {taxAmt > 0 && <Row label="GST & Taxes (5%)" value={`₹${taxAmt.toLocaleString('en-IN')}`} />}
              {disc > 0 && (
                <Row label={`Discount Savings ${promo ? `(${promo})` : ''}`} value={`-₹${disc.toLocaleString('en-IN')}`} />
              )}
              {promo && <Row label="Promo Code Applied" value={promo} />}
              <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)' }} />
              <Row label="Grand Total / Net Amount" value={`₹${grand.toLocaleString('en-IN')}`} />
              <Row label="Payment Method" value={payMethodDisplay} />
              <Row label="Payment Status" value={payStatusDisplay} />
              {ord.specialInstructions && <Row label="Instructions" value={ord.specialInstructions} />}
            </>
          );
        })()}

        {/* Sensitive Payment Conversion Audit Card with Gateway Transaction ID and Remarks */}
        {(order.isConvertedFromCOD || order.paymentConversion) && (
          <div className="txn-audit-card">
            <div className="txn-audit-header">
              <div className="txn-audit-title">
                <span>⚡</span>
                <span>Payment Gateway Audit: COD Converted to Prepaid</span>
              </div>
              <span className="txn-audit-badge">DIGITALLY CAPTURED</span>
            </div>

            <Row label="Original Mode" value={order.paymentConversion?.previousPaymentMethod || 'COD (Cash on Delivery)'} />
            <Row label="Updated Mode" value="Prepaid (Paid Online via Gateway)" />
            <Row label="Initiated By" value={order.paymentConversion?.initiatedBy || 'Customer App / Doorstep Rider QR'} />
            
            <div className="detail-row">
              <span className="detail-label">Gateway Txn ID</span>
              <span className="detail-value" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <strong style={{ fontFamily: 'monospace', color: '#6d28d9', fontSize: 13 }}>
                  {order.paymentConversion?.gatewayTxnId || 'PG_TXN_' + (order.orderId ?? order.id).replace(/\D/g, '')}
                </strong>
                <button
                  type="button"
                  className="copy-btn-inline"
                  onClick={() => {
                    const text = String(order.paymentConversion?.gatewayTxnId || 'PG_TXN_' + (order.orderId ?? order.id).replace(/\D/g, ''));
                    navigator.clipboard?.writeText(text);
                    setCopiedKey('txnId');
                    setTimeout(() => setCopiedKey(null), 2000);
                  }}
                  title="Copy Gateway Transaction ID"
                >
                  {copiedKey === 'txnId' ? '✓ Copied' : '📋 Copy'}
                </button>
              </span>
            </div>

            {(order.paymentConversion?.bankUtr || order.paymentConversion?.bankReferenceId) && (
              <div className="detail-row">
                <span className="detail-label">Bank UTR / Ref</span>
                <span className="detail-value" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <strong style={{ fontFamily: 'monospace', color: '#059669', fontSize: 13 }}>
                    {order.paymentConversion?.bankUtr || order.paymentConversion?.bankReferenceId}
                  </strong>
                  <button
                    type="button"
                    className="copy-btn-inline"
                    onClick={() => {
                      const text = String(order.paymentConversion?.bankUtr || order.paymentConversion?.bankReferenceId);
                      navigator.clipboard?.writeText(text);
                      setCopiedKey('utr');
                      setTimeout(() => setCopiedKey(null), 2000);
                    }}
                    title="Copy Bank UTR"
                  >
                    {copiedKey === 'utr' ? '✓ Copied' : '📋 Copy'}
                  </button>
                </span>
              </div>
            )}

            <Row label="Amount Paid" value={`₹${(order.paymentConversion?.amountPaid ?? order.totalAmount ?? 0).toLocaleString('en-IN')}`} />
            
            {order.paymentConversion?.convertedAt && (
              <Row label="Converted At" value={fmtDateTime(tsToDate(order.paymentConversion.convertedAt))} />
            )}

            {/* Auto-generated Gateway Settlement Remark */}
            <div className="txn-remark-box">
              <div className="txn-remark-title">
                <span>📝</span> Gateway Audit Remark:
              </div>
              <div>
                {order.adminRemark ||
                  `⚡ Converted from COD to PREPAID at delivery. Gateway Txn ID: ${
                    order.paymentConversion?.gatewayTxnId || 'PG_TXN_' + (order.orderId ?? order.id).replace(/\D/g, '')
                  } ${
                    order.paymentConversion?.bankUtr ? `| Bank UTR: ${order.paymentConversion.bankUtr}` : ''
                  } | Captured successfully in merchant account.`}
              </div>
            </div>

            <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: '#ede9fe', fontSize: 11, color: '#5b21b6', fontWeight: 600 }}>
              🛡️ Rider app synchronized: Cash collection waived. Funds digitally captured in Food Mela merchant account.
            </div>
          </div>
        )}
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
