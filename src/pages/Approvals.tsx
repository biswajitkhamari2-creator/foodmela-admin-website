import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState, ConfirmDialog, Toast } from '../components/UI';
import { uniquePartnerId } from './Partners';
import type { UserRecord } from '../types';

export default function Approvals() {
  const { user, adminName } = useAuth();
  const [pending, setPending] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ id: string; name: string; action: 'approve' | 'reject' } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'delivery_partner'), where('approvalStatus', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRecord)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const handleAction = async () => {
    if (!confirm) return;
    setProcessing(true);
    try {
      if (confirm.action === 'approve') {
        const pid = await uniquePartnerId(confirm.name);
        await updateDoc(doc(db, 'users', confirm.id), {
          approvalStatus: 'approved', accountStatus: 'active', partnerId: pid,
          approvedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
          action: 'partnerApproved', targetId: confirm.id, targetType: 'partner', metadata: { partnerId: pid, name: confirm.name },
          timestamp: serverTimestamp(), createdAt: serverTimestamp(),
        });
        setToast(`Partner approved — ID: ${pid}`);
      } else {
        await updateDoc(doc(db, 'users', confirm.id), { approvalStatus: 'rejected', updatedAt: serverTimestamp() });
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
          action: 'partnerRejected', targetId: confirm.id, targetType: 'partner', metadata: {},
          timestamp: serverTimestamp(), createdAt: serverTimestamp(),
        });
        setToast('Partner rejected');
      }
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Action failed');
    }
    setProcessing(false);
    setConfirm(null);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 200 }} /></div>;
  if (pending.length === 0) return <div className="page"><EmptyState icon="✓" title="All caught up!" subtitle="No pending partner approvals." /></div>;

  return (
    <div className="page">
      <div className="approvals-grid">
        {pending.map((p) => (
          <div key={p.id} className="approval-card">
            <div className="approval-header">
              <div className="approval-avatar">👤</div>
              <div>
                <strong>{p.name || '—'}</strong>
                <span className="cell-sub">{p.id} • {p.email || '—'}</span>
                <span className="cell-sub">Submitted: {fmtDateTime(tsToDate(p.createdAt))}</span>
              </div>
              <span className="badge badge-pending">PENDING</span>
            </div>
            <div className="approval-actions">
              <button className="btn btn-ghost" onClick={() => setConfirm({ id: p.id, name: p.name || 'Partner', action: 'reject' })} disabled={processing}>Reject</button>
              <button className="btn btn-success" onClick={() => setConfirm({ id: p.id, name: p.name || 'Partner', action: 'approve' })} disabled={processing}>Approve</button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'approve' ? `Approve ${confirm?.name}?` : 'Reject partner?'}
        message={confirm?.action === 'approve' ? 'This will generate a unique Partner ID and make the partner ACTIVE. They can then sign in and receive orders.' : 'The partner will be marked REJECTED and cannot receive orders.'}
        confirmLabel={confirm?.action === 'approve' ? 'Approve' : 'Reject'}
        confirmColor={confirm?.action === 'approve' ? '#059669' : '#DC2626'}
        onConfirm={handleAction}
        onCancel={() => setConfirm(null)}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
