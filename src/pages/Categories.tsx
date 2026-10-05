import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, Toast, ConfirmDialog } from '../components/UI';

export interface CategoryRow {
  id: string; // key, e.g. pharma
  label?: string;
  icon?: string; // emoji fallback
  logoUrl?: string; // static image
  animationUrl?: string; // animated (gif/webp/lottie json url)
  logoType?: 'emoji' | 'static' | 'animated';
  sortOrder?: number;
  isActive?: boolean;
}

const emptyForm = {
  key: '',
  label: '',
  icon: '🏷️',
  logoUrl: '',
  animationUrl: '',
  logoType: 'emoji' as 'emoji' | 'static' | 'animated',
  sortOrder: '0',
  isActive: true,
};

async function uploadCategoryLogo(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 4).replace(/[^a-z0-9]/g, '') || 'png';
  const path = `category_logos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/png' });
  return getDownloadURL(snap.ref);
}

export default function Categories() {
  const { user, adminName } = useAuth();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const un = onSnapshot(collection(db, 'app_categories'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CategoryRow, 'id'>) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setRows(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => un();
  }, []);

  const openNew = () => { setFormId(null); setForm({ ...emptyForm }); };
  const openEdit = (r: CategoryRow) => {
    setFormId(r.id);
    setForm({
      key: r.id,
      label: r.label ?? r.id,
      icon: r.icon ?? '🏷️',
      logoUrl: r.logoUrl ?? '',
      animationUrl: r.animationUrl ?? '',
      logoType: r.logoType ?? (r.animationUrl ? 'animated' : r.logoUrl ? 'static' : 'emoji'),
      sortOrder: String(r.sortOrder ?? 0),
      isActive: r.isActive ?? true,
    });
  };

  const handleFile = async (file: File, field: 'logoUrl' | 'animationUrl') => {
    if (!form) return;
    if (file.size > 5 * 1024 * 1024) { setToast({ message: 'File 5MB se chhoti honi chahiye', type: 'error' }); return; }
    setUploading(true);
    try {
      const url = await uploadCategoryLogo(file);
      setForm({ ...form, [field]: url });
      setToast({ message: 'Logo uploaded ✅', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Upload failed', type: 'error' });
    }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form) return;
    const key = (formId ?? form.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const label = form.label.trim() || key;
    if (!key) { setToast({ message: 'Category key likho (e.g. pharma)', type: 'error' }); return; }
    setSaving(true);
    try {
      const payload = {
        label,
        icon: form.icon.trim() || '🏷️',
        logoUrl: form.logoUrl.trim(),
        animationUrl: form.animationUrl.trim(),
        logoType: form.logoType,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      if (formId) {
        await updateDoc(doc(db, 'app_categories', formId), payload);
      } else {
        await setDoc(doc(db, 'app_categories', key), { ...payload, createdAt: serverTimestamp() });
      }
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: formId ? 'categoryUpdated' : 'categoryCreated',
        targetId: key,
        targetType: 'category',
        metadata: { label },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: `Category "${label}" live ✅`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setForm(null);
    setFormId(null);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, 'app_categories', deleting.id));
      setToast({ message: 'Category deleted', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Delete failed', type: 'error' });
    }
    setDeleting(null);
  };

  const toggleActive = async (r: CategoryRow) => {
    try {
      await updateDoc(doc(db, 'app_categories', r.id), { isActive: !(r.isActive ?? true), updatedAt: serverTimestamp() });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Update failed', type: 'error' });
    }
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div>
            <h3 style={{ margin: 0 }}>🗂️ Categories</h3>
            <p className="muted" style={{ margin: '4px 0 0' }}>Add pharma, travel, insurance… — customer app me alag section ke saath live. Static ya animated logo lagao.</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={openNew}>➕ Add Category</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="🗂️" title="No categories yet" subtitle="➕ Add Category dabao — pharma, travel, insurance…" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Logo</th><th>Key</th><th>Label</th><th>Type</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 26 }}>
                    {r.logoType === 'animated' && r.animationUrl
                      ? <img src={r.animationUrl} alt={r.id} style={{ width: 34, height: 34, objectFit: 'contain' }} />
                      : r.logoType === 'static' && r.logoUrl
                      ? <img src={r.logoUrl} alt={r.id} style={{ width: 34, height: 34, objectFit: 'contain' }} />
                      : (r.icon || '🏷️')}
                  </td>
                  <td><code>{r.id}</code></td>
                  <td>{r.label ?? r.id}</td>
                  <td>{r.logoType ?? 'emoji'}</td>
                  <td>{r.sortOrder ?? 0}</td>
                  <td>
                    <button type="button" className={`chip ${(r.isActive ?? true) ? 'chip-active' : ''}`} onClick={() => toggleActive(r)}>
                      {(r.isActive ?? true) ? 'Live ✓' : 'Hidden'}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(r)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setDeleting(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="dialog-overlay" onClick={() => { setForm(null); setFormId(null); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>{formId ? '✏️ Edit Category' : '➕ Add Category'}</h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>Key = app section id (pharma, travel…). Customer app me turant alag section banega.</p>
            {!formId && (
              <div className="form-group"><label>Key * (lowercase, e.g. pharma)</label><input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="pharma" /></div>
            )}
            <div className="form-group"><label>Label *</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Pharma & Medicine" /></div>
            <div className="form-group"><label>Sort order</label><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></div>
            <div className="form-group">
              <label>Logo type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['emoji', 'static', 'animated'] as const).map((t) => (
                  <button key={t} type="button" className={`chip ${form.logoType === t ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, logoType: t })}>
                    {t === 'emoji' ? '😀 Emoji' : t === 'static' ? '🖼️ Static' : '✨ Animated'}
                  </button>
                ))}
              </div>
            </div>
            {form.logoType === 'emoji' && (
              <div className="form-group"><label>Emoji</label><input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="💊" /></div>
            )}
            {form.logoType === 'static' && (
              <div className="form-group">
                <label>Static logo (upload ya URL)</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                    {uploading ? 'Uploading...' : '📤 Upload'}
                    <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, 'logoUrl'); e.target.value = ''; }} />
                  </label>
                </div>
                <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://..." />
                {form.logoUrl !== '' && <img src={form.logoUrl} alt="preview" style={{ width: '100%', height: 100, objectFit: 'contain', marginTop: 8 }} />}
              </div>
            )}
            {form.logoType === 'animated' && (
              <div className="form-group">
                <label>Animated logo — GIF/WebP upload ya Lottie JSON URL</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                    {uploading ? 'Uploading...' : '📤 Upload GIF/WebP'}
                    <input type="file" accept="image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, 'animationUrl'); e.target.value = ''; }} />
                  </label>
                </div>
                <input value={form.animationUrl} onChange={(e) => setForm({ ...form, animationUrl: e.target.value })} placeholder="https://... gif/webp ya lottie .json" />
                {form.animationUrl !== '' && !form.animationUrl.endsWith('.json') && <img src={form.animationUrl} alt="preview" style={{ width: '100%', height: 100, objectFit: 'contain', marginTop: 8 }} />}
              </div>
            )}
            <div className="form-group">
              <label>Visible on Customer App?</label>
              <button type="button" className={`chip ${form.isActive ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                {form.isActive ? 'Live ✓' : 'Hidden'}
              </button>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => { setForm(null); setFormId(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || uploading} onClick={handleSave}>
                {saving ? 'Saving...' : formId ? 'Save Changes' : '🚀 Save & Go Live'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete category?"
        message={`"${deleting?.label || deleting?.id}" hata diya jayega. Uske products orphan ho jayenge (dikhenge nahi).`}
        confirmLabel="Delete"
        confirmColor="#DC2626"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
