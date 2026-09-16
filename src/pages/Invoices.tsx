import { useEffect, useMemo, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { StageBadge, EmptyState, Pagination } from '../components/UI';
import type { OrderRecord } from '../types';
import { useCustomerNames, freshName } from '../hooks/useCustomerNames';

const PAGE_SIZE = 20;

interface BillLine { subtotal: number; deliveryFee: number; platformFee: number; total: number }

function billOf(o: OrderRecord): BillLine {
  const total = Number(o.totalAmount ?? 0);
  const platformFee = total > 0 ? 7 : 0;
  const deliveryFee = total >= 299 || total === 0 ? 0 : 30;
  const subtotal = Math.max(0, total - platformFee - deliveryFee);
  return { subtotal, deliveryFee, platformFee, total };
}

function isCod(o: OrderRecord): boolean {
  const pm = (o.paymentMethod ?? '').toLowerCase();
  if (pm.includes('cod') || pm.includes('cash')) return true;
  if (pm.includes('upi') || pm.includes('online') || pm.includes('prepaid') || pm.includes('paytm')) return false;
  return (o.address ?? '').toUpperCase().includes('[COD]');
}

function itemsText(o: OrderRecord): string {
  const it = o.items;
  if (Array.isArray(it) && it.length > 0) {
    return it.map((x) => {
      const r = x as Record<string, unknown>;
      const qty = Number(r.quantity ?? r.qty ?? 1);
      return `${qty}x ${String(r.name ?? r.itemId ?? 'Item')}`;
    }).join(', ');
  }
  if (typeof it === 'string' && it.trim()) return it;
  return o.itemsSummary || '—';
}

function invoiceNo(o: OrderRecord): string {
  return `INV-${(o.orderId ?? o.id ?? '').replace(/^FM-/, '')}`;
}

export default function Invoices({ globalSearch }: { globalSearch?: string }) {
  const names = useCustomerNames();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [payFilter, setPayFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<OrderRecord | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      const list: OrderRecord[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderRecord));
      setOrders(list.filter((o) => !o.isDeleted));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    const isDigits = /^\d{1,4}$/.test(s);
    return orders.filter((o) => {
      const stage = o.stage ?? 0;
      if (statusFilter !== 'all') {
        if (statusFilter === 'paid' && stage !== 3) return false;
        if (statusFilter === 'pending' && stage !== 0 && stage !== 1 && stage !== 2) return false;
        if (statusFilter === 'cancelled' && stage !== -1) return false;
      }
      if (payFilter !== 'all') {
        const cod = isCod(o);
        if (payFilter === 'cod' && !cod) return false;
        if (payFilter === 'prepaid' && cod) return false;
      }
      if (s) {
        const hay = `${invoiceNo(o)} ${o.orderId ?? o.id} ${o.customerName ?? ''} ${o.customerPhone ?? ''}`.toLowerCase();
        if (hay.includes(s)) { /* pass */ }
        else if (isDigits) {
          const digits = (o.orderId ?? o.id ?? '').replace(/[^0-9]/g, '');
          if (!(digits.includes(s) || digits.endsWith(s))) return false;
        } else return false;
      }
      const createdAt = tsToDate(o.createdAt);
      if (dateFrom && createdAt && createdAt < new Date(dateFrom)) return false;
      if (dateTo && createdAt && createdAt > new Date(new Date(dateTo).getTime() + 86400000 - 1)) return false;
      return true;
    });
  }, [orders, search, globalSearch, statusFilter, payFilter, dateFrom, dateTo]);

  // ── Summary stats (tracking ke liye) ──
  const stats = useMemo(() => {
    let delivered = 0, pending = 0, today = 0, codTotal = 0, prepaidTotal = 0, count = 0;
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    for (const o of filtered) {
      if (o.stage === -1) continue;
      count++;
      const t = Number(o.totalAmount ?? 0);
      const cod = isCod(o);
      if (cod) codTotal += t; else prepaidTotal += t;
      if (o.stage === 3) delivered += t;
      else pending += t;
      const d = tsToDate(o.createdAt);
      if (d && d >= startToday && o.stage !== -1) today += t;
    }
    return { delivered, pending, today, codTotal, prepaidTotal, count };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, globalSearch, statusFilter, payFilter, dateFrom, dateTo]);

  const exportCsv = () => {
    const rows = [['Invoice No', 'Order ID', 'Date', 'Customer', 'Phone', 'Items', 'Subtotal', 'Delivery', 'Platform Fee', 'Total', 'Payment', 'Status']];
    for (const o of filtered) {
      const b = billOf(o);
      const d = tsToDate(o.createdAt);
      rows.push([
        invoiceNo(o), o.orderId ?? o.id,
        d ? d.toLocaleString('en-IN') : '',
        freshName(names, o.customerPhone, o.customerName), o.customerPhone ?? '',
        `"${itemsText(o).replace(/"/g, "'")}"`,
        String(b.subtotal), String(b.deliveryFee), String(b.platformFee), String(b.total),
        isCod(o) ? 'COD' : 'Prepaid',
        o.stage === 3 ? 'Delivered' : o.stage === -1 ? 'Cancelled' : 'Pending',
      ]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foodmela-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      {/* ── Summary cards ── */}
      <div className="inv-stats">
        <div className="inv-stat"><span className="inv-stat-label">✅ Collected (delivered)</span><strong>₹{stats.delivered.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">⏳ Pending (active)</span><strong>₹{stats.pending.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">📅 Today</span><strong>₹{stats.today.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">💵 COD</span><strong>₹{stats.codTotal.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">📱 Prepaid</span><strong>₹{stats.prepaidTotal.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">🧾 Invoices</span><strong>{stats.count}</strong></div>
      </div>

      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search invoice no, order ID, customer..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="date-input" />
          <span className="date-sep">—</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="date-input" />
          {(dateFrom || dateTo) && <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>}
          <button className="btn btn-sm btn-primary" onClick={exportCsv} title="Download filtered invoices as CSV">⬇ CSV</button>
        </div>
        <div className="filters-row">
          <span className="filter-label">Status:</span>
          {[['all', 'All'], ['paid', 'Delivered'], ['pending', 'Active'], ['cancelled', 'Cancelled']].map(([v, l]) => (
            <button key={v} className={`chip ${statusFilter === v ? 'chip-active' : ''}`} onClick={() => setStatusFilter(v)}>{l}</button>
          ))}
          <span className="filter-label">Payment:</span>
          {[['all', 'All'], ['cod', 'COD'], ['prepaid', 'Prepaid']].map(([v, l]) => (
            <button key={v} className={`chip ${payFilter === v ? 'chip-active' : ''}`} onClick={() => setPayFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="No invoices found" subtitle="Try adjusting your search or filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Bill</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => {
                  const b = billOf(o);
                  const cod = isCod(o);
                  return (
                    <tr key={o.id}>
                      <td><span className="order-id">{invoiceNo(o)}</span><div className="cell-sub">#{String(o.orderId ?? o.id).replace(/^FM-/, '')}</div></td>
                      <td>
                        <div className="cell-main">{freshName(names, o.customerPhone, o.customerName)}</div>
                        <div className="cell-sub">{o.customerPhone || ''}</div>
                      </td>
                      <td className="cell-sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={itemsText(o)}>{itemsText(o)}</td>
                      <td><strong>₹{b.total.toLocaleString('en-IN')}</strong></td>
                      <td><span className={`inv-pay-pill ${cod ? 'pay-cod' : 'pay-prepaid'}`}>{cod ? '💵 COD' : '📱 Prepaid'}</span></td>
                      <td><StageBadge stage={o.stage ?? 0} /></td>
                      <td className="cell-sub">{fmtDateTime(tsToDate(o.createdAt))}</td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => setPreview(o)}>🧾 View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {preview && <InvoicePreview order={preview} customerName={freshName(names, preview.customerPhone, preview.customerName)} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ─── Printable invoice modal ────────────────────────────────────────────────
function InvoicePreview({ order: o, customerName, onClose }: { order: OrderRecord; customerName: string; onClose: () => void }) {
  const b = billOf(o);
  const cod = isCod(o);
  const cleanId = String(o.orderId ?? o.id ?? '').replace(/^FM-/, '');
  const d = tsToDate(o.createdAt);
  const dateStr = d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const addr = (o.address ?? 'Birmaharajpur, Subarnapur, Odisha - 767018').replace(/\[(COD|PREPAID)\]/gi, '').trim();

  return (
    <div className="dialog-overlay inv-overlay" onClick={onClose}>
      <div className="dialog inv-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="inv-print-area">
          <div className="inv-header">
            <div className="inv-brand-box">
              <div className="inv-logo">F</div>
              <div>
                <h2 className="inv-company">FoodMela</h2>
                <div className="inv-tagline">Local · Fresh · Fast</div>
              </div>
            </div>
            <div className="inv-meta-right">
              <span className="inv-badge">TAX INVOICE / RECEIPT</span>
              <div className="inv-meta-line"><strong>Invoice #:</strong> {invoiceNo(o)}</div>
              <div className="inv-meta-line"><strong>Order ID:</strong> #{cleanId}</div>
              <div className="inv-meta-line"><strong>Date:</strong> {dateStr}</div>
            </div>
          </div>
          <div className="inv-divider" />
          <div className="inv-grid-2">
            <div className="inv-box">
              <div className="inv-label">Delivered To:</div>
              <div className="inv-name">{customerName || 'Valued Customer'}</div>
              {o.customerPhone && <div className="inv-phone">📞 {o.customerPhone}</div>}
              <div className="inv-addr">{addr}</div>
            </div>
            <div className="inv-box right-box">
              <div className="inv-label">Issued By:</div>
              <div className="inv-name">FoodMela Online Logistics</div>
              <div className="inv-addr">Birmaharajpur, Subarnapur, Odisha - 767018</div>
              <div className="inv-phone">Helpline: +91 8144503650</div>
            </div>
          </div>
          <div className="inv-items-line"><strong>Items:</strong> {itemsText(o)}</div>
          <div className="inv-calc-box inv-calc-full">
            <div className="inv-calc-row"><span>Items Subtotal</span><span>₹{b.subtotal}</span></div>
            <div className="inv-calc-row"><span>Delivery Charge</span><span>{b.deliveryFee === 0 ? 'FREE' : `₹${b.deliveryFee}`}</span></div>
            <div className="inv-calc-row"><span>Platform Fee</span><span>₹{b.platformFee}</span></div>
            <div className="inv-divider-thin" />
            <div className="inv-calc-row total"><span>Grand Total</span><span className="grand-price">₹{b.total}</span></div>
          </div>
          <div className="inv-pay-row">
            <span className={`inv-pay-pill ${cod ? 'pay-cod' : 'pay-prepaid'}`}>{cod ? '💵 Cash on Delivery' : '📱 Online / Prepaid (UPI)'}</span>
            <span className="inv-status-line">Status: <strong>{o.status ?? '—'}</strong></span>
          </div>
        </div>
        <div className="dialog-actions inv-actions">
          <button className="btn btn-ghost" onClick={onClose}>✕ Close</button>
          <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print / Save PDF</button>
        </div>
      </div>
    </div>
  );
}
