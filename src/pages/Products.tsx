import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, Toast, Pagination, ConfirmDialog } from '../components/UI';
import { CATALOG, CATEGORY_LABELS, type CatalogItem } from '../data/catalog';

const PAGE_SIZE = 20;

// Free image hosting (no Firebase Storage / Blaze upgrade needed).
// ImgBB key is entered by admin in the UI, kept in sessionStorage only.
async function uploadToImgBB(dataUrl: string, apiKey: string): Promise<string> {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const body = new URLSearchParams();
  body.set('key', apiKey);
  body.set('image', base64);
  const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body });
  if (!res.ok) throw new Error(`ImgBB upload error ${res.status}`);
  const data = (await res.json()) as { data?: { url?: string; display_url?: string }; error?: { message?: string } };
  const url = data.data?.display_url ?? data.data?.url;
  if (!url) throw new Error(data.error?.message ?? 'ImgBB returned no URL');
  return url;
}

// FREE AI food photo — Pollinations, no key. Seed URLs are permanent.
function pollinationsFoodUrl(prompt: string, seed: number): string {
  const styled = `professional food photography, appetizing Indian dish on clean background, restaurant menu photo, no text: ${prompt.trim()}`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=600&height=400&seed=${seed}&nologo=true&model=turbo`;
}

function preloadImage(url: string, timeoutMs = 90000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const img = new Image();
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

interface PriceRow {
  id: string; // itemId, e.g. cf1
  price?: number;
  mrp?: number;
  name?: string;
}

interface CustomRow {
  id: string;
  name?: string;
  category?: string;
  price?: number;
  mrp?: number;
  rating?: number;
  image?: string;
  isVeg?: boolean;
  isRawItem?: boolean;
  unit?: string;
  unitOptions?: string[];
  freshnessTag?: string;
  isPopular?: boolean;
  isBestDeal?: boolean;
  isFreshToday?: boolean;
  dealText?: string;
  isActive?: boolean;
}

interface Editing {
  id: string;
  name: string;
  price: string;
  mrp: string;
}

const emptyItemForm = {
  name: '',
  category: 'cooked_food',
  price: '',
  mrp: '',
  rating: '4.5',
  image: '',
  isVeg: true,
  isRawItem: false,
  unit: 'portion',
  unitOptions: '1 portion',
  freshnessTag: '',
  isPopular: false,
  isBestDeal: false,
  isFreshToday: false,
  dealText: '',
  isActive: true,
  aiPrompt: '',
};

export default function Products({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [customs, setCustoms] = useState<CustomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tab, setTab] = useState<'bundled' | 'custom'>('bundled');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  // Add/edit custom item dialog
  const [form, setForm] = useState<typeof emptyItemForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomRow | null>(null);
  // ImgBB key (session only) + AI photo state
  const [imgbbKey, setImgbbKey] = useState(() => sessionStorage.getItem('imgbb_key') ?? '');
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [aiOk, setAiOk] = useState(false);

  useEffect(() => {
    const un1 = onSnapshot(collection(db, 'product_prices'), (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceRow, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    const un2 = onSnapshot(collection(db, 'custom_products'), (snap) => {
      setCustoms(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomRow, 'id'>) })));
    }, () => {});
    return () => { un1(); un2(); };
  }, []);

  const overrideById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Full catalog with live effective prices — admin picks BY NAME, never an ID.
  const items = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    return CATALOG.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (s && !`${c.name} ${c.categoryLabel}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [search, globalSearch, categoryFilter]);

  const filteredCustoms = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    return customs.filter((c) => {
      if (categoryFilter !== 'all' && (c.category ?? 'cooked_food') !== categoryFilter) return false;
      if (s && !`${c.name ?? ''} ${c.id}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [customs, search, globalSearch, categoryFilter]);

  useEffect(() => { setPage(1); }, [search, globalSearch, categoryFilter, tab]);

  const listLen = tab === 'bundled' ? items.length : filteredCustoms.length;
  const totalPages = Math.max(1, Math.ceil(listLen / PAGE_SIZE));
  const paged = tab === 'bundled'
    ? items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filteredCustoms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openEdit = (c: CatalogItem) => {
    const o = overrideById.get(c.id);
    setEditing({
      id: c.id,
      name: c.name,
      price: String(o?.price ?? c.basePrice),
      mrp: o?.mrp ? String(o.mrp) : '',
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    const price = Number(editing.price);
    const mrpRaw = editing.mrp.trim();
    const mrp = mrpRaw === '' ? null : Number(mrpRaw);
    if (!Number.isFinite(price) || price < 0) {
      setToast({ message: 'Enter a valid selling price (0 or more)', type: 'error' });
      return;
    }
    if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) {
      setToast({ message: 'MRP must be empty or a positive number', type: 'error' });
      return;
    }
    if (mrp !== null && mrp <= price) {
      setToast({ message: 'MRP should be higher than the selling price (e.g. MRP 280, price 240)', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        price,
        name: editing.name,
        updatedAt: serverTimestamp(),
      };
      if (mrp !== null) payload.mrp = mrp;
      await setDoc(doc(db, 'product_prices', editing.id), payload, { merge: true });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: 'productPriceUpdated',
        targetId: editing.id,
        targetType: 'product',
        metadata: { name: editing.name, price, ...(mrp !== null ? { mrp } : {}) },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({
        message: mrp !== null
          ? `${editing.name}: ₹${mrp} → ₹${price} ✅`
          : `${editing.name}: ₹${price} ✅`,
        type: 'success',
      });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setEditing(null);
  };

  // ── Custom items: add / edit / toggle / delete ──────────────────────────
  const openNewItem = () => { setFormId(null); setForm({ ...emptyItemForm }); setAiPreview(''); setAiOk(false); };
  const openEditItem = (r: CustomRow) => {
    setFormId(r.id);
    setForm({
      name: r.name ?? '',
      category: r.category ?? 'cooked_food',
      price: r.price != null ? String(r.price) : '',
      mrp: r.mrp != null ? String(r.mrp) : '',
      rating: String(r.rating ?? 4.5),
      image: r.image ?? '',
      isVeg: r.isVeg ?? true,
      isRawItem: r.isRawItem ?? false,
      unit: r.unit ?? 'portion',
      unitOptions: (r.unitOptions ?? ['1 portion']).join(', '),
      freshnessTag: r.freshnessTag ?? '',
      isPopular: r.isPopular ?? false,
      isBestDeal: r.isBestDeal ?? false,
      isFreshToday: r.isFreshToday ?? false,
      dealText: r.dealText ?? '',
      isActive: r.isActive ?? true,
      aiPrompt: '',
    });
    setAiPreview('');
    setAiOk(false);
  };

  const handlePhotoFile = async (file: File) => {
    if (!form) return;
    if (!imgbbKey.trim()) {
      setToast({ message: 'Pehle ImgBB API key dalo (free — imgbb.com par banao)', type: 'error' });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('File read failed'));
        r.readAsDataURL(file);
      });
      const url = await uploadToImgBB(dataUrl, imgbbKey.trim());
      setForm({ ...form, image: url });
      setToast({ message: 'Photo uploaded ✅', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Upload failed', type: 'error' });
    }
    setUploading(false);
  };

  const handleAiPhoto = async () => {
    if (!form || !form.aiPrompt.trim()) {
      setToast({ message: 'Pehle AI prompt likho (e.g. crispy masala dosa)', type: 'error' });
      return;
    }
    setAiLoading(true);
    setAiOk(false);
    const url = pollinationsFoodUrl(form.aiPrompt.trim(), Date.now() % 1000000);
    const ok = await preloadImage(url, 90000);
    if (ok) {
      setAiPreview(url);
      setAiOk(true);
    } else {
      setToast({ message: 'AI photo load nahi hui — dobara try karo', type: 'error' });
    }
    setAiLoading(false);
  };

  const handleSaveItem = async () => {
    if (!form) return;
    const name = form.name.trim();
    const price = Number(form.price);
    const mrpRaw = form.mrp.trim();
    const mrp = mrpRaw === '' ? null : Number(mrpRaw);
    const rating = Number(form.rating);
    if (!name) { setToast({ message: 'Item ka naam likho', type: 'error' }); return; }
    if (!Number.isFinite(price) || price < 0) { setToast({ message: 'Sahi price dalo (0 ya zyada)', type: 'error' }); return; }
    if (mrp !== null && (!Number.isFinite(mrp) || mrp <= price)) { setToast({ message: 'MRP price se zyada hona chahiye', type: 'error' }); return; }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) { setToast({ message: 'Rating 1–5 ke beech rakho', type: 'error' }); return; }
    const units = form.unitOptions.split(',').map((u) => u.trim()).filter(Boolean);
    setSaving(true);
    try {
      const payload = {
        name,
        category: form.category,
        price,
        ...(mrp !== null ? { mrp } : {}),
        rating,
        image: form.image.trim(),
        isVeg: form.isVeg,
        isRawItem: form.isRawItem,
        unit: form.unit.trim() || 'portion',
        unitOptions: units.length ? units : ['1 portion'],
        freshnessTag: form.freshnessTag.trim(),
        isPopular: form.isPopular,
        isBestDeal: form.isBestDeal,
        isFreshToday: form.isFreshToday,
        dealText: form.dealText.trim(),
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      const id = formId ?? `custom-${Date.now()}`;
      // Product write FIRST — this is the real save. A permission error here
      // means the admin session isn't Firebase-authed (re-login required).
      try {
        if (formId) {
          await updateDoc(doc(db, 'custom_products', formId), payload);
        } else {
          await setDoc(doc(db, 'custom_products', id), { ...payload, createdAt: serverTimestamp() });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Save failed';
        const denied = /permission|denied|insufficient/i.test(msg);
        setToast({
          message: denied
            ? '❌ Write denied — log OUT and log back IN as admin, then retry.'
            : `❌ Save failed: ${msg}`,
          type: 'error',
        });
        setSaving(false);
        return;
      }
      // Audit log is best-effort — never masks a successful product save.
      try {
        await addDoc(collection(db, 'admin_audit_logs'), {
          adminPhone: user?.uid ?? 'admin',
          adminName: adminName || 'Admin',
          action: formId ? 'customProductUpdated' : 'customProductCreated',
          targetId: id,
          targetType: 'product',
          metadata: { name, price, category: form.category },
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch { /* audit failure must not fake a product error */ }
      setToast({ message: formId ? `"${name}" updated ✅` : `"${name}" app me live ho gaya ✅ (refresh par dikhega)`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setForm(null);
    setFormId(null);
  };

  const handleToggleItem = async (r: CustomRow) => {
    try {
      await updateDoc(doc(db, 'custom_products', r.id), { isActive: !(r.isActive ?? true), updatedAt: serverTimestamp() });
      setToast({ message: r.isActive ? `"${r.name}" app se hataya` : `"${r.name}" app me live ✅`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Action failed', type: 'error' });
    }
  };

  const handleDeleteItem = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, 'custom_products', deleting.id));
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: 'customProductDeleted',
        targetId: deleting.id,
        targetType: 'product',
        metadata: { name: deleting.name ?? deleting.id },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: 'Item deleted', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Delete failed', type: 'error' });
    }
    setDeleting(null);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search by food name..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openNewItem}>➕ Add New Item</button>
        </div>
        <div className="filters-row">
          <button className={`chip ${tab === 'bundled' ? 'chip-active' : ''}`} onClick={() => setTab('bundled')}>
            📦 App Menu ({CATALOG.length})
          </button>
          <button className={`chip ${tab === 'custom' ? 'chip-active' : ''}`} onClick={() => setTab('custom')}>
            ✨ My Added Items ({customs.length})
          </button>
          <span className="chip" style={{ cursor: 'default', opacity: 0.9 }}>
            🧮 TOTAL LIVE: {CATALOG.length + customs.filter((c) => c.isActive ?? true).length}
          </span>
        </div>
        <div className="filters-row">
          <span className="filter-label">Category:</span>
          {['all', ...Object.keys(CATEGORY_LABELS)].map((v) => (
            <button key={v} className={`chip ${categoryFilter === v ? 'chip-active' : ''}`} onClick={() => setCategoryFilter(v)}>
              {v === 'all' ? 'All' : CATEGORY_LABELS[v]}
            </button>
          ))}
        </div>
        <span className="muted">
          {tab === 'bundled'
            ? 'Pick a food by name — prices update in the customer app on refresh. Optional MRP shows as strikethrough (e.g. ₹280 → ₹240).'
            : 'Items you add here appear in the customer app + website on refresh — no app update needed. Disable hides instantly.'}
        </span>
      </div>

      {listLen === 0 ? (
        <EmptyState
          icon={tab === 'custom' ? '✨' : '🔍'}
          title={tab === 'custom' ? 'No added items yet' : 'No matching items'}
          subtitle={tab === 'custom' ? '➕ Add New Item dabao — naam, price, photo dalo, app me live!' : 'Try a different food name or category.'}
        />
      ) : tab === 'bundled' ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Food</th><th>Category</th><th>App Price</th><th>Actions</th></tr></thead>
              <tbody>
                {(paged as CatalogItem[]).map((c) => {
                  const o = overrideById.get(c.id);
                  const price = o?.price ?? c.basePrice;
                  const mrp = o?.mrp;
                  const hasOverride = o !== undefined;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="cell-main">{c.name}</div>
                        <div className="cell-sub">{hasOverride ? '✏️ Custom price' : 'Bundled price'}</div>
                      </td>
                      <td>{c.categoryLabel}</td>
                      <td>
                        <strong>₹{price.toLocaleString('en-IN')}</strong>
                        {mrp != null && mrp > price && (
                          <span className="cell-sub" style={{ textDecoration: 'line-through', marginLeft: 8 }}>₹{mrp.toLocaleString('en-IN')}</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>Edit price</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {(paged as CustomRow[]).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {r.image ? (
                          <img src={r.image} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 10 }} loading="lazy" />
                        ) : (
                          <div style={{ width: 52, height: 52, borderRadius: 10, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🍽️</div>
                        )}
                        <div>
                          <div className="cell-main">{r.isVeg === false ? '🔴' : '🟢'} {r.name ?? r.id}</div>
                          <div className="cell-sub">★ {r.rating ?? 4.5}{r.freshnessTag ? ` • ${r.freshnessTag}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{CATEGORY_LABELS[r.category ?? 'cooked_food'] ?? r.category}</td>
                    <td>
                      <strong>₹{(r.price ?? 0).toLocaleString('en-IN')}</strong>
                      {r.mrp != null && r.mrp > (r.price ?? 0) && (
                        <span className="cell-sub" style={{ textDecoration: 'line-through', marginLeft: 8 }}>₹{r.mrp.toLocaleString('en-IN')}</span>
                      )}
                    </td>
                    <td><span className={`badge ${r.isActive ?? true ? 'badge-active' : 'badge-blocked'}`}>{(r.isActive ?? true) ? 'LIVE' : 'HIDDEN'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => openEditItem(r)}>Edit</button>
                        <button className={`btn btn-sm ${(r.isActive ?? true) ? 'btn-danger' : 'btn-success'}`} onClick={() => handleToggleItem(r)}>
                          {(r.isActive ?? true) ? 'Hide' : 'Show'}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDeleting(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {editing && (
        <div className="dialog-overlay" onClick={() => setEditing(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{editing.name}</h3>
            <p>Changing this price updates the customer app after refresh — no app update needed.</p>
            <div className="form-group">
              <label>Selling price (₹)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 240"
                value={editing.price}
                onChange={(e) => setEditing({ ...editing, price: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>MRP — strikethrough (₹, optional)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 280 — empty = no strikethrough"
                value={editing.mrp}
                onChange={(e) => setEditing({ ...editing, mrp: e.target.value })}
              />
            </div>
            {editing.mrp.trim() !== '' && Number(editing.mrp) > Number(editing.price) && (
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Preview: <span style={{ textDecoration: 'line-through', color: '#94A3B8' }}>₹{editing.mrp}</span>{' '}
                <strong>₹{editing.price}</strong>
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving...' : 'Save price'}
              </button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="dialog-overlay" onClick={() => { setForm(null); setFormId(null); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>{formId ? 'Edit item' : '➕ Add New Item'}</h3>
            <p>Save karte hi customer app + website me dikhega (refresh par) — koi app update nahi chahiye.</p>
            <div className="form-group"><label>Item name *</label><input placeholder="e.g. Masala Dosa" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Veg / Non-veg</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`chip ${form.isVeg ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isVeg: true })}>🟢 Veg</button>
                  <button className={`chip ${!form.isVeg ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isVeg: false })}>🔴 Non-veg</button>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="form-group"><label>Price (₹) *</label><input type="number" min="0" placeholder="99" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div className="form-group"><label>MRP (₹, optional)</label><input type="number" min="0" placeholder="129" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} /></div>
              <div className="form-group"><label>Rating (1–5)</label><input type="number" min="1" max="5" step="0.1" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} /></div>
            </div>

            {/* ── PHOTO: upload / URL / AI ─────────────────────────── */}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>📸 Item Photo</div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>ImgBB API key (free — imgbb.com → API, session me hi rehta hai)</label>
                <input
                  placeholder="paste key once per session"
                  type="password"
                  value={imgbbKey}
                  onChange={(e) => { setImgbbKey(e.target.value); sessionStorage.setItem('imgbb_key', e.target.value); }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading...' : '📤 Upload photo'}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ''; }} />
                </label>
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>…or paste image URL</label><input placeholder="https://..." value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>…or describe for FREE AI photo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="e.g. crispy masala dosa with chutney" value={form.aiPrompt} onChange={(e) => setForm({ ...form, aiPrompt: e.target.value })} style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-primary" disabled={aiLoading || !form.aiPrompt.trim()} onClick={handleAiPhoto}>
                    {aiLoading ? '...' : '✨ AI'}
                  </button>
                </div>
              </div>
              {aiPreview !== '' && aiOk && (
                <div style={{ marginBottom: 8 }}>
                  <img src={aiPreview} alt="AI preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  <button className="btn btn-sm btn-success" style={{ width: '100%', marginTop: 6 }} onClick={() => { setForm({ ...form, image: aiPreview }); setToast({ message: 'AI photo lag gayi ✅', type: 'success' }); }}>
                    ✅ Use this AI photo
                  </button>
                </div>
              )}
              {form.image.trim() !== '' && (
                <img src={form.image.trim()} alt="preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label>Tag (optional, e.g. 🔥 Bestseller)</label><input placeholder="🔥 Bestseller" value={form.freshnessTag} onChange={(e) => setForm({ ...form, freshnessTag: e.target.value })} /></div>
              <div className="form-group"><label>Deal text (optional)</label><input placeholder="Buy 1 Get 1" value={form.dealText} onChange={(e) => setForm({ ...form, dealText: e.target.value })} /></div>
            </div>
            <div className="form-group">
              <label>Badges</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className={`chip ${form.isPopular ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isPopular: !form.isPopular })}>⭐ Popular</button>
                <button className={`chip ${form.isBestDeal ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isBestDeal: !form.isBestDeal })}>💰 Best Deal</button>
                <button className={`chip ${form.isFreshToday ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isFreshToday: !form.isFreshToday })}>🌿 Fresh Today</button>
              </div>
            </div>
            <div className="form-group">
              <label>Raw item? (vegetables/grocery with units like 1kg, 500g)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className={`chip ${form.isRawItem ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isRawItem: !form.isRawItem })}>
                  {form.isRawItem ? 'Yes — raw with units ✓' : 'No — fixed portion'}
                </button>
              </div>
            </div>
            {form.isRawItem && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <div className="form-group"><label>Base unit</label><input placeholder="1 kg" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
                <div className="form-group"><label>Unit options (comma me)</label><input placeholder="500g, 1 kg, 2 kg, 5 kg" value={form.unitOptions} onChange={(e) => setForm({ ...form, unitOptions: e.target.value })} /></div>
              </div>
            )}
            <div className="form-group">
              <label>Visible in app?</label>
              <button className={`chip ${form.isActive ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                {form.isActive ? 'Live ✓' : 'Hidden'}
              </button>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => { setForm(null); setFormId(null); }}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || uploading} onClick={handleSaveItem}>
                {saving ? 'Saving...' : formId ? 'Save changes' : '🚀 Add to App'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete item?"
        message={`"${deleting?.name || deleting?.id}" will be removed from the app menu.`}
        confirmLabel="Delete"
        confirmColor="#DC2626"
        onConfirm={handleDeleteItem}
        onCancel={() => setDeleting(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
