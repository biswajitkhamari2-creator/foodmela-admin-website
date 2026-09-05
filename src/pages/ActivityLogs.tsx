import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState } from '../components/UI';
import type { AuditLog } from '../types';

const actionLabels: Record<string, string> = {
  customerBlocked: 'Customer Blocked',
  customerUnblocked: 'Customer Unblocked',
  partnerCreated: 'Partner Created',
  partnerApproved: 'Partner Approved',
  partnerRejected: 'Partner Rejected',
  partnerBlocked: 'Partner Blocked',
  partnerUnblocked: 'Partner Unblocked',
};

export default function ActivityLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'admin_audit_logs'), orderBy('timestamp', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  if (logs.length === 0) return <div className="page"><EmptyState icon="📜" title="No audit logs yet" subtitle="Administrative actions will be recorded here." /></div>;

  return (
    <div className="page">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Type</th><th>Time</th><th>Details</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>
                  <div className="cell-main">{log.adminName || '—'}</div>
                  <div className="cell-sub">{log.adminPhone || ''}</div>
                </td>
                <td><span className="badge" style={{ background: '#FFF7ED', color: '#F15A24', border: '1px solid #FDBA74' }}>{actionLabels[log.action] ?? log.action}</span></td>
                <td>{log.targetId}</td>
                <td><span className="badge badge-active">{(log.targetType ?? '').toUpperCase()}</span></td>
                <td className="cell-sub">{fmtDateTime(tsToDate(log.timestamp ?? log.createdAt))}</td>
                <td className="cell-sub">{log.metadata && Object.keys(log.metadata).length ? Object.entries(log.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(' • ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
