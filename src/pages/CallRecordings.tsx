import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CallLog } from '../components/CallLogsPlayer';
import { fmtDateTime } from '../utils/helpers';
import { EmptyState, Pagination, Toast } from '../components/UI';

// Same-domain backend: foodmela.online/api in production, VITE_BACKEND_URL
// override for local dev, legacy vercel.app URL as last resort.
const BACKEND_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_BACKEND_URL
  ?? (import.meta.env.PROD ? '' : 'https://food-mela-backend.vercel.app');

const PAGE_SIZE = 15;

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'ended':
    case 'accepted':
      return '#059669';
    case 'ringing':
      return '#D97706';
    case 'rejected':
    case 'missed':
    case 'failed':
      return '#DC2626';
    default:
      return '#64748B';
  }
}

function roleLabel(role: string): string {
  return role === 'rider' ? 'Assigned Rider' : 'Customer';
}

export default function CallRecordings({ globalSearch }: { globalSearch?: string }) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [recFilter, setRecFilter] = useState<'all' | 'recorded' | 'no-rec'>('all');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_BASE}/api/admin/call-logs?limit=500`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { logs?: CallLog[] }) => {
        if (cancelled) return;
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setBackendOk(true);
      })
      .catch(() => {
        if (!cancelled) setBackendOk(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = (globalSearch ?? '').trim().toLowerCase();
    return logs.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (recFilter === 'recorded' && !l.recordingUrl) return false;
      if (recFilter === 'no-rec' && l.recordingUrl) return false;
      if (q && !`${l.orderId} ${l.callerRole} ${l.receiverRole} ${l.status}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, statusFilter, recFilter, globalSearch]);

  useEffect(() => setPage(0), [statusFilter, recFilter, globalSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageLogs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const recorded = logs.filter((l) => l.recordingUrl).length;
  const totalSecs = logs.reduce((a, l) => a + (Number(l.duration) || 0), 0);

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => setToast('Recording link copied'),
      () => setToast('Copy failed — long-press the player URL'),
    );
  };

  if (loading) {
    return (
      <div className="page">
        <div className="dash-kpis">
          {[0, 1, 2].map((i) => (
            <div key={i} className="dash-kpi"><div className="skeleton" style={{ height: 64 }} /></div>
          ))}
        </div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  return (
    <div className="page">
      {/* KPI strip */}
      <div className="dash-kpis">
        <div className="dash-kpi">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Total Calls</span>
            <span className="dash-kpi-icon" style={{ background: '#FFF7ED', color: '#F15A24' }}>📞</span>
          </div>
          <span className="dash-kpi-value">{logs.length}</span>
          <span className="dash-kpi-sub">Customer ↔ rider VoIP — numbers hidden</span>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Recorded</span>
            <span className="dash-kpi-icon" style={{ background: '#ECFDF5', color: '#059669' }}>🎙️</span>
          </div>
          <span className="dash-kpi-value">{recorded}</span>
          <span className="dash-kpi-sub">Playable mp3 captures</span>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-top">
            <span className="dash-kpi-label">Talk Time</span>
            <span className="dash-kpi-icon" style={{ background: '#EFF6FF', color: '#2563EB' }}>⏱️</span>
          </div>
          <span className="dash-kpi-value">{fmtDuration(totalSecs)}</span>
          <span className="dash-kpi-sub">Across all captured calls</span>
        </div>
      </div>

      {!backendOk && (
        <div className="info-banner">
          Backend call-log API unreachable — deploy the latest backend to Vercel to see recordings here.
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <div className="filters-row">
          <span className="filter-label">Status</span>
          {['all', 'ended', 'accepted', 'ringing', 'missed', 'rejected', 'failed'].map((s) => (
            <button key={s} className={`chip ${statusFilter === s ? 'chip-active' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="filters-row">
          <span className="filter-label">Recording</span>
          {([['all', 'All'], ['recorded', '🎙️ Recorded'], ['no-rec', 'No recording']] as const).map(([v, label]) => (
            <button key={v} className={`chip ${recFilter === v ? 'chip-active' : ''}`} onClick={() => setRecFilter(v)}>
              {label}
            </button>
          ))}
          <span className="card-hint" style={{ marginLeft: 'auto' }}>
            {filtered.length} of {logs.length} calls
          </span>
        </div>
      </div>

      {/* List */}
      {pageLogs.length === 0 ? (
        <EmptyState
          icon="📞"
          title="No call recordings yet"
          subtitle="Customer ↔ rider VoIP calls appear here with playable mp3 recordings once calls connect."
        />
      ) : (
        <div className="calls-grid">
          {pageLogs.map((log) => (
            <div key={log.id} className="call-card">
              <div className="call-card-head">
                <div className="call-parties">
                  <span className="call-party">{roleLabel(log.callerRole)}</span>
                  <span className="call-arrow">→</span>
                  <span className="call-party">{roleLabel(log.receiverRole)}</span>
                </div>
                <span
                  className="call-status-pill"
                  style={{ background: `${statusColor(log.status)}1A`, color: statusColor(log.status) }}
                >
                  {log.status.toUpperCase()} • {fmtDuration(Number(log.duration) || 0)}
                </span>
              </div>
              <div className="call-card-meta">
                <Link to={`/orders/${encodeURIComponent(log.orderId)}`} className="order-id">
                  Order #{log.orderId}
                </Link>
                <span className="muted">{log.createdAt ? fmtDateTime(new Date(log.createdAt)) : '—'}</span>
              </div>
              {log.recordingUrl ? (
                <div className="call-player-wrap">
                  <audio controls preload="none" src={log.recordingUrl} className="call-audio" />
                  <button className="btn btn-ghost btn-sm" onClick={() => copyLink(log.recordingUrl!)}>
                    🔗 Copy link
                  </button>
                </div>
              ) : (
                <p className="call-no-recording">
                  {log.status === 'ringing'
                    ? '🔔 Ringing… recording starts when the call connects.'
                    : '⚠️ No recording — capture starts only on connected calls.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination page={page + 1} totalPages={totalPages} onPageChange={(p) => setPage(p - 1)} />
      {toast && <Toast message={toast} type="success" onClose={() => setToast('')} />}
    </div>
  );
}
