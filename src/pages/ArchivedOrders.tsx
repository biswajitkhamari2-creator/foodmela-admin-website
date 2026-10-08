import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { adminFetch } from '../utils/adminApi';
import { tsToDate, fmtDateTime, formatOrderId } from '../utils/helpers';
import { StageBadge, EmptyState, Pagination } from '../components/UI';
import type { OrderRecord } from '../types';
import { useCustomerNames, freshName } from '../hooks/useCustomerNames';

const PAGE_SIZE = 20;

export default function ArchivedOrders({ globalSearch }: { globalSearch?: string }) {
  const nav = useNavigate();
  const names = useCustomerNames();
  const [archivedOrders, setArchivedOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [sourceNote, setSourceNote] = useState<string>('Connecting to archive...');

  useEffect(() => {
    let isMounted = true;

    // 1. First attempt: Listen directly to Firestore collection 'archived_orders'
    let unsub: (() => void) | null = null;
    try {
      const q = query(collection(db, 'archived_orders'), orderBy('archivedAt', 'desc'), limit(300));
      unsub = onSnapshot(
        q,
        (snap) => {
          if (!isMounted) return;
          if (!snap.empty) {
            const list: OrderRecord[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderRecord));
            setArchivedOrders(list);
            setSourceNote('Live sync from Firestore');
            setLoading(false);
          } else {
            // Empty snapshot? Fallback to backend API
            fallbackToBackend();
          }
        },
        (_err) => {
          // Firestore error or rule limit? Fallback to backend API
          fallbackToBackend();
        }
      );
    } catch {
      fallbackToBackend();
    }

    async function fallbackToBackend() {
      if (!isMounted) return;
      try {
        const res = await adminFetch('/api/admin/orders/archived?limit=300');
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.orders)) {
            if (isMounted) {
              setArchivedOrders(data.orders);
              setSourceNote('Synced via Backend Archive API');
              setLoading(false);
              return;
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch from backend archive:', e);
      }
      if (isMounted) {
        setLoading(false);
      }
    }

    return () => {
      isMounted = false;
      if (unsub) unsub();
    };
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    const isDigits = /^\d{1,4}$/.test(s);
    return archivedOrders.filter((o) => {
      const stage = o.stage ?? 0;
      const cat = (o.orderCategory ?? '').toLowerCase();
      const hay = `${o.orderId ?? o.id} ${o.customerName ?? ''} ${o.customerPhone ?? ''} ${o.riderName ?? ''} ${o.riderId ?? ''} ${cat}`.toLowerCase();

      if (statusFilter === 'delivered' && stage !== 3) return false;
      if (statusFilter === 'cancelled' && stage !== -1) return false;
      if (statusFilter === 'other' && stage === 3) return false;

      if (s) {
        if (hay.includes(s)) {
          /* pass */
        } else if (isDigits) {
          const orderDigits = (o.orderId ?? o.id ?? '').replace(/[^0-9]/g, '');
          const partnerDigits = (o.riderId ?? '').replace(/[^0-9]/g, '');
          if (!(orderDigits.includes(s) || orderDigits.endsWith(s) || partnerDigits.includes(s) || partnerDigits.endsWith(s)))
            return false;
        } else {
          return false;
        }
      }

      const createdAt = tsToDate(o.createdAt);
      if (dateFrom && createdAt && createdAt < new Date(dateFrom)) return false;
      if (dateTo && createdAt && createdAt > new Date(new Date(dateTo).getTime() + 86400000 - 1)) return false;
      return true;
    });
  }, [archivedOrders, search, globalSearch, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, globalSearch, statusFilter, dateFrom, dateTo]);

  const downloadCSV = () => {
    if (archivedOrders.length === 0) return;
    const headers = ['Order ID', 'Customer Name', 'Phone', 'Amount (₹)', 'Payment Method', 'Status', 'Delivery Partner', 'Created At'];
    const rows = archivedOrders.map((o) => [
      formatOrderId(o.orderId ?? o.id),
      `"${(o.customerName || '').replace(/"/g, '""')}"`,
      o.customerPhone || '',
      o.totalAmount || 0,
      o.paymentMethod || 'COD',
      o.stage === 3 ? 'Delivered' : o.stage === -1 ? 'Cancelled' : `Stage ${o.stage}`,
      `"${(o.riderName || '').replace(/"/g, '""')}"`,
      fmtDateTime(tsToDate(o.createdAt)),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `food_mela_archived_orders_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="page">
      {/* Top Navigation Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => nav('/orders')}
            className="btn btn-ghost"
            style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.7 }}
          >
            <span>⚡</span> Live Orders
          </button>
          <button
            className="btn btn-primary"
            style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' }}
          >
            <span>📦</span> Archived Orders
            <span style={{ background: '#fff', color: '#4f46e5', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 800 }}>
              {archivedOrders.length}
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>{sourceNote}</span>
          <button onClick={downloadCSV} className="btn btn-outline btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>📥</span> Export CSV
          </button>
        </div>
      </div>

      {/* Archive Information Card */}
      <div style={{
        background: 'linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%)',
        border: '1px solid #cbd5e1',
        borderRadius: 10,
        padding: '12px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🗄️</span>
          <div>
            <strong style={{ fontSize: 13, color: '#1e293b' }}>Permanent Order Archive</strong>
            <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
              These {archivedOrders.length} orders were cleared from the live database to keep rider dispatch and app loading instant.
              All invoices, rider assignments, customer details, and payment histories are permanently preserved here.
            </p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input
              placeholder="Search archived by ID, customer, rider..."
              value={globalSearch ? globalSearch : search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="date-input" />
          <span className="date-sep">—</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="date-input" />
          {(dateFrom || dateTo) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>
          )}
        </div>
        <div className="filters-row">
          <span className="filter-label">Status:</span>
          {[
            ['all', 'All Archived'],
            ['delivered', 'Delivered (Stage 3)'],
            ['cancelled', 'Cancelled'],
            ['other', 'Other Statuses'],
          ].map(([v, l]) => (
            <button
              key={v}
              className={`chip ${statusFilter === v ? 'chip-active' : ''}`}
              onClick={() => setStatusFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 400 }} />
      ) : archivedOrders.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No archived orders found"
          subtitle="Orders cleared from the database will appear in this archive."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No matching archived orders"
          subtitle="Try adjusting your search query or date filters."
        />
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
                  <th>Original Rider</th>
                  <th>Created Date</th>
                  <th>Archive Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => {
                  const stage = o.stage ?? 0;
                  const label = formatOrderId(o.orderId ?? o.id);
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
                      <td>{fmtDateTime(tsToDate(o.createdAt))}</td>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '11px',
                          background: '#f1f5f9',
                          color: '#475569',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontWeight: 700
                        }}>
                          📦 ARCHIVED
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
