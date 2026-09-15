import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState, ConfirmDialog, Toast } from '../components/UI';

type Withdrawal = {
  id: string;
  riderId?: string;
  riderName?: string;
  amount?: number;
  status?: string;
  createdAt?: unknown;
  decidedAt?: unknown;
  adminNote?: string;
};

export default function Withdrawals() {
  const { user, adminName } = useAuth();
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [confirm, setConfirm] = useState<{ id: string; name: string; amount: number; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'withdrawals'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Withdrawal)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  const shown = useMemo(
    () => (filter === 'pending' ? items.filter((w) => (w.status ?? 'pending') === 'pending') : items),
    [items, filter],
  );
  const pendingCount = useMemo(() => items.filter((w) => (w.status ?? 'pending') === 'pending').length, [items]);
  const pendingTotal = useMemo(
    () => items.filter((w) => (w.status ?? 'pending') === 'pending').reduce((s, w) => s + (w.amount ?? 0), 0),
    [items],
  );

  const handleAction = async () => {
    if (!confirm) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'withdrawals', confirm.id), {
        status: confirm.action === 'approve' ? 'approved' : 'rejected',
        decidedAt: serverTimestamp(),
        adminNote: note.trim(),
        decidedBy: user?.uid ?? 'admin',
      });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
        action: confirm.action === 'approve' ? 'withdrawalApproved' : 'withdrawalRejected',
        targetId: confirm.id, targetType: 'withdrawal',
        metadata: { riderId: items.find((w) => w.id === confirm.id)?.riderId, amount: confirm.amount, note: note.trim() },
        timestamp: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setToast(confirm.action === 'approve' ? `₹${confirm.amount} withdrawal approved` : 'Withdrawal rejected');
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Action failed');
    }
    setProcessing(false);
    setConfirm(null);
    setNote('');
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 200 }} /></div>;

  return (
    <div className="page">
      <div className="earnings-summary">
        <div className="earnings-card">
          <span>Pending Requests</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="earnings-card">
          <span>Pending Amount</span>
          <strong>₹{pendingTotal.toLocaleString('en-IN')}</strong>
        </div>
        <div className="earnings-card">
          <span>Total Requests</span>
          <strong>{items.length}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('pending')}>
          Pending ({pendingCount})
        </button>
        <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('all')}>
          All History
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="💸" title={filter === 'pending' ? 'No pending withdrawals' : 'No withdrawal requests yet'} subtitle={filter === 'pending' ? 'Rider withdrawal requests will appear here for review.' : ''} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Rider</th><th>Amount</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.map((w) => {
                const st = (w.status ?? 'pending').toLowerCase();
                return (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.riderName || '—'}</strong>
                      <br /><span className="cell-sub">{w.riderId || ''}</span>
                    </td>
                    <td><strong>₹{(w.amount ?? 0).toLocaleString('en-IN')}</strong></td>
                    <td><span className="cell-sub">{fmtDateTime(tsToDate(w.createdAt))}</span></td>
                    <td>
                      <span className={`badge ${st === 'approved' ? 'badge-success' : st === 'rejected' ? 'badge-danger' : 'badge-pending'}`}>
                        {st === 'pending' ? 'UNDER REVIEW' : st.toUpperCase()}
                      </span>
                      {w.adminNote && <><br /><span className="cell-sub">{w.adminNote}</span></>}
                    </td>
                    <td>
                      {st === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost" disabled={processing}
                            onClick={() => setConfirm({ id: w.id, name: w.riderName || w.riderId || 'Rider', amount: w.amount ?? 0, action: 'reject' })}>
                            Reject
                          </button>
                          <button className="btn btn-success" disabled={processing}
                            onClick={() => setConfirm({ id: w.id, name: w.riderName || w.riderId || 'Rider', amount: w.amount ?? 0, action: 'approve' })}>
                            Approve
                          </button>
                        </div>
                      ) : (
                        <span className="cell-sub">{w.decidedAt ? fmtDateTime(tsToDate(w.decidedAt)) : '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'approve' ? `Approve ₹${confirm?.amount} for ${confirm?.name}?` : `Reject ₹${confirm?.amount}?`}
        message={confirm?.action === 'approve'
          ? 'Confirm you have paid this amount to the rider. This marks the withdrawal APPROVED.'
          : 'The amount returns to the rider\'s available balance. Optionally add a reason below.'}
        confirmLabel={confirm?.action === 'approve' ? 'Approve & Mark Paid' : 'Reject'}
        confirmColor={confirm?.action === 'approve' ? '#059669' : '#DC2626'}
        onConfirm={handleAction}
        onCancel={() => { setConfirm(null); setNote(''); }}
      >
        <div style={{ marginTop: 12 }}>
          <label className="form-label">Note (optional){confirm?.action === 'reject' ? ' — reason for rejection' : ''}</label>
          <input
            className="form-input"
            placeholder={confirm?.action === 'approve' ? 'e.g. UPI ref 1234' : 'e.g. minimum payout not met'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </ConfirmDialog>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
