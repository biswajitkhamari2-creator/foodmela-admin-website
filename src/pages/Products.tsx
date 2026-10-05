import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, Toast, Pagination, ConfirmDialog } from '../components/UI';
import { CATALOG, CATEGORY_LABELS, type CatalogItem } from '../data/catalog';

const PAGE_SIZE = 20;

// ── Unit presets: admin ticks, never types ──────────────────────────────────
// Cooked food → Half/Full plates. Veg/grocery/dairy → kg steps.
// Piece items (paneer, eggs, etc.) → piece counts.
const WEIGHT_PRESET = ['100g', '250g', '500g', '1 kg', '2 kg', '3 kg', '4 kg', '5 kg'];
const PIECE_PRESET = ['1 pc', '2 pcs', '4 pcs', '6 pcs', '8 pcs', '12 pcs', '1 dozen'];
const COOKED_PRESET = ['Half', 'Full'];
const ML_PRESET = ['200 ml', '300 ml', '500 ml', '1 L'];

function presetForCategory(cat: string): string[] {
  const c = (cat || '').toLowerCase();
  if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) return WEIGHT_PRESET;
  if (['eggs_meat', 'non_veg'].includes(c)) return PIECE_PRESET;
  if (['beverages'].includes(c)) return ML_PRESET;
  if (['cooked_food', 'fast_food', 'snacks', 'chaat', 'sweets', 'breakfast', 'momos'].includes(c)) return COOKED_PRESET;
  return [...COOKED_PRESET, ...WEIGHT_PRESET, ...PIECE_PRESET];
}

function defaultUnitForCategory(cat: string): string {
  const c = (cat || '').toLowerCase();
  if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) return '1 kg';
  if (['eggs_meat', 'non_veg'].includes(c)) return '1 pc';
  if (['beverages'].includes(c)) return '300 ml';
  return 'Full';
}

// ── SIMPLE unit flow (no confusion) ──────────────────────────────────────────
// Step 1: "Unit kaise dena hai?" — kilo-wise / portion-wise / piece-wise.
// Step 2: tick the options to offer. Step 3: price = ONE base price
// (1 kg ka / Full ka) — baaki auto. Step 4: max limit (blank = unlimited).
// Used by BOTH the add/edit form and the price-edit dialog.
type UnitMode = 'kilo' | 'portion' | 'piece';

const UNIT_MODES: { key: UnitMode; label: string; hint: string }[] = [
  { key: 'kilo', label: '⚖️ Kilo-wise', hint: 'Sabzi/grocery/doodh — 250g, 500g, 1 kg, 2 kg…' },
  { key: 'portion', label: '🍛 Portion-wise', hint: 'Cooked food — Half, Full' },
  { key: 'piece', label: '🧩 Piece-wise', hint: 'Paneer/eggs/paste — 1 pc, 2 pcs…' },
];

const UNIT_MODE_OPTIONS: Record<UnitMode, string[]> = {
  kilo: ['250g', '500g', '1 kg', '2 kg', '3 kg', '4 kg', '5 kg', '10 kg'],
  portion: ['Half', 'Full'],
  piece: ['1 pc', '2 pcs', '4 pcs', '6 pcs', '8 pcs', '12 pcs', '1 dozen'],
};

const UNIT_MODE_BASE: Record<UnitMode, string> = {
  kilo: '1 kg',
  portion: 'Full',
  piece: '1 pc',
};

function unitModeForOptions(unitOptions: string, fallbackCategory: string): UnitMode {
  const opts = unitOptions.split(',').map((u) => u.trim()).filter(Boolean);
  if (opts.includes('Half') || opts.includes('Full')) return 'portion';
  if (opts.some((o) => /kg|g\b/i.test(o))) return 'kilo';
  if (opts.some((o) => /pc|dozen/i.test(o))) return 'piece';
  const c = fallbackCategory.toLowerCase();
  if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) return 'kilo';
  if (['eggs_meat', 'non_veg'].includes(c)) return 'piece';
  return 'portion';
}

function UnitPicker({
  category, unitOptions, basePrice, maxQty, onChange,
}: {
  category: string;
  unitOptions: string;
  basePrice: string;
  maxQty: string;
  onChange: (unitOptions: string, maxQty: string) => void;
}) {
  const [mode, setMode] = React.useState<UnitMode>(() => unitModeForOptions(unitOptions, category));
  const preset = UNIT_MODE_OPTIONS[mode];
  const selected = unitOptions.split(',').map((u) => u.trim()).filter(Boolean);
  const toggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter((u) => u !== opt)
      : [...selected, opt];
    next.sort((a, b) => preset.indexOf(a) - preset.indexOf(b));
    onChange(next.join(', '), maxQty);
  };
  const switchMode = (m: UnitMode) => {
    setMode(m);
    // New mode = fresh preset selection (no stale Half mixed with kg).
    onChange(UNIT_MODE_OPTIONS[m].join(', '), maxQty);
  };
  const baseLabel = UNIT_MODE_BASE[mode];
  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>1️⃣ Unit kaise dena hai?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {UNIT_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`chip ${mode === m.key ? 'chip-active' : ''}`}
            title={m.hint}
            onClick={() => switchMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
        2️⃣ Kaun-kaun se options doge? <span style={{ fontWeight: 400, color: '#64748B' }}>(tick karo)</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {preset.map((p) => (
          <button
            key={p}
            type="button"
            className={`chip ${selected.includes(p) ? 'chip-active' : ''}`}
            onClick={() => toggle(p)}
          >
            {selected.includes(p) ? '✓ ' : ''}{p}
          </button>
        ))}
      </div>
      {selected.length === 0 && (
        <p style={{ fontSize: 12, color: '#B45309', marginTop: 8 }}>⚠️ Koi option tick nahi — customer ko quantity nahi dikhegi. Kam se kam 1 tick karo.</p>
      )}
      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '8px 12px', marginTop: 8, fontSize: 12.5, color: '#166534' }}>
        3️⃣ Price: upar jo <strong>₹{basePrice || '…'}</strong> likha hai wahi <strong>{baseLabel}</strong> ka daam hai.
        Baaki auto: {mode === 'kilo' ? '250g = ¼, 500g = ½, 2 kg = double' : mode === 'portion' ? 'Half = aadha' : 'count ke hisaab se'}.
      </div>
      <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>4️⃣ 🔒 Max kitna le sakta hai? (blank = unlimited)</label>
        <input
          type="number"
          min="1"
          placeholder={mode === 'kilo' ? 'e.g. 10 (10 kg tak)' : mode === 'portion' ? 'e.g. 2 (2 Full tak)' : 'e.g. 12'}
          value={maxQty}
          onChange={(e) => onChange(unitOptions, e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14, background: '#FFF' }}
        />
      </div>
    </div>
  );
}

// Product photo upload — Firebase Storage (product_images/), admin session.
// No external API key needed; public read so app + website load it directly.
async function uploadProductPhoto(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 4).replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `product_images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(snap.ref);
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
  image?: string;
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
  priceBasis?: string;
  unitPrices?: Record<string, number>;
  maxQty?: number;
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
  image: string;
  aiPrompt: string;
  unitOptions: string;
  maxQty: string;
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
  unitOptions: 'Half, Full',
  maxQty: '',
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
  // Admin-only mode: bundled demo catalog hidden — only custom (admin-added) products.
  const [tab, setTab] = useState<'bundled' | 'custom'>('custom');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  // Add/edit custom item dialog
  const [form, setForm] = useState<typeof emptyItemForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomRow | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // AI photo state
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

  // Premium in-page search: local input is the boss (global topbar search only
  // fills in when local is empty) — typing here never freezes, never redirects.
  const effSearch = (search || globalSearch || '').toLowerCase().trim();

  // Full catalog with live effective prices — admin picks BY NAME, never an ID.
  const items = useMemo(() => {
    const s = effSearch;
    return CATALOG.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (s && !`${c.name} ${c.categoryLabel} ${c.id}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [effSearch, categoryFilter]);

  const filteredCustoms = useMemo(() => {
    const s = effSearch;
    return customs.filter((c) => {
      if (categoryFilter !== 'all' && (c.category ?? 'cooked_food') !== categoryFilter) return false;
      if (s && !`${c.name ?? ''} ${c.id} ${c.category ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [customs, effSearch, categoryFilter]);

  // Auto-tab: when searching, jump to the tab that actually has matches.
  useEffect(() => {
    if (!effSearch) return;
    if (tab === 'custom' && filteredCustoms.length === 0 && items.length > 0) setTab('bundled');
    else if (tab === 'bundled' && items.length === 0 && filteredCustoms.length > 0) setTab('custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effSearch]);

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
      image: o?.image ?? '',
      aiPrompt: '',
      unitOptions: (((o as unknown as { unitOptions?: string[] } | undefined)?.unitOptions ?? c.unitOptions ?? ['1 portion']) as string[]).join(', '),
      maxQty: (() => { const n = (o as unknown as { maxQty?: number } | undefined)?.maxQty; return n != null && n > 0 ? String(n) : ''; })(),
    });
    setAiPreview('');
    setAiOk(false);
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
      const img = editing.image.trim();
      const payload: Record<string, unknown> = {
        price,
        name: editing.name,
        updatedAt: serverTimestamp(),
      };
      if (mrp !== null) payload.mrp = mrp;
      // Image override: non-empty URL saves, empty string CLEARS it (back to bundled photo).
      payload.image = img;
      // Simple unit system: ticked options + auto base (no confusion).
      // unit = base of the ticked mode (1 kg / Full / 1 pc), priceBasis = same.
      const units = editing.unitOptions.split(',').map((u) => u.trim()).filter(Boolean);
      if (!units.length) { setToast({ message: 'Quantity option tick karo (kam se kam 1)', type: 'error' }); setSaving(false); return; }
      const eMode = unitModeForOptions(editing.unitOptions, CATALOG.find((c) => c.id === editing.id)?.category ?? 'cooked_food');
      const eBase = UNIT_MODE_BASE[eMode];
      payload.unit = eBase;
      payload.unitOptions = units;
      payload.priceBasis = eBase;
      payload.unitPrices = {};
      const eMax = Number(editing.maxQty);
      if (editing.maxQty.trim() !== '' && Number.isFinite(eMax) && eMax > 0) payload.maxQty = Math.floor(eMax);
      await setDoc(doc(db, 'product_prices', editing.id), payload, { merge: true });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: 'productPriceUpdated',
        targetId: editing.id,
        targetType: 'product',
        metadata: { name: editing.name, price, ...(mrp !== null ? { mrp } : {}), ...(img ? { image: 'updated' } : { imageCleared: true }) },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({
        message: mrp !== null
          ? `${editing.name}: ₹${mrp} → ₹${price}${img ? ' + 📸' : ''} ✅`
          : `${editing.name}: ₹${price}${img ? ' + 📸' : ''} ✅`,
        type: 'success',
      });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setEditing(null);
  };

  // ── Custom items: add / edit / toggle / delete ──────────────────────────
  const openNewItem = () => { setFormId(null); setForm({ ...emptyItemForm }); setShowAdvanced(false); setAiPreview(''); setAiOk(false); };
  const openEditItem = (r: CustomRow) => {
    setFormId(r.id);
    setShowAdvanced(false);
    setForm({
      name: r.name ?? '',
      category: r.category ?? 'cooked_food',
      price: r.price != null ? String(r.price) : '',
      mrp: r.mrp != null ? String(r.mrp) : '',
      rating: String(r.rating ?? 4.5),
      image: r.image ?? '',
      isVeg: r.isVeg ?? true,
      isRawItem: r.isRawItem ?? false,
      unitOptions: (r.unitOptions ?? ['1 portion']).join(', '),
      maxQty: r.maxQty != null && r.maxQty > 0 ? String(r.maxQty) : '',
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

  // Photo upload works for BOTH dialogs: bundled price-edit (editing) + custom item (form).
  // Direct to Firebase Storage — no API key, admin login is the auth.
  const handlePhotoFile = async (file: File) => {
    if (!form && !editing) return;
    if (!file.type.startsWith('image/')) {
      setToast({ message: 'Sirf image file chuno (JPG/PNG)', type: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast({ message: 'Photo 5MB se chhoti honi chahiye', type: 'error' });
      return;
    }
    setUploading(true);
    try {
      const url = await uploadProductPhoto(file);
      if (form) setForm({ ...form, image: url });
      else if (editing) setEditing({ ...editing, image: url });
      setToast({ message: 'Photo uploaded ✅', type: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      const denied = /permission|denied|unauthorized|insufficient/i.test(msg);
      setToast({
        message: denied
          ? '❌ Upload denied — log OUT and log back IN as admin, then retry.'
          : `❌ Upload failed: ${msg}`,
        type: 'error',
      });
    }
    setUploading(false);
  };

  const handleAiPhoto = async () => {
    const prompt = form
      ? (form.aiPrompt.trim() || form.name.trim())
      : editing
      ? (editing.aiPrompt.trim() || editing.name.trim())
      : '';
    if (!prompt) {
      setToast({ message: 'Pehle Item ka Naam ya AI prompt likho', type: 'error' });
      return;
    }
    setAiLoading(true);
    setAiOk(false);
    const url = pollinationsFoodUrl(prompt, Date.now() % 1000000);
    const ok = await preloadImage(url, 90000);
    if (ok) {
      setAiPreview(url);
      setAiOk(true);
    } else {
      setToast({ message: 'AI photo load nahi hui — dobara try karo', type: 'error' });
    }
    setAiLoading(false);
  };

  const useAiPreviewPhoto = () => {
    if (!aiPreview) return;
    if (form) setForm({ ...form, image: aiPreview });
    else if (editing) setEditing({ ...editing, image: aiPreview });
    setToast({ message: 'AI photo lag gayi ✅', type: 'success' });
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
    if (!units.length) { setToast({ message: 'Quantity option tick karo (kam se kam 1)', type: 'error' }); return; }
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
        unit: UNIT_MODE_BASE[unitModeForOptions(form.unitOptions, form.category)],
        unitOptions: units.length ? units : ['1 portion'],
        priceBasis: UNIT_MODE_BASE[unitModeForOptions(form.unitOptions, form.category)],
        unitPrices: {},
        ...(form.maxQty.trim() !== '' && Number.isFinite(Number(form.maxQty)) && Number(form.maxQty) > 0
          ? { maxQty: Math.floor(Number(form.maxQty)) }
          : {}),
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

  // ── STOCK: one-tap In stock / Out of stock ────────────────────────────────
  // Bundled items → product_prices/{id}.isOutOfStock (live listener picks it
  // up instantly). Custom items → custom_products/{id}.isOutOfStock.
  // Customer app greys the card + shows OUT OF STOCK + blocks add-to-cart.
  const handleToggleStock = async (id: string, name: string, currentlyOut: boolean, bundled: boolean) => {
    try {
      const col = bundled ? 'product_prices' : 'custom_products';
      await setDoc(doc(db, col, id), { isOutOfStock: !currentlyOut, updatedAt: serverTimestamp() }, { merge: true });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: currentlyOut ? 'productBackInStock' : 'productOutOfStock',
        targetId: id,
        targetType: 'product',
        metadata: { name },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: currentlyOut ? `"${name}" back IN STOCK ✅` : `"${name}" OUT OF STOCK ⛔`, type: 'success' });
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

  // ── ONE-TAP MIGRATE: all custom_products → simple unit system ─────────────
  // kilo (veg/grocery/dairy) → 1 kg + [250g,500g,1kg,2kg,5kg] + max 10
  // portion (cooked) → Full + [Half,Full] + max 4
  // piece (eggs/non-veg) → 1 pc + [1pc,2pcs,4pcs] + max 12
  // Existing maxQty is never overwritten. One-tap, audited.
  const [migrating, setMigrating] = useState(false);
  const handleMigrateUnits = async () => {
    if (migrating) return;
    if (!window.confirm('Saare items simple unit system par migrate ho jayenge (kilo/portion/piece + max limit). Existing maxQty nahi badlega. Continue?')) return;
    setMigrating(true);
    try {
      const { getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'custom_products'));
      let done = 0;
      for (const d of snap.docs) {
        const m = d.data() as CustomRow;
        const n = (m.name ?? '').toLowerCase();
        const c = (m.category ?? '').toLowerCase();
        let mode: 'kilo' | 'portion' | 'piece' = 'portion';
        if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) mode = 'kilo';
        else if (['eggs_meat', 'non_veg'].includes(c)) mode = 'piece';
        else if (/juice|shake|lassi|milk|water|drink|soda|tea|coffee/.test(n)) mode = 'kilo';
        else if (/egg|momo/.test(n)) mode = 'piece';
        const patch: Record<string, unknown> = { updatedAt: serverTimestamp(), unitPrices: {} };
        if (mode === 'kilo') {
          Object.assign(patch, { unit: '1 kg', unitOptions: ['250g', '500g', '1 kg', '2 kg', '5 kg'], priceBasis: '1 kg' });
          if (m.maxQty == null) patch.maxQty = 10;
        } else if (mode === 'piece') {
          Object.assign(patch, { unit: '1 pc', unitOptions: ['1 pc', '2 pcs', '4 pcs'], priceBasis: '1 pc' });
          if (m.maxQty == null) patch.maxQty = 12;
        } else {
          Object.assign(patch, { unit: 'Full', unitOptions: ['Half', 'Full'], priceBasis: 'Full' });
          if (m.maxQty == null) patch.maxQty = 4;
        }
        await updateDoc(doc(db, 'custom_products', d.id), patch);
        done++;
      }
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: 'unitsMigrated',
        targetId: 'all',
        targetType: 'products',
        metadata: { count: done },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: `${done} items migrated ✅ — app me chips + max limit live`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Migrate failed', type: 'error' });
    }
    setMigrating(false);
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap search-premium">
            <span>🔍</span>
            <input placeholder="Search by food name, id or category..." value={search} onChange={(e) => setSearch(e.target.value)} />
            {search ? (
              <button className="search-clear" onClick={() => setSearch('')} title="Clear search">✕</button>
            ) : effSearch ? (
              <span className="search-global-tag" title="Topbar search applied">🌐</span>
            ) : null}
          </div>
          <button className="btn btn-primary" onClick={openNewItem}>➕ Add New Item</button>
          <button className="btn btn-sm btn-ghost" disabled={migrating} onClick={() => void handleMigrateUnits()} title="Saare items ko simple kilo/portion/piece system par migrate karo">
            {migrating ? '⏳ Migrating…' : '⚡ Migrate all units'}
          </button>
        </div>
        <div className="filters-row">
          <button className={`chip ${tab === 'custom' ? 'chip-active' : ''}`} onClick={() => setTab('custom')}>
            ✨ My Added Items ({customs.length})
            {effSearch && <span className="search-count">{filteredCustoms.length}</span>}
          </button>
          <button className={`chip ${tab === 'bundled' ? 'chip-active' : ''}`} onClick={() => setTab('bundled')}>
            📦 Bundled ({CATALOG.length})
            {effSearch && <span className="search-count">{items.length}</span>}
          </button>
          <span className="chip" style={{ cursor: 'default', opacity: 0.9 }}>
            🧮 TOTAL LIVE: {customs.filter((c) => c.isActive ?? true).length}
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
                  const customImg = o?.image?.trim() ? o.image : '';
                  const isOut = (o as { isOutOfStock?: boolean } | undefined)?.isOutOfStock === true;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          {customImg ? (
                            <img src={customImg} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 10 }} loading="lazy" />
                          ) : (
                            <div style={{ width: 52, height: 52, borderRadius: 10, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🍽️</div>
                          )}
                          <div>
                            <div className="cell-main">{c.name}</div>
                            <div className="cell-sub">{customImg ? '📸 Custom photo' : hasOverride ? '✏️ Custom price' : 'Bundled price'}</div>
                          </div>
                        </div>
                      </td>
                      <td>{c.categoryLabel}</td>
                      <td>
                        <strong>₹{price.toLocaleString('en-IN')}</strong>
                        {mrp != null && mrp > price && (
                          <span className="cell-sub" style={{ textDecoration: 'line-through', marginLeft: 8 }}>₹{mrp.toLocaleString('en-IN')}</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {isOut && <span className="badge badge-blocked">⛔ OUT</span>}
                          <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>Edit price + photo</button>
                          <button
                            className={`btn btn-sm ${isOut ? 'btn-success' : 'btn-danger'}`}
                            title={isOut ? 'Back in stock' : 'Mark out of stock'}
                            onClick={() => handleToggleStock(c.id, c.name, isOut, true)}
                          >
                            {isOut ? '✅ In stock' : '⛔ Out of stock'}
                          </button>
                        </div>
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
                    <td>
                      <span className={`badge ${r.isActive ?? true ? 'badge-active' : 'badge-blocked'}`}>{(r.isActive ?? true) ? 'LIVE' : 'HIDDEN'}</span>
                      {(r as { isOutOfStock?: boolean }).isOutOfStock === true && (
                        <span className="badge badge-blocked" style={{ marginLeft: 6 }}>⛔ OUT</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => openEditItem(r)}>Edit</button>
                        <button className={`btn btn-sm ${(r.isActive ?? true) ? 'btn-danger' : 'btn-success'}`} onClick={() => handleToggleItem(r)}>
                          {(r.isActive ?? true) ? 'Hide' : 'Show'}
                        </button>
                        <button
                          className={`btn btn-sm ${(r as { isOutOfStock?: boolean }).isOutOfStock === true ? 'btn-success' : 'btn-danger'}`}
                          title={(r as { isOutOfStock?: boolean }).isOutOfStock === true ? 'Back in stock' : 'Mark out of stock'}
                          onClick={() => handleToggleStock(r.id, r.name ?? r.id, (r as { isOutOfStock?: boolean }).isOutOfStock === true, false)}
                        >
                          {(r as { isOutOfStock?: boolean }).isOutOfStock === true ? '✅ In stock' : '⛔ Out of stock'}
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
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>{editing.name}</h3>
            <p>Price + photo change updates the customer app + website instantly (live listener) — no app update needed.</p>
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

            {/* ── UNIT (simple: kilo/portion/piece → tick → max) ── */}
            <UnitPicker
              category={CATALOG.find((c) => c.id === editing.id)?.category ?? 'cooked_food'}
              unitOptions={editing.unitOptions}
              basePrice={editing.price}
              maxQty={editing.maxQty}
              onChange={(unitOptions, maxQty) => setEditing({ ...editing, unitOptions, maxQty })}
            />

            {/* ── PHOTO OVERRIDE ── */}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>📸 Item Photo (empty = bundled photo)</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading...' : '📤 Upload photo'}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ''; }} />
                </label>
                {editing.image.trim() !== '' && (
                  <button className="btn btn-sm btn-danger" onClick={() => setEditing({ ...editing, image: '' })}>
                    🗑 Remove custom photo
                  </button>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>…or paste image URL</label><input placeholder="https://..." value={editing.image} onChange={(e) => setEditing({ ...editing, image: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>…or describe for FREE AI photo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="e.g. crispy masala dosa with chutney" value={editing.aiPrompt} onChange={(e) => setEditing({ ...editing, aiPrompt: e.target.value })} style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-primary" disabled={aiLoading || !editing.aiPrompt.trim()} onClick={handleAiPhoto}>
                    {aiLoading ? '...' : '✨ AI'}
                  </button>
                </div>
              </div>
              {aiPreview !== '' && aiOk && (
                <div style={{ marginBottom: 8 }}>
                  <img src={aiPreview} alt="AI preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  <button className="btn btn-sm btn-success" style={{ width: '100%', marginTop: 6 }} onClick={useAiPreviewPhoto}>
                    ✅ Use this AI photo
                  </button>
                </div>
              )}
              {editing.image.trim() !== '' && (
                <img src={editing.image.trim()} alt="preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
            </div>

            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || uploading} onClick={handleSave}>
                {saving ? 'Saving...' : 'Save price + photo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="dialog-overlay" onClick={() => { setForm(null); setFormId(null); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>{formId ? '✏️ Edit Item' : '✨ Add New Item'}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => { setForm(null); setFormId(null); }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginTop: 0, marginBottom: 14 }}>
              Fill in the details below. Clicking save will make this item <strong>LIVE immediately on both the Customer App & Website</strong>.
            </p>

            {/* 1. Item Name */}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 700, fontSize: 13 }}>Item Name *</label>
              <input
                placeholder="e.g. Odisha Bhaja Moong Dal (1kg) or Fresh Paneer"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14 }}
              />
            </div>

            {/* 2. Pricing & MRP */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
              <div className="form-group">
                <label style={{ fontWeight: 700, fontSize: 13 }}>MRP / Original Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 150"
                  value={form.mrp}
                  onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14 }}
                />
              </div>
              <div className="form-group">
                <label style={{ fontWeight: 700, fontSize: 13 }}>Selling / Cut Price (₹) *</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 130"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14 }}
                />
              </div>
            </div>

            {/* Dynamic Discount Calculation Badge */}
            {form.mrp.trim() !== '' && form.price.trim() !== '' && Number(form.mrp) > Number(form.price) && (
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🏷️ <strong>Discount Live Display:</strong></span>
                <span style={{ textDecoration: 'line-through', color: '#94A3B8' }}>₹{form.mrp}</span>
                <span style={{ fontWeight: 800, color: '#15803D' }}>₹{form.price}</span>
                <span className="badge badge-active" style={{ background: '#DCFCE7', color: '#15803D', border: '1px solid #86EFAC' }}>
                  Save ₹{Number(form.mrp) - Number(form.price)} ({Math.round(((Number(form.mrp) - Number(form.price)) / Number(form.mrp)) * 100)}% OFF)
                </span>
              </div>
            )}

            {/* 3. Category */}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 700, fontSize: 13 }}>Category</label>
              <select
                value={form.category}
                onChange={(e) => {
                  const cat = e.target.value;
                  const preset = presetForCategory(cat);
                  setForm({ ...form, category: cat, unitOptions: preset.join(', ') });
                }}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14, background: '#FFF' }}
              >
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* 4. Add Photo Box */}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1E293B', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>📸 Item Photo</span>
                {form.image.trim() !== '' && (
                  <button className="btn btn-sm btn-ghost" style={{ color: '#EF4444', fontSize: 12 }} onClick={() => setForm({ ...form, image: '' })}>
                    🗑 Remove photo
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', background: '#FFF', border: '1px solid #CBD5E1' }}>
                  {uploading ? '⏳ Uploading...' : '📤 Upload Photo from Device'}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ''; }} />
                </label>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={aiLoading}
                  onClick={handleAiPhoto}
                  title="Generates a free high-quality food photo using AI"
                >
                  {aiLoading ? '⏳ Generating AI Photo...' : `✨ Auto AI Photo ${form.name.trim() ? `for "${form.name.trim().slice(0, 15)}..."` : ''}`}
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: 6 }}>
                <input
                  placeholder="...or paste image URL directly (https://...)"
                  value={form.image}
                  onChange={(e) => setForm({ ...form, image: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }}
                />
              </div>

              {aiPreview !== '' && aiOk && (
                <div style={{ marginTop: 8, marginBottom: 8 }}>
                  <img src={aiPreview} alt="AI preview" style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  <button className="btn btn-sm btn-success" style={{ width: '100%', marginTop: 6 }} onClick={() => { setForm({ ...form, image: aiPreview }); setToast({ message: 'AI photo lag gayi ✅', type: 'success' }); }}>
                    ✅ Use this AI photo
                  </button>
                </div>
              )}

              {form.image.trim() !== '' && (
                <div style={{ marginTop: 8 }}>
                  <img
                    src={form.image.trim()}
                    alt="preview"
                    style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, display: 'block', border: '1px solid #E2E8F0' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>

            {/* Veg / Non-veg — ALWAYS visible (was hidden in More Options, causing all items to save as Veg) */}
            <div style={{ background: '#F0FDF4', border: '2px solid #86EFAC', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginBottom: 8 }}>🟢🔴 Veg / Non-veg *</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`chip ${form.isVeg ? 'chip-active' : ''}`} style={form.isVeg ? { background: '#16A34A', color: '#FFF', borderColor: '#16A34A' } : {}} onClick={() => setForm({ ...form, isVeg: true })}>🟢 Veg</button>
                <button type="button" className={`chip ${!form.isVeg ? 'chip-active' : ''}`} style={!form.isVeg ? { background: '#DC2626', color: '#FFF', borderColor: '#DC2626' } : {}} onClick={() => setForm({ ...form, isVeg: false })}>🔴 Non-veg</button>
              </div>
            </div>

            {/* Collapsible Advanced Options Toggle */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: '100%', justifyContent: 'center', background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 600 }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? '🔼 Hide Advanced Options' : '⚙️ More Options (Unit, Badges, Rating)'}
              </button>
            </div>

            {showAdvanced && (
              <div style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div className="form-group">
                    <label>Rating (1–5)</label>
                    <input type="number" min="1" max="5" step="0.1" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div className="form-group"><label>Tag (e.g. 🔥 Bestseller)</label><input placeholder="🔥 Bestseller" value={form.freshnessTag} onChange={(e) => setForm({ ...form, freshnessTag: e.target.value })} /></div>
                  <div className="form-group"><label>Deal text (optional)</label><input placeholder="Buy 1 Get 1" value={form.dealText} onChange={(e) => setForm({ ...form, dealText: e.target.value })} /></div>
                </div>

                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Badges</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className={`chip ${form.isPopular ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isPopular: !form.isPopular })}>⭐ Popular</button>
                    <button type="button" className={`chip ${form.isBestDeal ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isBestDeal: !form.isBestDeal })}>💰 Best Deal</button>
                    <button type="button" className={`chip ${form.isFreshToday ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isFreshToday: !form.isFreshToday })}>🌿 Fresh Today</button>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Raw grocery item? (vegetables/grains with units)</label>
                  <button type="button" className={`chip ${form.isRawItem ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isRawItem: !form.isRawItem })}>
                    {form.isRawItem ? 'Yes — raw item with weight units ✓' : 'No — fixed portion'}
                  </button>
                </div>

                <UnitPicker
                  category={form.category}
                  unitOptions={form.unitOptions}
                  basePrice={form.price}
                  maxQty={form.maxQty}
                  onChange={(unitOptions, maxQty) => setForm({ ...form, unitOptions, maxQty })}
                />

                <div className="form-group">
                  <label>Visible on Customer App & Website?</label>
                  <button type="button" className={`chip ${form.isActive ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                    {form.isActive ? 'Live ✓' : 'Hidden'}
                  </button>
                </div>
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => { setForm(null); setFormId(null); }}>Cancel</button>
              <button className="btn btn-primary" style={{ padding: '10px 20px', fontWeight: 700 }} disabled={saving || uploading} onClick={handleSaveItem}>
                {saving ? 'Saving...' : formId ? 'Save Changes' : '🚀 Save & Go Live on App + Website'}
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
