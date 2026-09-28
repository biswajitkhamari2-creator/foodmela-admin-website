import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ConfirmDialog, Toast } from '../components/UI';

export interface PromoRow {
  id: string;
  code?: string;
  title?: string;
  text?: string;
  emoji?: string;
  theme?: 'offer-green' | 'offer-red' | 'offer-dark' | 'offer-gold';
  discountType?: 'flat' | 'percent';
  discountValue?: number;
  maxDiscount?: number;
  minOrder?: number;
  isActive?: boolean;
  sortOrder?: number;
  updatedAt?: unknown;
}

const THEMES: PromoRow['theme'][] = ['offer-green', 'offer-red', 'offer-dark', 'offer-gold'];

const emptyForm = {
  code: '',
  title: '',
  text: '',
  emoji: '🔥',
  theme: 'offer-green' as PromoRow['theme'],
  discountType: 'flat' as PromoRow['discountType'],
  discountValue: '',
  maxDiscount: '',
  minOrder: '',
  isActive: true,
  sortOrder: '0',
};

export default function Promos({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<PromoRow | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'app_promos'), orderBy('sortOrder', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PromoRow, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) => `${r.id} ${r.code ?? ''} ${r.title ?? ''}`.toLowerCase().includes(s));
  }, [rows, search, globalSearch]);

  const openNew = () => { setFormId(null); setForm({ ...emptyForm }); };
  const openEdit = (r: PromoRow) => {
    setFormId(r.id);
    setForm({
      code: r.code ?? '',
      title: r.title ?? '',
      text: r.text ?? '',
      emoji: r.emoji ?? '🔥',
      theme: r.theme ?? 'offer-green',
      discountType: r.discountType ?? 'flat',
      discountValue: String(r.discountValue ?? ''),
      maxDiscount: String(r.maxDiscount ?? ''),
      minOrder: String(r.minOrder ?? ''),
      isActive: r.isActive ?? true,
      sortOrder: String(r.sortOrder ?? 0),
    });
  };

  const handleSave = async () => {
    if (!form) return;
    const code = form.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { setToast({ message: 'Promo code likho (sirf A-Z, 0-9)', type: 'error' }); return; }
    if (!form.title.trim()) { setToast({ message: 'Title likho', type: 'error' }); return; }
    const discountValue = Number(form.discountValue) || 0;
    if (discountValue <= 0) { setToast({ message: 'Discount value 0 se zyada hona chahiye', type: 'error' }); return; }
    setSaving(true);
    try {
      const payload = {
        code,
        title: form.title.trim(),
        text: form.text.trim(),
        emoji: form.emoji.trim() || '🔥',
        theme: form.theme,
        discountType: form.discountType,
        discountValue,
        maxDiscount: Number(form.maxDiscount) || 0,
        minOrder: Number(form.minOrder) || 0,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
        updatedAt: serverTimestamp(),
      };
      const id = formId ?? `promo-${Date.now()}`;
      if (formId) {
        await updateDoc(doc(db, 'app_promos', formId), payload);
      } else {
        await setDoc(doc(db, 'app_promos', id), { ...payload, createdAt: serverTimestamp() });
      }
      try {
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin',
          adminName: adminName || 'Admin',
          action: formId ? 'promoUpdated' : 'promoCreated',
          targetId: id,
          targetType: 'promo',
          metadata: { code: payload.code, isActive: payload.isActive },
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch {
        // Audit log is best-effort — never block or mask promo save
      }
      setToast({ message: formId ? 'Promo updated ✅' : `Promo ${code} created ✅ — customer site par live!`, type: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      const denied = /permission|denied|insufficient/i.test(msg);
      setToast({
        message: denied
          ? '❌ Permission denied — please log out and log back in as admin.'
          : `❌ Save failed: ${msg}`,
        type: 'error',
      });
    }
    setSaving(false);
    setForm(null);
    setFormId(null);
  };

  const handleToggle = async (r: PromoRow) => {
    try {
      await updateDoc(doc(db, 'app_promos', r.id), { isActive: !(r.isActive ?? true), updatedAt: serverTimestamp() });
      try {
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin',
          adminName: adminName || 'Admin',
          action: r.isActive ? 'promoDisabled' : 'promoEnabled',
          targetId: r.id,
          targetType: 'promo',
          metadata: {},
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch {
        // Audit log is best-effort
      }
      setToast({ message: r.isActive ? 'Promo disabled' : 'Promo enabled ✅ — live on site!', type: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      const denied = /permission|denied|insufficient/i.test(msg);
      setToast({
        message: denied
          ? '❌ Permission denied — please log in as admin.'
          : `❌ Action failed: ${msg}`,
        type: 'error',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, 'app_promos', deleting.id));
      try {
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin',
          adminName: adminName || 'Admin',
          action: 'promoDeleted',
          targetId: deleting.id,
          targetType: 'promo',
          metadata: {},
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch {
        // Audit log is best-effort
      }
      setToast({ message: 'Promo deleted ✅', type: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      const denied = /permission|denied|insufficient/i.test(msg);
      setToast({
        message: denied
          ? '❌ Permission denied — please log in as admin.'
          : `❌ Delete failed: ${msg}`,
        type: 'error',
      });
    }
    setDeleting(null);
  };

  const discountLabel = (r: PromoRow) =>
    r.discountType === 'percent'
      ? `${r.discountValue ?? 0}% OFF${(r.maxDiscount ?? 0) > 0 ? ` up to ₹${r.maxDiscount}` : ''}`
      : `₹${r.discountValue ?? 0} OFF`;

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search promos..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openNew}>➕ New promo</button>
        </div>
        <span className="muted">Active promos show instantly on the customer site (Home + Offers page). Discount auto-applies in cart.</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🏷️" title="No promos yet" subtitle="Create a promo code — it appears on the customer site instantly, no app update needed." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Promo</th><th>Discount</th><th>Min order</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-main">
                      {r.emoji ?? '🔥'} {r.title || r.id}
                    </div>
                    <div className="cell-sub">
                      <code style={{ background: '#F1F5F9', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>{r.code}</code>
                      {' '}{r.text || '—'}
                    </div>
                  </td>
                  <td><span className="badge badge-active">{discountLabel(r)}</span></td>
                  <td className="cell-sub">{(r.minOrder ?? 0) > 0 ? `₹${r.minOrder}` : '—'}</td>
                  <td><span className={`badge ${r.isActive ? 'badge-active' : 'badge-blocked'}`}>{r.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(r)}>Edit</button>
                      <button className={`btn btn-sm ${r.isActive ? 'btn-danger' : 'btn-success'}`} onClick={() => handleToggle(r)}>
                        {r.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setDeleting(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="dialog-overlay" onClick={() => { setForm(null); setFormId(null); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3>{formId ? 'Edit promo' : 'New promo code'}</h3>
            <p>Save karte hi customer site (Home + Offers) par live dikhega. Cart me discount auto-apply hoga.</p>
            <div className="form-group"><label>Promo code (A-Z, 0-9)</label><input placeholder="e.g. DIWALI50" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={{ textTransform: 'uppercase', fontWeight: 800, letterSpacing: 1 }} /></div>
            <div className="form-group"><label>Title</label><input placeholder="e.g. Flat 50% OFF" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="form-group"><label>Description</label><input placeholder="e.g. Get 50% OFF up to ₹100 today!" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label>Emoji</label><input placeholder="🔥" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></div>
              <div className="form-group"><label>Card theme</label>
                <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value as PromoRow['theme'] })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                  {THEMES.map((t) => <option key={t ?? ''} value={t ?? ''}>{(t ?? '').replace('offer-', '')}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label>Discount type</label>
                <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as PromoRow['discountType'] })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                  <option value="flat">Flat ₹ OFF</option>
                  <option value="percent">Percent % OFF</option>
                </select>
              </div>
              <div className="form-group"><label>{form.discountType === 'percent' ? 'Percent %' : 'Amount ₹'}</label><input type="number" min="0" placeholder={form.discountType === 'percent' ? 'e.g. 50' : 'e.g. 70'} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label>Max discount ₹ (% only, 0 = no cap)</label><input type="number" min="0" placeholder="e.g. 100" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} /></div>
              <div className="form-group"><label>Min order ₹ (0 = none)</label><input type="number" min="0" placeholder="e.g. 220" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} /></div>
            </div>
            <div className="form-group"><label>Sort order (lowest shows first)</label><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></div>
            <div className="form-group">
              <label>Promo Status (Live on Customer App & Website)</label>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, isActive: true })}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: form.isActive ? '2px solid #059669' : '1px solid #D1D5DB',
                    background: form.isActive ? '#ECFDF5' : '#F9FAFB',
                    color: form.isActive ? '#065F46' : '#6B7280',
                  }}
                >
                  ✓ Active (Live)
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, isActive: false })}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: !form.isActive ? '2px solid #DC2626' : '1px solid #D1D5DB',
                    background: !form.isActive ? '#FEF2F2' : '#F9FAFB',
                    color: !form.isActive ? '#991B1B' : '#6B7280',
                  }}
                >
                  ✕ Disabled (Hidden)
                </button>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => { setForm(null); setFormId(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Save promo'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete promo?"
        message={`"${deleting?.code || deleting?.id}" will be removed from the customer site instantly.`}
        confirmLabel="Delete"
        confirmColor="#DC2626"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
