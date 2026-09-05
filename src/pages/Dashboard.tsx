import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { tsToDate, fmtDateTime } from '../utils/helpers';

// ─── Types ──────────────────────────────────────────────────────────────────
interface OrderDoc extends Record<string, unknown> {
  orderId?: string;
  customerName?: string;
  customerPhone?: string;
  riderName?: string;
  riderId?: string;
  stage?: number;
  totalAmount?: number;
  orderCategoryLabel?: string;
  createdAt?: unknown;
  acceptedAt?: unknown;
}

interface UserDoc extends Record<string, unknown> {
  role?: string;
  accountStatus?: string;
  approvalStatus?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function stageLabel(s: number) {
  switch (s) {
    case 0: return 'Pending';
    case 1: return 'Accepted';
    case 2: return 'Out for Delivery';
    case 3: return 'Delivered';
    case -1: return 'Cancelled';
    default: return `Stage ${s}`;
  }
}

function stageStyle(s: number): { bg: string; color: string; dot: string } {
  switch (s) {
    case 0: return { bg: '#FFFBEB', color: '#B45309', dot: '#F59E0B' };
    case 1: return { bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' };
    case 2: return { bg: '#F5F3FF', color: '#6D28D9', dot: '#8B5CF6' };
    case 3: return { bg: '#ECFDF5', color: '#047857', dot: '#10B981' };
    case -1: return { bg: '#FEF2F2', color: '#B91C1C', dot: '#EF4444' };
    default: return { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' };
  }
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const nav = useNavigate();
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let usersData: UserDoc[] = [];
    let ordersData: OrderDoc[] = [];
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      usersData = snap.docs.map((d) => d.data() as UserDoc);
      setUsers([...usersData]);
      setLoading(false);
    });
    const unsubOrders = onSnapshot(collection(db, 'orders'), (snap) => {
      ordersData = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderDoc));
      setOrders([...ordersData]);
      setLoading(false);
    });
    return () => { unsubUsers(); unsubOrders(); };
  }, []);

  // ── Derived metrics ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let pending = 0, accepted = 0, outForDelivery = 0, delivered = 0, cancelled = 0;
    let todayOrders = 0, todayRevenue = 0, totalRevenue = 0;
    let activeOrders = 0;

    for (const o of orders) {
      const s = o.stage ?? 0;
      const amt = o.totalAmount ?? 0;
      const createdAt = tsToDate(o.createdAt as unknown);
      if (s === 0) pending++;
      else if (s === 1) accepted++;
      else if (s === 2) outForDelivery++;
      else if (s === 3) delivered++;
      else if (s === -1) cancelled++;
      if (s >= 0 && s <= 2) activeOrders++;
      if (s === 3) totalRevenue += amt;
      if (createdAt && createdAt >= todayStart) {
        todayOrders++;
        if (s === 3) todayRevenue += amt;
      }
    }

    // Partners
    let totalPartners = 0, activePartners = 0, pendingApprovals = 0, delivering = 0;
    const deliveringIds = new Set(orders.filter((o) => o.stage === 1 || o.stage === 2).map((o) => o.riderId).filter(Boolean));
    for (const u of users) {
      if (u.role === 'delivery_partner') {
        totalPartners++;
        if (u.approvalStatus === 'pending') pendingApprovals++;
        else if (u.approvalStatus === 'approved' && u.accountStatus !== 'blocked') activePartners++;
      }
    }
    delivering = deliveringIds.size;

    // Category breakdown
    const catMap = new Map<string, number>();
    for (const o of orders) {
      const cat = (o.orderCategoryLabel as string) ?? (o.orderCategory as string) ?? 'General';
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    }
    const categories = Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count, pct: orders.length ? Math.round((count / orders.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 7-day trend
    const trend: { label: string; orders: number; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter((o) => { const cd = tsToDate(o.createdAt as unknown); return cd && cd >= d && cd < next; });
      const rev = dayOrders.filter((o) => o.stage === 3).reduce((s, o) => s + (o.totalAmount ?? 0), 0);
      trend.push({ label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), orders: dayOrders.length, revenue: rev });
    }
    const maxTrendOrders = Math.max(1, ...trend.map((t) => t.orders));

    return {
      pending, accepted, outForDelivery, delivered, cancelled, activeOrders,
      todayOrders, todayRevenue, totalRevenue,
      totalPartners, activePartners, pendingApprovals, delivering,
      categories, trend, maxTrendOrders,
      totalOrders: orders.length,
    };
  }, [orders, users]);

  // Live active orders (latest 6)
  const liveOrders = useMemo(() => {
    return [...orders]
      .filter((o) => (o.stage ?? 0) >= 0 && (o.stage ?? 0) <= 2)
      .sort((a, b) => {
        const da = tsToDate(a.createdAt as unknown)?.getTime() ?? 0;
        const db2 = tsToDate(b.createdAt as unknown)?.getTime() ?? 0;
        return db2 - da;
      })
      .slice(0, 6);
  }, [orders]);

  // Alerts
  const alerts = useMemo(() => {
    const list: { icon: string; text: string; action: string; to: string }[] = [];
    if (stats.pendingApprovals > 0) list.push({ icon: '⚠', text: `${stats.pendingApprovals} delivery partner${stats.pendingApprovals > 1 ? 's' : ''} awaiting approval`, action: 'Review', to: '/approvals' });
    if (stats.pending > 0) list.push({ icon: '◷', text: `${stats.pending} order${stats.pending > 1 ? 's' : ''} currently unassigned`, action: 'View orders', to: '/orders' });
    if (stats.cancelled > 0 && stats.cancelled / Math.max(1, stats.totalOrders) > 0.15) list.push({ icon: '✕', text: `${stats.cancelled} cancelled orders — review required`, action: 'View', to: '/orders' });
    return list;
  }, [stats]);

  if (loading) {
    return (
      <div className="dash">
        <div className="dash-skeleton">
          <div className="skeleton" style={{ height: 100 }} />
          <div className="skeleton" style={{ height: 120 }} />
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="dash">

      {/* ── TODAY'S OVERVIEW ─────────────────────────────────────────────── */}
      <div className="dash-kpis">
        <div className="dash-kpi" onClick={() => nav('/orders')}>
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Today&apos;s Orders</span>
            <span className="dash-kpi-icon" style={{ background: '#FFF7ED', color: '#F15A24' }}>◧</span>
          </div>
          <strong className="dash-kpi-value">{stats.todayOrders}</strong>
          <span className="dash-kpi-sub">{stats.totalOrders} total orders</span>
        </div>
        <div className="dash-kpi" onClick={() => nav('/earnings')}>
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Today&apos;s Revenue</span>
            <span className="dash-kpi-icon" style={{ background: '#ECFDF5', color: '#059669' }}>₹</span>
          </div>
          <strong className="dash-kpi-value">₹{stats.todayRevenue.toLocaleString('en-IN')}</strong>
          <span className="dash-kpi-sub">₹{stats.totalRevenue.toLocaleString('en-IN')} total</span>
        </div>
        <div className="dash-kpi" onClick={() => nav('/partners')}>
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Active Delivery</span>
            <span className="dash-kpi-icon" style={{ background: '#EFF6FF', color: '#2563EB' }}>🛵</span>
          </div>
          <strong className="dash-kpi-value">{stats.delivering}</strong>
          <span className="dash-kpi-sub">{stats.activePartners} active partners</span>
        </div>
      </div>

      {/* ── LIVE ORDER OPERATIONS ────────────────────────────────────────── */}
      <div className="dash-panel">
        <div className="dash-panel-head">
          <h3>Live Order Operations</h3>
          <span className="dash-panel-hint">{stats.activeOrders} active orders</span>
        </div>
        <div className="dash-pipeline">
          {[
            { label: 'Pending', count: stats.pending, stage: 0 },
            { label: 'Accepted', count: stats.accepted, stage: 1 },
            { label: 'Out for Delivery', count: stats.outForDelivery, stage: 2 },
            { label: 'Delivered', count: stats.delivered, stage: 3 },
            { label: 'Cancelled', count: stats.cancelled, stage: -1 },
          ].map((s, i) => {
            const st = stageStyle(s.stage);
            return (
              <div key={s.label} className="dash-pipe-group">
                <button
                  className="dash-pipe-card"
                  onClick={() => nav('/orders')}
                  style={{ borderColor: st.dot + '30' }}
                >
                  <span className="dash-pipe-dot" style={{ background: st.dot }} />
                  <span className="dash-pipe-label">{s.label}</span>
                  <strong className="dash-pipe-count" style={{ color: st.color }}>{s.count}</strong>
                </button>
                {i < 4 && <span className="dash-pipe-arrow">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── LIVE ORDERS + DELIVERY OPERATIONS ────────────────────────────── */}
      <div className="dash-split">

        {/* Live Orders */}
        <div className="dash-panel dash-panel--grow">
          <div className="dash-panel-head">
            <h3>Live Orders</h3>
            <button className="dash-link" onClick={() => nav('/orders')}>View all →</button>
          </div>
          {liveOrders.length === 0 ? (
            <div className="dash-empty">
              <span>—</span>
              <p>No active orders right now</p>
            </div>
          ) : (
            <div className="dash-live-list">
              {liveOrders.map((o) => {
                const st = stageStyle(o.stage ?? 0);
                return (
                  <div key={o.id as string} className="dash-live-row" onClick={() => nav(`/orders/${o.orderId ?? o.id}`)}>
                    <span className="dash-live-id">{String(o.orderId ?? o.id).replace(/^FM-/, '')}</span>
                    <span className="dash-live-customer">{String(o.customerName ?? '—')}</span>
                    <span className="dash-live-partner">{String(o.riderName ?? '—')}</span>
                    <span className="dash-live-badge" style={{ background: st.bg, color: st.color, border: `1px solid ${st.dot}30` }}>
                      {stageLabel(o.stage ?? 0)}
                    </span>
                    <span className="dash-live-time">{fmtDateTime(tsToDate(o.createdAt as unknown))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delivery Operations */}
        <div className="dash-panel dash-panel--side">
          <div className="dash-panel-head">
            <h3>Delivery Operations</h3>
            <button className="dash-link" onClick={() => nav('/partners')}>View all →</button>
          </div>
          <div className="dash-ops-list">
            <div className="dash-ops-row">
              <span className="dash-ops-dot" style={{ background: '#10B981' }} />
              <span className="dash-ops-label">Active partners</span>
              <strong className="dash-ops-value">{stats.activePartners}</strong>
            </div>
            <div className="dash-ops-row">
              <span className="dash-ops-dot" style={{ background: '#3B82F6' }} />
              <span className="dash-ops-label">Currently delivering</span>
              <strong className="dash-ops-value">{stats.delivering}</strong>
            </div>
            <div className="dash-ops-row">
              <span className="dash-ops-dot" style={{ background: '#94A3B8' }} />
              <span className="dash-ops-label">Available for orders</span>
              <strong className="dash-ops-value">{Math.max(0, stats.activePartners - stats.delivering)}</strong>
            </div>
            <div className="dash-ops-row dash-ops-row--alert" onClick={() => nav('/approvals')}>
              <span className="dash-ops-dot" style={{ background: '#F59E0B' }} />
              <span className="dash-ops-label">Pending approval</span>
              <strong className="dash-ops-value" style={{ color: stats.pendingApprovals > 0 ? '#D97706' : undefined }}>{stats.pendingApprovals}</strong>
            </div>
          </div>
          <div className="dash-ops-foot">
            <span>{stats.totalPartners} total partners</span>
          </div>
        </div>
      </div>

      {/* ── TREND + CATEGORY ─────────────────────────────────────────────── */}
      <div className="dash-split">

        {/* Order & Revenue Trend */}
        <div className="dash-panel dash-panel--grow">
          <div className="dash-panel-head">
            <h3>Order &amp; Revenue Trend</h3>
            <span className="dash-panel-hint">Last 7 days</span>
          </div>
          {stats.trend.every((t) => t.orders === 0) ? (
            <div className="dash-empty"><p>Not enough data for trend yet</p></div>
          ) : (
            <div className="dash-trend">
              <div className="dash-trend-bars">
                {stats.trend.map((t) => (
                  <div key={t.label} className="dash-trend-col">
                    <div className="dash-trend-bar-wrap">
                      <div
                        className="dash-trend-bar"
                        style={{ height: `${Math.max(4, (t.orders / stats.maxTrendOrders) * 100)}%` }}
                        title={`${t.label}: ${t.orders} orders, ₹${t.revenue}`}
                      />
                    </div>
                    <span className="dash-trend-label">{t.label}</span>
                    <span className="dash-trend-val">{t.orders}</span>
                  </div>
                ))}
              </div>
              <div className="dash-trend-legend">
                <span><i style={{ background: '#F15A24' }} /> Orders</span>
                <span className="dash-trend-rev">Revenue: ₹{stats.trend.reduce((s, t) => s + t.revenue, 0).toLocaleString('en-IN')} (7 days)</span>
              </div>
            </div>
          )}
        </div>

        {/* Category Performance */}
        <div className="dash-panel dash-panel--side">
          <div className="dash-panel-head">
            <h3>Top Categories</h3>
          </div>
          {stats.categories.length === 0 ? (
            <div className="dash-empty"><p>No category data available yet</p></div>
          ) : (
            <div className="dash-cats">
              {stats.categories.map((c) => (
                <div key={c.name} className="dash-cat-row">
                  <span className="dash-cat-name">{c.name}</span>
                  <div className="dash-cat-bar-wrap">
                    <div className="dash-cat-bar" style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="dash-cat-pct">{c.pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── QUICK ACTIONS + ATTENTION ────────────────────────────────────── */}
      <div className="dash-split">
        <div className="dash-panel dash-panel--side">
          <div className="dash-panel-head"><h3>Quick Actions</h3></div>
          <div className="dash-actions">
            <button className="dash-action" onClick={() => nav('/partners')}>
              <span className="dash-action-icon" style={{ background: '#FFF7ED', color: '#F15A24' }}>＋</span>
              Add Delivery Partner
            </button>
            <button className="dash-action" onClick={() => nav('/orders')}>
              <span className="dash-action-icon" style={{ background: '#EFF6FF', color: '#2563EB' }}>🧾</span>
              View Orders
            </button>
            <button className="dash-action" onClick={() => nav('/approvals')}>
              <span className="dash-action-icon" style={{ background: '#FFFBEB', color: '#D97706' }}>⏳</span>
              Pending Approvals {stats.pendingApprovals > 0 && <span className="dash-action-badge">{stats.pendingApprovals}</span>}
            </button>
            <button className="dash-action" onClick={() => nav('/customers')}>
              <span className="dash-action-icon" style={{ background: '#F5F3FF', color: '#7C3AED' }}>👥</span>
              Customers
            </button>
          </div>
        </div>

        <div className="dash-panel dash-panel--grow">
          <div className="dash-panel-head"><h3>Needs Your Attention</h3></div>
          {alerts.length === 0 ? (
            <div className="dash-empty dash-empty--success">
              <span style={{ fontSize: 20 }}>✓</span>
              <p>All clear — no urgent actions required</p>
            </div>
          ) : (
            <div className="dash-alerts">
              {alerts.map((a, i) => (
                <div key={i} className="dash-alert" onClick={() => nav(a.to)}>
                  <span className="dash-alert-icon">{a.icon}</span>
                  <span className="dash-alert-text">{a.text}</span>
                  <span className="dash-alert-action">{a.action} →</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
