import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDate } from '../utils/helpers';
import { EmptyState, ConfirmDialog, Toast, Pagination } from '../components/UI';
import type { UserRecord } from '../types';

const PAGE_SIZE = 20;

export default function Customers({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [customers, setCustomers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; blocked: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'customer'));
    const unsub = onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRecord)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    const isDigits = /^\d{1,4}$/.test(s);
    return customers.filter((c) => {
      const status = c.accountStatus ?? 'active';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!s) return true;
      const hay = `${c.name ?? ''} ${c.email ?? ''} ${c.id}`.toLowerCase();
      if (hay.includes(s)) return true;
      if (isDigits) {
        const digits = (c.id ?? '').replace(/[^0-9]/g, '');
        if (digits.includes(s) || digits.endsWith(s)) return true;
      }
      return false;
    });
  }, [customers, search, globalSearch, statusFilter]);

  useEffect(() => { setPage(1); }, [search, globalSearch, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleToggle = async () => {
    if (!confirm) return;
    const isBlocked = confirm.blocked;
    try {
      await updateDoc(doc(db, 'users', confirm.id), {
        accountStatus: isBlocked ? 'active' : 'blocked',
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: isBlocked ? 'customerUnblocked' : 'customerBlocked',
        targetId: confirm.id,
        targetType: 'customer',
        metadata: {},
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast(isBlocked ? 'Customer unblocked' : 'Customer blocked');
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Action failed');
    }
    setConfirm(null);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  if (customers.length === 0) return <div className="page"><EmptyState icon="👥" title="No customers yet" subtitle="Customers will appear after they sign up." /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search by 4-digit ID, name, phone..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className={`chip ${statusFilter === 'all' ? 'chip-active' : ''}`} onClick={() => setStatusFilter('all')}>All</button>
          <button className={`chip ${statusFilter === 'active' ? 'chip-active' : ''}`} onClick={() => setStatusFilter('active')}>Active</button>
          <button className={`chip ${statusFilter === 'blocked' ? 'chip-active' : ''}`} onClick={() => setStatusFilter('blocked')}>Blocked</button>
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState icon="🔍" title="No matching customers" subtitle="Try adjusting search or filters." /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Customer</th><th>Customer ID</th><th>Email</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead>
              <tbody>
                {paged.map((c) => {
                  const blocked = c.accountStatus === 'blocked';
                  return (
                    <tr key={c.id}>
                      <td><div className="cell-main">{c.name || '—'}</div><div className="cell-sub">{c.id}</div></td>
                      <td className="cell-sub">{c.id}</td>
                      <td>{c.email || '—'}</td>
                      <td><span className={`badge ${blocked ? 'badge-blocked' : 'badge-active'}`}>{blocked ? 'BLOCKED' : 'ACTIVE'}</span></td>
                      <td className="cell-sub">{fmtDate(tsToDate(c.createdAt))}</td>
                      <td><button className={`btn btn-sm ${blocked ? 'btn-success' : 'btn-danger'}`} onClick={() => setConfirm({ id: c.id, blocked })}>{blocked ? 'Unblock' : 'Block'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      <ConfirmDialog open={!!confirm} title={confirm?.blocked ? 'Unblock customer?' : 'Block customer?'} message={confirm?.blocked ? 'This customer will regain access to the app.' : 'This customer will be blocked and cannot use restricted features.'} confirmLabel={confirm?.blocked ? 'Unblock' : 'Block'} confirmColor={confirm?.blocked ? '#059669' : '#DC2626'} onConfirm={handleToggle} onCancel={() => setConfirm(null)} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
