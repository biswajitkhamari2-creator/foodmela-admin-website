import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Products from './pages/Products';
import Banners from './pages/Banners';
import Customers from './pages/Customers';
import Partners from './pages/Partners';
import Approvals from './pages/Approvals';
import Earnings from './pages/Earnings';
import Withdrawals from './pages/Withdrawals';
import Analytics from './pages/Analytics';
import ActivityLogs from './pages/ActivityLogs';
import CallRecordings from './pages/CallRecordings';

function Protected({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /> Loading...</div>;
  if (!isAdmin) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function AdminLayout() {
  const { adminName, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [globalSearch, setGlobalSearch] = useState('');
  const now = useNow();

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'delivery_partner'), where('approvalStatus', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => setPendingCount(snap.size));
    return () => unsub();
  }, []);

  // Press "/" anywhere to jump to global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? '';
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('global-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const titles: Record<string, { title: string; subtitle: string }> = {
    '/': { title: 'Dashboard', subtitle: 'Real-time operations overview' },
    '/orders': { title: 'Orders', subtitle: 'Orders overview' },
    '/products': { title: 'Product Prices', subtitle: 'Dynamic pricing — updates the customer app on refresh' },
    '/banners': { title: 'Festival Banners', subtitle: 'Home-screen campaigns — no app update needed' },
    '/customers': { title: 'Customers', subtitle: 'Customer management' },
    '/partners': { title: 'Delivery Partners', subtitle: 'Partner management' },
    '/approvals': { title: 'Pending Approvals', subtitle: 'New delivery partners awaiting review' },
    '/earnings': { title: 'Earnings', subtitle: 'Delivery earnings — credited only after successful delivery' },
    '/withdrawals': { title: 'Withdrawals', subtitle: 'Rider payout requests — approve after paying' },
    '/analytics': { title: 'Analytics', subtitle: 'Performance insights' },
    '/calls': { title: 'Call Recordings', subtitle: 'Customer ↔ rider VoIP captures — numbers stay hidden' },
    '/logs': { title: 'Admin Audit Logs', subtitle: 'All administrative actions — immutable record' },
  };

  const current = titles[location.pathname] ?? (location.pathname.startsWith('/orders/') ? { title: 'Order Details', subtitle: 'Complete order information' } : { title: 'Admin', subtitle: '' });

  return (
    <div className="admin-layout">
      <div className={`sidebar-wrap ${mobileOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} pendingCount={pendingCount} onLogout={logout} adminName={adminName} />
      </div>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <div className="main-wrap">
        <div className="topbar">
          <div className="topbar-left">
            <button className="menu-btn" onClick={() => setMobileOpen(!mobileOpen)}>☰</button>
            <div>
              <h1 className="topbar-title">{current.title}</h1>
              <p className="topbar-subtitle">{current.subtitle}</p>
            </div>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <span>🔍</span>
              <input
                id="global-search-input"
                placeholder="Search by 4-digit ID, orders, customers, partners..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              {globalSearch ? (
                <button className="search-clear" onClick={() => setGlobalSearch('')} title="Clear search">✕</button>
              ) : (
                <kbd className="search-hint">/</kbd>
              )}
            </div>
            <span className="topbar-clock" title={now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}>
              {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </span>
            <span className="live-badge"><span className="live-dot-sm" /> LIVE</span>
          </div>
        </div>
        <div className="content">
          <div key={location.pathname} className="page-enter">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/orders" element={<Orders globalSearch={globalSearch} />} />
            <Route path="/orders/:orderId" element={<OrderDetail />} />
            <Route path="/products" element={<Products globalSearch={globalSearch} />} />
            <Route path="/banners" element={<Banners globalSearch={globalSearch} />} />
            <Route path="/customers" element={<Customers globalSearch={globalSearch} />} />
            <Route path="/partners" element={<Partners globalSearch={globalSearch} />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/withdrawals" element={<Withdrawals />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/calls" element={<CallRecordings globalSearch={globalSearch} />} />
            <Route path="/logs" element={<ActivityLogs />} />
          </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

// Single-domain build: admin is served from foodmela.online/admin.
// basename keeps all links (/orders, /login…) under /admin in production,
// while local `vite dev` (served at /) keeps working unchanged.
const BASENAME = import.meta.env.PROD ? '/admin' : undefined;

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginWrapper />} />
          <Route path="/*" element={<Protected><AdminLayout /></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function LoginWrapper() {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /> Loading...</div>;
  if (isAdmin) return <Navigate to="/" replace />;
  return <Login />;
}
