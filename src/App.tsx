import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import ArchivedOrders from './pages/ArchivedOrders';
import OrderDetail from './pages/OrderDetail';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Banners from './pages/Banners';
import NoticeBoard from './pages/NoticeBoard';
import Promos from './pages/Promos';
import Customers from './pages/Customers';
import Partners from './pages/Partners';
import Approvals from './pages/Approvals';
import Earnings from './pages/Earnings';
import Withdrawals from './pages/Withdrawals';
import Analytics from './pages/Analytics';
import ActivityLogs from './pages/ActivityLogs';
import CallRecordings from './pages/CallRecordings';
import Settings from './pages/Settings';

import AdminSplashLoader from './components/AdminSplashLoader';

function Protected({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <AdminSplashLoader message="Verifying secure administrator session..." />;
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

  // Periodic background order watcher & 10-minute auto-archiver trigger
  useEffect(() => {
    const runWatch = () => {
      fetch('https://foodmela.online/api/orders/watch?masterKey=FM_WIPE_ALL_ORDERS_CONFIRMED_2026', {
        headers: { 'x-master-key': 'FM_WIPE_ALL_ORDERS_CONFIRMED_2026' }
      }).catch(() => {});
    };
    runWatch();
    const interval = setInterval(runWatch, 60000);
    return () => clearInterval(interval);
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
    '/orders': { title: 'Orders', subtitle: 'Live customer orders' },
    '/archived-orders': { title: 'Archived Orders', subtitle: 'Historical order repository — safely preserved' },
    '/invoices': { title: 'Invoices', subtitle: 'Billing tracking — collected, pending, COD vs prepaid' },
    '/payments': { title: 'Payments', subtitle: 'Every gateway transaction — PhonePe / PayU / COD, no gateway login needed' },
    '/products': { title: 'Product Prices', subtitle: 'Dynamic pricing — updates the customer app on refresh' },
    '/categories': { title: 'Categories', subtitle: 'App sections — add pharma, travel, insurance with static or animated logos' },
    '/banners': { title: 'Festival Banners', subtitle: 'Home-screen campaigns — no app update needed' },
    '/promos': { title: 'Promo Codes', subtitle: 'Discount coupons — live on customer site instantly' },
    '/customers': { title: 'Customers', subtitle: 'Customer management' },
    '/partners': { title: 'Delivery Partners', subtitle: 'Partner management' },
    '/approvals': { title: 'Pending Approvals', subtitle: 'New delivery partners awaiting review' },
    '/earnings': { title: 'Earnings', subtitle: 'Delivery earnings — credited only after successful delivery' },
    '/withdrawals': { title: 'Withdrawals', subtitle: 'Rider payout requests — approve after paying' },
    '/analytics': { title: 'Analytics', subtitle: 'Performance insights' },
    '/calls': { title: 'Call Recordings', subtitle: 'Customer ↔ rider VoIP captures — numbers stay hidden' },
    '/logs': { title: 'Admin Audit Logs', subtitle: 'All administrative actions — immutable record' },
    '/settings': { title: 'Settings', subtitle: 'Maintenance mode — site ON/OFF without deploy' },
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
            <button className="menu-btn" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">☰</button>
            <div className="topbar-heading">
              <div className="topbar-title-row">
                <h1 className="topbar-title">{current.title}</h1>
                <span className="topbar-env-pill">Console</span>
              </div>
              <p className="topbar-subtitle">{current.subtitle}</p>
            </div>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <span className="search-icon">🔍</span>
              <input
                id="global-search-input"
                placeholder="Search orders, customers, partners..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              {globalSearch ? (
                <button className="search-clear" onClick={() => setGlobalSearch('')} title="Clear search">✕</button>
              ) : (
                <kbd className="search-hint">⌘K</kbd>
              )}
            </div>
            <div className="topbar-clock" title={now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
              <span className="clock-icon">🕒</span>
              <span>{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
            </div>
            <div className="live-badge">
              <span className="live-dot-sm" />
              <span>LIVE</span>
            </div>
          </div>
        </div>
        <div className="content">
          <div key={location.pathname} className="page-enter">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/orders" element={<Orders globalSearch={globalSearch} />} />
            <Route path="/archived-orders" element={<ArchivedOrders globalSearch={globalSearch} />} />
            <Route path="/orders/:orderId" element={<OrderDetail />} />
            <Route path="/invoices" element={<Invoices globalSearch={globalSearch} />} />
            <Route path="/payments" element={<Payments globalSearch={globalSearch} />} />
            <Route path="/products" element={<Products globalSearch={globalSearch} />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/banners" element={<Banners globalSearch={globalSearch} />} />
            <Route path="/notices" element={<NoticeBoard globalSearch={globalSearch} />} />
            <Route path="/notice-board" element={<NoticeBoard globalSearch={globalSearch} />} />
            <Route path="/promos" element={<Promos globalSearch={globalSearch} />} />
            <Route path="/customers" element={<Customers globalSearch={globalSearch} />} />
            <Route path="/partners" element={<Partners globalSearch={globalSearch} />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/withdrawals" element={<Withdrawals />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/calls" element={<CallRecordings globalSearch={globalSearch} />} />
            <Route path="/logs" element={<ActivityLogs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

// Detect whether the app is hosted under /admin or root /
const getBasename = () => {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return '/admin';
  }
  return undefined;
};

export default function App() {
  return (
    <BrowserRouter basename={getBasename()}>
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
  if (loading) return <AdminSplashLoader message="Connecting to Food Mela Cloud..." />;
  if (isAdmin) return <Navigate to="/" replace />;
  return <Login />;
}
