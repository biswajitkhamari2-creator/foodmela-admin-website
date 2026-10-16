import { NavLink } from 'react-router-dom';

const mainItems = [
  { to: '/orders', label: 'Orders', icon: '🧾' },
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/products', label: 'Food Menu', icon: '🍔' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
];

const growthItems = [
  { to: '/partners', label: 'Grow your kitchen', icon: '🏪' },
  { to: '/customers', label: 'New Customers', icon: '👥' },
  { to: '/approvals', label: 'New Delivery', icon: '🛵' },
  { to: '/earnings', label: 'This week', icon: '📅' },
];

const moreItems = [
  { to: '/archived-orders', label: 'Archived Orders', icon: '📦' },
  { to: '/invoices', label: 'Invoices', icon: '🧮' },
  { to: '/payments', label: 'Payments', icon: '💳' },
  { to: '/categories', label: 'Categories', icon: '🗂️' },
  { to: '/banners', label: 'Banners', icon: '🎉' },
  { to: '/homepage', label: 'Homepage Builder', icon: '🏠' },
  { to: '/notices', label: 'Notice Board', icon: '📢' },
  { to: '/promos', label: 'Promo Codes', icon: '🏷️' },
  { to: '/withdrawals', label: 'Withdrawals', icon: '💸' },
  { to: '/calls', label: 'Call Recordings', icon: '🎙️' },
  { to: '/reviews', label: 'Reviews', icon: '⭐' },
  { to: '/wallet', label: 'Wallet', icon: '💰' },
  { to: '/logs', label: 'Activity Logs', icon: '📜' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const logoUrl = '/food_mela_logo.png';

export default function Sidebar({
  collapsed,
  onToggle,
  pendingCount,
  onLogout,
  adminName,
}: {
  collapsed: boolean;
  onToggle: () => void;
  pendingCount: number;
  onLogout: () => void;
  adminName: string;
}) {
  const renderItem = (item: { to: string; label: string; icon: string; end?: boolean }) => (
    <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon-box">{item.icon}</span>
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {!collapsed && (item.to === '/approvals') && pendingCount > 0 && (
        <span className="nav-badge">{pendingCount}</span>
      )}
    </NavLink>
  );

  return (
    <aside className={`sidebar fm-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-icon">
          <img src={logoUrl} alt="Food Mela" className="brand-logo-img" onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
        </div>
        {!collapsed && (
          <div className="brand-text">
            <div className="brand-title-wrap">
              <strong>FOOD MELA</strong>
              <span className="brand-badge-pro">PRO</span>
            </div>
            <span>Admin Space</span>
          </div>
        )}
        <button className="collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {mainItems.map((item) => renderItem(item))}
        {!collapsed && <div className="nav-section"><span>GROWTH</span></div>}
        {growthItems.map((item) => renderItem(item))}
        {!collapsed && <div className="nav-section"><span>MANAGE</span></div>}
        {moreItems.map((item) => renderItem(item))}
      </nav>

      <div className="sidebar-footer">
        <div className="admin-card">
          <div className="admin-avatar">
            <span>{adminName ? adminName.charAt(0).toUpperCase() : 'A'}</span>
          </div>
          {!collapsed && (
            <div className="admin-info">
              <div className="admin-info-top">
                <strong>{adminName || 'Admin'}</strong>
                <span className="admin-role-tag">Administrator</span>
              </div>
              <span className="admin-info-sub">Food Mela ADMIN SPACE</span>
            </div>
          )}
          <span className="live-dot" title="Live Operations Online" />
        </div>
        {!collapsed && (
          <button className="logout-btn" onClick={onLogout}>
            <span>⎋</span> Logout
          </button>
        )}
      </div>
    </aside>
  );
}
