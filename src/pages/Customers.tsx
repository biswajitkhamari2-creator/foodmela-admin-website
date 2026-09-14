import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDate } from '../utils/helpers';
import { EmptyState, ConfirmDialog, Toast, Pagination } from '../components/UI';
import type { UserRecord } from '../types';

const PAGE_SIZE = 20;

/** Firestore Timestamp / ISO string / millis → epoch millis. Missing = 0. */
function tsMillis(v: unknown): number {
  try {
    if (!v) return 0;
    if (typeof (v as { toMillis?: unknown }).toMillis === 'function') {
      return ((v as { toMillis: () => number }).toMillis() as number) || 0;
    }
    if (typeof v === 'string') {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof v === 'number') return v;
  } catch { /* ignore */ }
  return 0;
}

/** Normalize Indian mobile numbers: strip +91/91 country prefix so
 *  "917606834050" and "7606834050" merge into ONE customer row. */
function normPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('911')) return digits.slice(3);
  return digits;
}

/** Placeholder names the app writes when it doesn't know the real name. */
function isPlaceholderName(n: string): boolean {
  const t = n.trim().toLowerCase();
  return t === '' || t === '—' || t === '-' || t === 'customer' || t === 'user' || t === 'food mela user';
}

/** Pick the best display name: real names beat placeholders.
 * NOTE: NO longest-wins — a fresh short name ("Anchal") must beat a stale
 * long one ("SIPU AMAT"). Recency is handled by doc order (users docs arrive
 * newest-last from the query); here first-seen wins for equal real names. */
function bestName(a: string, b: string): string {
  const ta = a.trim();
  const tb = b.trim();
  if (isPlaceholderName(ta)) return tb;
  if (isPlaceholderName(tb)) return ta;
  return ta;
}

export default function Customers({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; blocked: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Customers WITH a users doc (new signups + synced users).
  const [userCustomers, setUserCustomers] = useState<UserRecord[]>([]);
  // Customers WITHOUT a users doc yet (ordered before sync existed) —
  // derived from order history so previous customers show immediately.
  const [orderCustomers, setOrderCustomers] = useState<UserRecord[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'customer'));
    const unsub = onSnapshot(q, (snap) => {
      // Merge duplicate users docs by normalized phone (with/without 91).
      // NEWEST write wins: compare updatedAt so a fresh rename ("Anchal")
      // always beats a stale duplicate ("SIPU AMAT") — never longest-wins.
      const map = new Map<string, UserRecord>();
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const clean = normPhone(d.id) || normPhone(data.phone);
        if (!clean) return;
        const prev = map.get(clean);
        const name = String(data.name ?? data.fullName ?? '').trim();
        if (!prev) {
          map.set(clean, { id: clean, ...data, phone: clean, source: 'users' } as UserRecord);
        } else {
          const prevTs = tsMillis((prev as unknown as { updatedAt?: unknown }).updatedAt);
          const curTs = tsMillis(data.updatedAt);
          // Newer doc's real name wins; placeholders never overwrite.
          const curName = isPlaceholderName(name) ? '' : name;
          const prevName = isPlaceholderName(prev.name ?? '') ? '' : (prev.name ?? '');
          const winner = curTs >= prevTs ? (curName || prevName) : (prevName || curName);
          if (winner && winner !== (prev.name ?? '')) map.set(clean, { ...prev, name: winner });
          if (!prev.email && data.email) map.set(clean, { ...map.get(clean)!, email: data.email as string });
          // Keep the newest timestamps so later merges compare correctly.
          if (curTs > prevTs) map.set(clean, { ...map.get(clean)!, updatedAt: data.updatedAt as UserRecord['updatedAt'] });
        }
      });
      setUserCustomers([...map.values()]);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
      const map = new Map<string, UserRecord>();
      snap.docs.forEach((d) => {
        const o = d.data() as Record<string, unknown>;
        const clean = normPhone(o.customerPhone);
        if (!clean) return;
        const name = String(o.customerName ?? '').trim();
        const prev = map.get(clean);
        if (!prev) {
          map.set(clean, {
            id: clean,
            name: name || '—',
            email: '',
            phone: clean,
            role: 'customer',
            accountStatus: 'active',
            approvalStatus: 'approved',
            createdAt: (o.createdAt as UserRecord['createdAt']) ?? null,
            source: 'orders',
          });
        } else {
          // Same customer, different order — NEWEST order's real name wins
          // (a rename ships on the next order). Placeholders never overwrite.
          const curTs = tsMillis(o.createdAt);
          const prevTs = tsMillis((prev as unknown as { createdAt?: unknown }).createdAt);
          if (curTs >= prevTs && !isPlaceholderName(name) && name !== (prev.name ?? '')) {
            map.set(clean, { ...prev, name, createdAt: o.createdAt as UserRecord['createdAt'] });
          }
        }
      });
      setOrderCustomers([...map.values()]);
    }, () => {});
    return () => unsub();
  }, []);

  // Merge BOTH sources by normalized phone.
  // PRIORITY: users doc (fresh profile edit) ALWAYS wins over order history.
  // The old bestName() longest-wins logic caused "SIPU AMAT" (9 chars) to
  // beat a fresh "Anchal" (6 chars) — fixed: fresh profile edit is king.
  // Order history only fills gaps (no users doc) or upgrades placeholders.
  const customers = useMemo(() => {
    const map = new Map<string, UserRecord>();
    orderCustomers.forEach((c) => map.set(c.id, c));
    userCustomers.forEach((c) => {
      const prev = map.get(c.id);
      if (!prev) {
        map.set(c.id, c);
      } else {
        const freshName = (c.name ?? '').trim();
        const orderName = (prev.name ?? '').trim();
        // Fresh users-doc name wins — unless it's a placeholder, in which
        // case the order-history name fills in.
        const name = isPlaceholderName(freshName)
          ? (isPlaceholderName(orderName) ? freshName || orderName : orderName)
          : freshName;
        map.set(c.id, {
          ...c,
          name,
          email: c.email || prev.email,
          createdAt: c.createdAt ?? prev.createdAt,
        });
      }
    });
    return [...map.values()];
  }, [userCustomers, orderCustomers]);

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
      // Write the status to BOTH number forms (with/without 91): old
      // duplicate docs may exist, and the server block-check reads both —
      // a stale 'blocked' in either form would keep blocking forever.
      const digits = confirm.id.replace(/[^0-9]/g, '');
      const alt = digits.length === 10 ? `91${digits}` : digits.startsWith('91') ? digits.slice(2) : null;
      const ids = alt && alt !== digits ? [digits, alt] : [digits];
      for (const id of ids) {
        await setDoc(doc(db, 'users', id), {
          phone: id,
          role: 'customer',
          approvalStatus: 'approved',
          accountStatus: isBlocked ? 'active' : 'blocked',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
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
                      <td><div className="cell-main">{c.name || '—'}{c.source === 'orders' && <span className="cell-sub" style={{ marginLeft: 6 }} title="No signup record yet — derived from order history">🧾 orders</span>}</div><div className="cell-sub">{c.id}</div></td>
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
