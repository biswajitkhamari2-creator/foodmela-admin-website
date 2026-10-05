export default function AdminSplashLoader({ message = 'Initializing Operations Console...' }: { message?: string }) {
  return (
    <div className="admin-splash-container">
      <div className="admin-splash-card">
        <div className="admin-splash-logo-wrap">
          <div className="admin-splash-glow" />
          <img src="/food_mela_logo.png" alt="Food Mela" className="admin-splash-logo" onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }} />
        </div>

        <div className="admin-splash-brand">
          <div className="admin-splash-title-row">
            <span className="admin-splash-title">FOOD MELA</span>
            <span className="admin-splash-badge">PRO</span>
          </div>
          <p className="admin-splash-subtitle">Operations & Logistics Command</p>
        </div>

        <div className="admin-splash-loader-bar">
          <div className="admin-splash-loader-progress" />
        </div>

        <p className="admin-splash-status">{message}</p>
      </div>
    </div>
  );
}
