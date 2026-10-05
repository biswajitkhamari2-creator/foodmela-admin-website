import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '◧' },
  { to: '/orders', label: 'Orders', icon: '🧾' },
  { to: '/invoices', label: 'Invoices', icon: '🧮' },
  { to: '/payments', label: 'Payments', icon: '💳' },
  { to: '/products', label: 'Prices', icon: '🏷️' },
  { to: '/categories', label: 'Categories', icon: '🗂️' },
  { to: '/banners', label: 'Banners', icon: '🎉' },
  { to: '/promos', label: 'Promo Codes', icon: '🏷️' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/partners', label: 'Delivery Partners', icon: '🛵' },
  { to: '/approvals', label: 'Pending Approvals', icon: '⏳' },
  { to: '/earnings', label: 'Earnings', icon: '💰' },
  { to: '/withdrawals', label: 'Withdrawals', icon: '💸' },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
  { to: '/calls', label: 'Call Recordings', icon: '🎙️' },
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
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
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
            <span>Operations Console</span>
          </div>
        )}
        <button className="collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {!collapsed && <div className="nav-section"><span>OVERVIEW</span></div>}
      <nav className="sidebar-nav">
        {navItems.slice(0, 1).map((item) => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon-box">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </NavLink>
        ))}
        {!collapsed && <div className="nav-section"><span>OPERATIONS</span></div>}
        {navItems.slice(1, 9).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon-box">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
            {!collapsed && item.to === '/approvals' && pendingCount > 0 && (
              <span className="nav-badge">{pendingCount}</span>
            )}
          </NavLink>
        ))}
        {!collapsed && <div className="nav-section"><span>SYSTEM</span></div>}
        {navItems.slice(9).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon-box">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </NavLink>
        ))}
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
                <span className="admin-role-tag">Super Admin</span>
              </div>
              <span className="admin-info-sub">Operations Center</span>
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
