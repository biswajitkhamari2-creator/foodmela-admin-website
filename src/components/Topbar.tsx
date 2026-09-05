import { useState } from 'react';

export default function Topbar({
  title,
  subtitle,
  onMenuToggle,
  globalSearch,
  onGlobalSearch,
}: {
  title: string;
  subtitle: string;
  onMenuToggle?: () => void;
  globalSearch?: string;
  onGlobalSearch?: (v: string) => void;
}) {
  const [search, setSearch] = useState(globalSearch ?? '');

  return (
    <header className="topbar">
      <div className="topbar-left">
        {onMenuToggle && (
          <button className="menu-btn" onClick={onMenuToggle}>
            ☰
          </button>
        )}
        <div>
          <h1 className="topbar-title">{title}</h1>
          <p className="topbar-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="topbar-right">
        {onGlobalSearch && (
          <div className="global-search">
            <span className="search-icon">🔍</span>
            <input
              placeholder="Search orders, customers, partners..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                onGlobalSearch(e.target.value);
              }}
            />
          </div>
        )}
        <span className="live-badge">
          <span className="live-dot-sm" /> LIVE
        </span>
      </div>
    </header>
  );
}
