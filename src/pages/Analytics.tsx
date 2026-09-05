import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate } from '../utils/helpers';
import { EmptyState } from '../components/UI';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from 'recharts';

export default function Analytics() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ordersData: Record<string, unknown>[] = [];
    let usersData: Record<string, unknown>[] = [];
    const u1 = onSnapshot(collection(db, 'orders'), (snap) => {
      ordersData = snap.docs.map((d) => d.data() as Record<string, unknown>);
      setOrders([...ordersData]);
      setLoading(false);
    });
    const u2 = onSnapshot(collection(db, 'users'), (snap) => {
      usersData = snap.docs.map((d) => d.data() as Record<string, unknown>);
      setUsers([...usersData]);
    });
    return () => { u1(); u2(); };
  }, []);

  const data = useMemo(() => {
    // Orders over time (last 7 days)
    const last7: { date: string; count: number; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter((o) => {
        const cd = tsToDate(o.createdAt);
        return cd && cd >= d && cd < next;
      });
      const revenue = dayOrders.filter((o) => (o.stage as number) === 3).reduce((s, o) => s + ((o.totalAmount as number) ?? 0), 0);
      last7.push({ date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), count: dayOrders.length, revenue });
    }

    // Stage distribution
    const stages = [
      { name: 'Pending', value: orders.filter((o) => (o.stage as number) === 0).length, color: '#D97706' },
      { name: 'Accepted', value: orders.filter((o) => (o.stage as number) === 1).length, color: '#2563EB' },
      { name: 'Out for Delivery', value: orders.filter((o) => (o.stage as number) === 2).length, color: '#7C3AED' },
      { name: 'Delivered', value: orders.filter((o) => (o.stage as number) === 3).length, color: '#059669' },
      { name: 'Cancelled', value: orders.filter((o) => (o.stage as number) === -1).length, color: '#DC2626' },
    ].filter((s) => s.value > 0);

    // Category performance
    const catMap = new Map<string, number>();
    for (const o of orders) {
      const cat = (o.orderCategoryLabel as string) ?? (o.orderCategory as string) ?? 'General';
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    }
    const categories = Array.from(catMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

    // Partner performance (top 5 by delivered)
    const partnerMap = new Map<string, number>();
    for (const o of orders.filter((o) => (o.stage as number) === 3)) {
      const pid = (o.riderName as string) ?? (o.riderId as string) ?? 'Unknown';
      partnerMap.set(pid, (partnerMap.get(pid) ?? 0) + 1);
    }
    const partners = Array.from(partnerMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

    const totalRevenue = orders.filter((o) => (o.stage as number) === 3).reduce((s, o) => s + ((o.totalAmount as number) ?? 0), 0);
    const avgOrderValue = orders.length ? Math.round(totalRevenue / Math.max(1, orders.filter((o) => (o.stage as number) === 3).length)) : 0;

    return { last7, stages, categories, partners, totalRevenue, avgOrderValue, totalOrders: orders.length, totalUsers: users.length };
  }, [orders, users]);

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  if (orders.length === 0) return <div className="page"><EmptyState icon="📊" title="No data for analytics" subtitle="Charts will appear once orders are placed." /></div>;

  return (
    <div className="page">
      <div className="metrics-grid">
        <div className="metric-card"><div className="metric-icon" style={{ background: '#EFF6FF', color: '#2563EB' }}>🧾</div><div className="metric-info"><span className="metric-label">Total Orders</span><strong className="metric-value">{data.totalOrders}</strong></div></div>
        <div className="metric-card"><div className="metric-icon" style={{ background: '#ECFDF5', color: '#059669' }}>💰</div><div className="metric-info"><span className="metric-label">Total Revenue</span><strong className="metric-value">₹{data.totalRevenue.toLocaleString('en-IN')}</strong></div></div>
        <div className="metric-card"><div className="metric-icon" style={{ background: '#FFFBEB', color: '#D97706' }}>📊</div><div className="metric-info"><span className="metric-label">Avg Order Value</span><strong className="metric-value">₹{data.avgOrderValue.toLocaleString('en-IN')}</strong></div></div>
        <div className="metric-card"><div className="metric-icon" style={{ background: '#F5F3FF', color: '#7C3AED' }}>👥</div><div className="metric-info"><span className="metric-label">Total Users</span><strong className="metric-value">{data.totalUsers}</strong></div></div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h3>Orders — Last 7 Days</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.last7}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#F15A24" radius={[6, 6, 0, 0]} name="Orders" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Revenue — Last 7 Days</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.last7}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2} dot={{ fill: '#059669' }} name="Revenue (₹)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Orders by Status</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.stages} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                {data.stages.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Category Performance</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.categories} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip />
              <Bar dataKey="value" fill="#7C3AED" radius={[0, 6, 6, 0]} name="Orders" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {data.partners.length > 0 && (
          <div className="chart-card">
            <h3>Top Partners (by Deliveries)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.partners}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#059669" radius={[6, 6, 0, 0]} name="Deliveries" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
