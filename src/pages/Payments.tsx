import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../utils/adminApi';
import { EmptyState, Pagination } from '../components/UI';
import { formatOrderId } from '../utils/helpers';

const PAGE_SIZE = 20;

interface PayRec {
  id: string;
  orderId: string;
  customerName: string;
  phone: string;
  amount: number;
  gateway: string;
  payStatus: string;
  gatewayRef: string;
  at: string;
}

function gwBadge(gw: string): string {
  const g = (gw || '').toLowerCase();
  if (g.includes('phonepe')) return '💜 PhonePe';
  if (g.includes('payu')) return '💳 PayU';
  if (g.includes('cod') || g.includes('cash')) return '💵 COD';
  return `📦 ${gw || '—'}`;
}

function statusBadge(st: string): { label: string; cls: string } {
  const s = (st || '').toUpperCase();
  if (s === 'PAID' || s === 'COMPLETED' || s === 'SUCCESS' || s === 'PAYMENT_SUCCESS') {
    return { label: '✅ PAID', cls: 'pay-prepaid' };
  }
  if (s === 'PENDING' || s === 'INITIATED') return { label: '⏳ Pending', cls: 'pay-pending' };
  if (s === 'INIT_FAILED') return { label: '⚠️ Not started', cls: 'pay-failed' };
  if (s.includes('REFUND')) {
    return s.includes('FAIL')
      ? { label: '❌ Refund failed', cls: 'pay-failed' }
      : { label: '↩ Refunded', cls: 'pay-pending' };
  }
  if (s.includes('FAIL') || s.includes('CANCEL') || s.includes('EXPIRE') || s.includes('DECLINE')) {
    return { label: '❌ Failed', cls: 'pay-failed' };
  }
  return { label: `• ${st || 'Unknown'}`, cls: 'pay-pending' };
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}


export default function Payments({ globalSearch }: { globalSearch?: string }) {
  const [rows, setRows] = useState<PayRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [gwFilter, setGwFilter] = useState('all');
  const [stFilter, setStFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [refundFor, setRefundFor] = useState<PayRec | null>(null);
  const [refundAmt, setRefundAmt] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundMsg, setRefundMsg] = useState('');

  // Backend merges ledger + Firestore (Admin SDK) + Redis — one call, full
  // history. No browser Firestore read (rules can't block the server).
  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await adminFetch('/api/admin/payments?limit=300');
      const data = (await res.json()) as { success: boolean; payments?: PayRec[]; error?: string };
      if (!res.ok || !data.success) {
        const hint = res.status === 403
          ? ' (admin token nahi bana — ek baar logout karke dobara login karo)'
          : '';
        throw new Error(`${data.error || `Server ${res.status}`}${hint}`);
      }
      setRows(Array.isArray(data.payments) ? data.payments : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const verifyLive = async (orderId: string) => {
    setVerifying(orderId);
    setVerifyMsg('');
    try {
      const res = await adminFetch(`/api/admin/payments/verify/${encodeURIComponent(orderId)}`);
      const data = (await res.json()) as { success: boolean; state?: string; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || `Server ${res.status}`);
      setVerifyMsg(`Live status for ${orderId}: ${data.state ?? 'unknown'}`);
      await load();
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : 'Verify failed');
    } finally {
      setVerifying(null);
    }
  };

  const submitRefund = async () => {
    if (!refundFor) return;
    const amt = Number(refundAmt);
    if (!amt || amt <= 0) { setRefundMsg('Kitna refund karna hai — amount likho (₹ me).'); return; }
    if (!refundReason.trim()) { setRefundMsg('Reason likhna zaroori hai (audit ke liye).'); return; }
    if (!confirm(`₹${amt} refund karna hai order ${refundFor.orderId} pe?\nReason: ${refundReason.trim()}\n\nPaise wapas jayenge — undo nahi hoga!`)) return;
    setRefunding(true);
    setRefundMsg('');
    try {
      const res = await adminFetch(`/api/admin/payments/refund/${encodeURIComponent(refundFor.orderId)}`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, reason: refundReason.trim() }),
      });
      const data = (await res.json()) as { success: boolean; refundId?: string; state?: string; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || `Server ${res.status}`);
      setRefundMsg(`✅ Refund shuru: ₹${amt} (ID: ${data.refundId ?? '—'}). Paise 24–48h me customer ko milenge.`);
      setRefundFor(null);
      setRefundAmt('');
      setRefundReason('');
      await load();
    } catch (e) {
      setRefundMsg(e instanceof Error ? e.message : 'Refund fail ho gaya');
    } finally {
      setRefunding(false);
    }
  };

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    return rows.filter((r) => {
      if (gwFilter !== 'all') {
        const g = (r.gateway || '').toLowerCase();
        if (gwFilter === 'phonepe' && !g.includes('phonepe')) return false;
        if (gwFilter === 'payu' && !g.includes('payu')) return false;
        if (gwFilter === 'cod' && !(g.includes('cod') || g.includes('cash'))) return false;
      }
      if (stFilter !== 'all') {
        const b = statusBadge(r.payStatus).label;
        if (stFilter === 'paid' && !b.includes('PAID')) return false;
        if (stFilter === 'pending' && !(b.includes('Pending') || b.includes('Not started'))) return false;
        if (stFilter === 'failed' && !b.includes('Failed')) return false;
      }
      if (s) {
        const hay = `${r.orderId} ${r.id} ${r.customerName} ${r.phone}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, search, globalSearch, gwFilter, stFilter]);

  const stats = useMemo(() => {
    let paid = 0, pending = 0, failed = 0, phonepe = 0;
    for (const r of filtered) {
      const b = statusBadge(r.payStatus).label;
      if (b.includes('PAID')) { paid += Number(r.amount || 0); }
      else if (b.includes('Failed')) failed++;
      else pending++;
      if ((r.gateway || '').toLowerCase().includes('phonepe')) phonepe += Number(r.amount || 0);
    }
    return { paid, pending, failed, phonepe, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, globalSearch, gwFilter, stFilter]);

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="inv-stats">
        <div className="inv-stat"><span className="inv-stat-label">✅ Paid collected</span><strong>₹{stats.paid.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">💜 PhonePe volume</span><strong>₹{stats.phonepe.toLocaleString('en-IN')}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">⏳ Pending</span><strong>{stats.pending}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">❌ Failed</span><strong>{stats.failed}</strong></div>
        <div className="inv-stat"><span className="inv-stat-label">🧾 Transactions</span><strong>{stats.count}</strong></div>
      </div>

      {err && (
        <p style={{ color: '#C4271F', background: '#FDECEA', borderRadius: 12, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          {err} <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => void load()}>Retry</button>
        </p>
      )}
      {verifyMsg && (
        <p style={{ color: '#0a5c2f', background: '#E7F6EC', borderRadius: 12, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          {verifyMsg}
        </p>
      )}

      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search order ID, customer, phone..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => void load()} title="Reload from server">↻ Refresh</button>
        </div>
        <div className="filters-row">
          <span className="filter-label">Gateway:</span>
          {[['all', 'All'], ['phonepe', 'PhonePe'], ['payu', 'PayU'], ['cod', 'COD']].map(([v, l]) => (
            <button key={v} className={`chip ${gwFilter === v ? 'chip-active' : ''}`} onClick={() => setGwFilter(v)}>{l}</button>
          ))}
          <span className="filter-label">Status:</span>
          {[['all', 'All'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed']].map(([v, l]) => (
            <button key={v} className={`chip ${stFilter === v ? 'chip-active' : ''}`} onClick={() => setStFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="💳" title="No transactions yet" subtitle="Paid + pending gateway attempts will appear here automatically." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Gateway</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Verify</th>
                  <th>Refund</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const b = statusBadge(r.payStatus);
                  const isPhonePe = (r.gateway || '').toLowerCase().includes('phonepe');
                  return (
                    <tr key={`${r.id}-${r.at}`}>
                      <td><span className="order-id">{formatOrderId(r.orderId)}</span><div className="cell-sub">{r.gatewayRef || ''}</div></td>
                      <td>
                        <div className="cell-main">{r.customerName || '—'}</div>
                        <div className="cell-sub">{r.phone || ''}</div>
                      </td>
                      <td><strong>₹{Number(r.amount || 0).toLocaleString('en-IN')}</strong></td>
                      <td className="cell-sub">{gwBadge(r.gateway)}</td>
                      <td><span className={`inv-pay-pill ${b.cls}`}>{b.label}</span></td>
                      <td className="cell-sub">{fmtDate(r.at)}</td>
                      <td>
                        {isPhonePe && !b.label.includes('PAID') ? (
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={verifying === r.orderId}
                            onClick={() => void verifyLive(r.orderId)}
                            title="Check real-time status with PhonePe"
                          >
                            {verifying === r.orderId ? '…' : '↻ Verify live'}
                          </button>
                        ) : (
                          <span className="cell-sub">—</span>
                        )}
                      </td>
                      <td>
                        {isPhonePe && b.label.includes('PAID') ? (
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: '#C4271F' }}
                            onClick={() => {
                              setRefundFor(r);
                              setRefundAmt(String(Number(r.amount || 0)));
                              setRefundReason('');
                              setRefundMsg('');
                            }}
                            title="Refund (full ya partial) — amount puchega"
                          >
                            ↩ Refund
                          </button>
                        ) : (
                          <span className="cell-sub">—</span>
                        )}
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

      {refundFor && (
        <div className="dialog-overlay" onClick={() => !refunding && setRefundFor(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ marginBottom: 4 }}>↩ Refund — {formatOrderId(refundFor.orderId)}</h3>
            <p style={{ fontSize: 13, color: '#66707D', marginBottom: 14 }}>
              {refundFor.customerName} · Paid ₹{Number(refundFor.amount || 0).toLocaleString('en-IN')} via PhonePe.
              Kitna refund karna hai — full ya partial, amount likho:
            </p>
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Refund amount (₹)
            </label>
            <input
              type="number"
              min={1}
              max={Number(refundFor.amount || 0)}
              value={refundAmt}
              onChange={(e) => setRefundAmt(e.target.value)}
              placeholder={`Max ₹${Number(refundFor.amount || 0)}`}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border, #D8DED6)', fontSize: 15, marginBottom: 12 }}
            />
            <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Reason (zaroori — audit me likha jayega)
            </label>
            <input
              type="text"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. Customer ko galat item gaya"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border, #D8DED6)', fontSize: 14, marginBottom: 12 }}
            />
            {refundMsg && (
              <p style={{ fontSize: 13, marginBottom: 12, color: refundMsg.startsWith('✅') ? '#0a5c2f' : '#C4271F', background: refundMsg.startsWith('✅') ? '#E7F6EC' : '#FDECEA', borderRadius: 10, padding: '8px 12px' }}>
                {refundMsg}
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn btn-ghost" disabled={refunding} onClick={() => setRefundFor(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={refunding} onClick={() => void submitRefund()} style={{ background: '#C4271F' }}>
                {refunding ? 'Processing…' : `₹${refundAmt || '0'} Refund karo`}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: '#9AA3AF', marginTop: 10, textAlign: 'center' }}>
              Paise 24–48h me customer ke account me ayenge (PhonePe). Undo nahi hoga.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
