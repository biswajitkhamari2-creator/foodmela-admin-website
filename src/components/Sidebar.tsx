import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '◧' },
  { to: '/orders', label: 'Orders', icon: '🧾' },
  { to: '/products', label: 'Prices', icon: '🏷️' },
  { to: '/banners', label: 'Banners', icon: '🎉' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/partners', label: 'Delivery Partners', icon: '🛵' },
  { to: '/approvals', label: 'Pending Approvals', icon: '⏳' },
  { to: '/earnings', label: 'Earnings', icon: '💰' },
  { to: '/withdrawals', label: 'Withdrawals', icon: '💸' },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
  { to: '/calls', label: 'Call Recordings', icon: '🎙️' },
  { to: '/logs', label: 'Activity Logs', icon: '📜' },
];

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
        <div className="brand-icon">🍽️</div>
        {!collapsed && (
          <div className="brand-text">
            <strong>FOOD MELA</strong>
            <span>Operations Center</span>
          </div>
        )}
        <button className="collapse-btn" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {!collapsed && <div className="nav-section">OVERVIEW</div>}
      <nav className="sidebar-nav">
        {navItems.slice(0, 1).map((item) => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </NavLink>
        ))}
        {!collapsed && <div className="nav-section">OPERATIONS</div>}
        {navItems.slice(1, 8).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
            {!collapsed && item.to === '/approvals' && pendingCount > 0 && (
              <span className="nav-badge">{pendingCount}</span>
            )}
          </NavLink>
        ))}
        {!collapsed && <div className="nav-section">SYSTEM</div>}
        {navItems.slice(8).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="admin-card">
          <div className="admin-avatar">A</div>
          {!collapsed && (
            <div className="admin-info">
              <strong>{adminName || 'Admin'}</strong>
              <span>Operations</span>
            </div>
          )}
          <span className="live-dot" title="Live" />
        </div>
        {!collapsed && (
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </aside>
  );
}
