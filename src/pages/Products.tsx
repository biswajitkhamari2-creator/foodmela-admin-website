import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, Toast, Pagination, ConfirmDialog } from '../components/UI';
import { CATEGORY_LABELS } from '../data/catalog';

const PAGE_SIZE = 20;

// ── Unit presets: admin ticks, never types ──────────────────────────────────
// Cooked food → Half/Full plates. Veg/grocery/dairy → kg steps.
// Piece items (paneer, eggs, etc.) → piece counts.
const WEIGHT_PRESET = ['50gm', '100gm', '250gm', '500gm', '1 kg', '2 kg', '3 kg', '4 kg', '5 kg'];
const PIECE_PRESET = ['1 pc', '2 pcs', '4 pcs', '6 pcs', '8 pcs', '12 pcs', '1 dozen'];
const COOKED_PRESET = ['Half', 'Full'];
const ML_PRESET = ['200 ml', '300 ml', '500 ml', '1 L'];

// Unknown (admin-added, e.g. healthy_foods) categories fall back to portion
// (Half/Full) — the admin can still switch mode manually in the UnitPicker.
function presetForCategory(cat: string): string[] {
  const c = (cat || '').toLowerCase();
  if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) return WEIGHT_PRESET;
  if (['eggs_meat', 'non_veg'].includes(c)) return PIECE_PRESET;
  if (['beverages'].includes(c)) return ML_PRESET;
  if (['cooked_food', 'fast_food', 'snacks', 'chaat', 'sweets', 'breakfast', 'momos', 'healthy_foods'].includes(c)) return COOKED_PRESET;
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
type UnitMode = 'kilo' | 'portion' | 'piece' | 'glass' | 'pack';

const UNIT_MODES: { key: UnitMode; label: string; hint: string }[] = [
  { key: 'kilo', label: '⚖️ Kilo-wise', hint: 'Sabzi/grocery/doodh — 50gm, 100gm, 250gm, 500gm, 1 kg, 2 kg…' },
  { key: 'portion', label: '🍛 Portion-wise', hint: 'Cooked food — Half, Full' },
  { key: 'piece', label: '🧩 Piece-wise', hint: 'Paneer/eggs/paste — 1 pc, 2 pcs…' },
  { key: 'glass', label: '🥤 Glass-wise', hint: 'Juice/shake/lassi — 200 ml, 300 ml, 500 ml, 1 L (full price, never scaled)' },
  { key: 'pack', label: '🛢️ Pack-wise', hint: 'Oil/ghee/packs — 1 Litre, 5 Litre (full pack price, never scaled)' },
];

const UNIT_MODE_OPTIONS: Record<UnitMode, string[]> = {
  kilo: ['50gm', '100gm', '250gm', '500gm', '1 kg', '2 kg', '3 kg', '4 kg', '5 kg', '10 kg'],
  portion: ['Half', 'Full'],
  piece: ['1 pc', '2 pcs', '4 pcs', '6 pcs', '8 pcs', '12 pcs', '1 dozen'],
  glass: ['200 ml', '300 ml', '500 ml', '1 L'],
  pack: ['500 ml', '1 Litre', '2 Litre', '5 Litre', '500g pack', '1 kg pack'],
};

const UNIT_MODE_BASE: Record<UnitMode, string> = {
  pack: '1 pack',
  kilo: '1 kg',
  portion: 'Full',
  piece: '1 pc',
  glass: '300 ml',
};

function unitModeForOptions(unitOptions: string, fallbackCategory: string): UnitMode {
  const opts = unitOptions.split(',').map((u) => u.trim()).filter(Boolean);
  if (opts.some((o) => /litre|liter/i.test(o)) || opts.some((o) => /pack/i.test(o))) return 'pack';
  if (opts.some((o) => /ml|litre|liter/i.test(o))) return 'glass';
  if (opts.includes('Half') || opts.includes('Full')) return 'portion';
  if (opts.some((o) => /(?:kg|gms?|g)\b/i.test(o))) return 'kilo';
  if (opts.some((o) => /pc|dozen/i.test(o))) return 'piece';
  const c = fallbackCategory.toLowerCase();
  if (['beverages'].includes(c)) return 'glass';
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
        Baaki auto: {mode === 'kilo' ? '50gm = 1/20, 100gm = 1/10, 250gm = ¼, 500gm = ½, 2 kg = double' : mode === 'portion' ? 'Half = aadha' : mode === 'glass' ? 'har glass FULL price (kabhi scale nahi hota)' : mode === 'pack' ? 'har pack FULL price (oil/ghee — kabhi scale nahi hota)' : 'count ke hisaab se'}.
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
  description?: string;
  isActive?: boolean;
}

const emptyItemForm = {
  name: '',
  category: 'cooked_food',
  price: '',
  mrp: '',
  rating: '4.5',
  image: '',
  isVeg: null as boolean | null,
  isRawItem: false,
  unitOptions: 'Half, Full',
  maxQty: '',
  freshnessTag: '',
  isPopular: false,
  isBestDeal: false,
  isFreshToday: false,
  dealText: '',
  description: '',
  isActive: true,
  aiPrompt: '',
};

export default function Products({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [customs, setCustoms] = useState<CustomRow[]>([]);
  // Live categories from Firestore (app_categories) — merged with base labels
  // so newly added categories (e.g. Healthy Foods) appear in section selection.
  const [liveCats, setLiveCats] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
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
    const un2 = onSnapshot(collection(db, 'custom_products'), (snap) => {
      setCustoms(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomRow, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    const un3 = onSnapshot(collection(db, 'app_categories'), (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, label: (d.data() as { label?: string }).label ?? d.id, isActive: (d.data() as { isActive?: boolean }).isActive ?? true }))
        .filter((c) => c.isActive)
        .sort((a, b) => a.label.localeCompare(b.label));
      setLiveCats(list);
    }, () => {});
    return () => { un2(); un3(); };
  }, []);

  // Base labels + live Firestore categories (live wins on key clash).
  const allCategoryLabels = useMemo(() => {
    const merged: Record<string, string> = { ...CATEGORY_LABELS };
    for (const c of liveCats) merged[c.id] = c.label;
    return merged;
  }, [liveCats]);

  // Premium in-page search: local input is the boss (global topbar search only
  // fills in when local is empty) — typing here never freezes, never redirects.
  const effSearch = (search || globalSearch || '').toLowerCase().trim();

  const filteredCustoms = useMemo(() => {
    const s = effSearch;
    return customs.filter((c) => {
      if (categoryFilter !== 'all' && (c.category ?? 'cooked_food') !== categoryFilter) return false;
      if (s && !`${c.name ?? ''} ${c.id} ${c.category ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [customs, effSearch, categoryFilter]);

  useEffect(() => { setPage(1); }, [search, globalSearch, categoryFilter]);

  const listLen = filteredCustoms.length;
  const totalPages = Math.max(1, Math.ceil(listLen / PAGE_SIZE));
  const paged = filteredCustoms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      isVeg: r.isVeg ?? null,
      isRawItem: r.isRawItem ?? false,
      unitOptions: (r.unitOptions ?? ['1 portion']).join(', '),
      maxQty: r.maxQty != null && r.maxQty > 0 ? String(r.maxQty) : '',
      freshnessTag: r.freshnessTag ?? '',
      isPopular: r.isPopular ?? false,
      isBestDeal: r.isBestDeal ?? false,
      isFreshToday: r.isFreshToday ?? false,
      dealText: r.dealText ?? '',
      description: r.description ?? '',
      isActive: r.isActive ?? true,
      aiPrompt: '',
    });
    setAiPreview('');
    setAiOk(false);
  };

  // Photo upload for the custom item form.
  // Direct to Firebase Storage — no API key, admin login is the auth.
  const handlePhotoFile = async (file: File) => {
    if (!form) return;
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
    if (form.isVeg == null) { setToast({ message: '🟢🔴 Veg ya Non-veg choose karo — bina iske product app me nahi dikhega', type: 'error' }); return; }
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
        // Pack-wise (oil/ghee): empty basis = app never scales, full pack price always.
        priceBasis: unitModeForOptions(form.unitOptions, form.category) === 'pack' ? '' : UNIT_MODE_BASE[unitModeForOptions(form.unitOptions, form.category)],
        unitPrices: {},
        ...(form.maxQty.trim() !== '' && Number.isFinite(Number(form.maxQty)) && Number(form.maxQty) > 0
          ? { maxQty: Math.floor(Number(form.maxQty)) }
          : {}),
        freshnessTag: form.freshnessTag.trim(),
        isPopular: form.isPopular,
        isBestDeal: form.isBestDeal,
        isFreshToday: form.isFreshToday,
        dealText: form.dealText.trim(),
        description: form.description.trim(),
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
  // glass (beverages/juice/shake) → 300 ml + [200ml,300ml,500ml,1L] + max 6
  //   (FULL price per glass — never weight-scaled; fixes the ₹50→₹3 bug)
  // Existing maxQty is never overwritten. One-tap, audited.
  const [migrating, setMigrating] = useState(false);
  const handleMigrateUnits = async () => {
    if (migrating) return;
    if (!window.confirm('Saare items simple unit system par migrate ho jayenge (kilo/portion/piece/glass + max limit). Existing maxQty nahi badlega. Continue?')) return;
    setMigrating(true);
    try {
      const { getDocs } = await import('firebase/firestore');
      const snap = await getDocs(collection(db, 'custom_products'));
      let done = 0;
      for (const d of snap.docs) {
        const m = d.data() as CustomRow;
        const n = (m.name ?? '').toLowerCase();
        const c = (m.category ?? '').toLowerCase();
        let mode: 'kilo' | 'portion' | 'piece' | 'glass' | 'pack' = 'portion';
        if (/oil|ghee|vanaspati|dalda|refined|mustard oil|sunflower|groundnut/.test(n)) mode = 'pack';
        else if (['beverages'].includes(c) || /juice|shake|lassi|milk|water|drink|soda|tea|coffee|juice|banana|mango|orange|apple/.test(n)) mode = 'glass';
        else if (['vegetables', 'fruits', 'grocery', 'dals_pulses', 'dairy'].includes(c)) mode = 'kilo';
        else if (['eggs_meat', 'non_veg'].includes(c)) mode = 'piece';
        else if (/egg|momo/.test(n)) mode = 'piece';
        const patch: Record<string, unknown> = { updatedAt: serverTimestamp(), unitPrices: {} };
        if (mode === 'pack') {
          Object.assign(patch, { unit: '1 pack', unitOptions: ['500 ml', '1 Litre', '5 Litre'], priceBasis: '' });
          if (m.maxQty == null) patch.maxQty = 10;
        } else if (mode === 'kilo') {
          Object.assign(patch, { unit: '1 kg', unitOptions: ['50gm', '100gm', '250gm', '500gm', '1 kg', '2 kg', '5 kg'], priceBasis: '1 kg' });
          if (m.maxQty == null) patch.maxQty = 10;
        } else if (mode === 'piece') {
          Object.assign(patch, { unit: '1 pc', unitOptions: ['1 pc', '2 pcs', '4 pcs'], priceBasis: '1 pc' });
          if (m.maxQty == null) patch.maxQty = 12;
        } else if (mode === 'glass') {
          Object.assign(patch, { unit: '300 ml', unitOptions: ['200 ml', '300 ml', '500 ml', '1 L'], priceBasis: '300 ml' });
          if (m.maxQty == null) patch.maxQty = 6;
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
          <span className="chip chip-active" style={{ cursor: 'default' }}>
            ✨ My Added Items ({customs.length})
            {effSearch && <span className="search-count">{filteredCustoms.length}</span>}
          </span>
          <span className="chip" style={{ cursor: 'default', opacity: 0.9 }}>
            🧮 TOTAL LIVE: {customs.filter((c) => c.isActive ?? true).length}
          </span>
        </div>
        <div className="filters-row">
          <span className="filter-label">Category:</span>
          {['all', ...Object.keys(allCategoryLabels)].map((v) => (
            <button key={v} className={`chip ${categoryFilter === v ? 'chip-active' : ''}`} onClick={() => setCategoryFilter(v)}>
              {v === 'all' ? 'All' : allCategoryLabels[v]}
            </button>
          ))}
        </div>
        <span className="muted">
          Items you add here appear in the customer app + website on refresh — no app update needed. Disable hides instantly.
        </span>
      </div>

      {listLen === 0 ? (
        <EmptyState
          icon="✨"
          title="No added items yet"
          subtitle="➕ Add New Item dabao — naam, price, photo dalo, app me live!"
        />
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
                          <img src={r.image} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 10 }} loading="lazy" />
                        ) : (
                          <div style={{ width: 88, height: 88, borderRadius: 10, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🍽️</div>
                        )}
                        <div>
                          <div className="cell-main">{r.isVeg === false ? '🔴' : '🟢'} {r.name ?? r.id}</div>
                          <div className="cell-sub">★ {r.rating ?? 4.5}{r.freshnessTag ? ` • ${r.freshnessTag}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{allCategoryLabels[r.category ?? 'cooked_food'] ?? r.category}</td>
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
                {Object.entries(allCategoryLabels).map(([k, v]) => (
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

            {/* Veg / Non-veg — REQUIRED, no default. Unset = product hidden from app. */}
            <div style={{ background: form.isVeg == null ? '#FEF2F2' : '#F0FDF4', border: `2px solid ${form.isVeg == null ? '#FCA5A5' : '#86EFAC'}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: form.isVeg == null ? '#991B1B' : '#166534', marginBottom: 8 }}>🟢🔴 Veg / Non-veg * {form.isVeg == null ? '(choose one — required)' : ''}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`chip ${form.isVeg === true ? 'chip-active' : ''}`} style={form.isVeg === true ? { background: '#16A34A', color: '#FFF', borderColor: '#16A34A' } : {}} onClick={() => setForm({ ...form, isVeg: true })}>🟢 Veg</button>
                <button type="button" className={`chip ${form.isVeg === false ? 'chip-active' : ''}`} style={form.isVeg === false ? { background: '#DC2626', color: '#FFF', borderColor: '#DC2626' } : {}} onClick={() => setForm({ ...form, isVeg: false })}>🔴 Non-veg</button>
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

                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Product info (optional) — ⓘ button in app</label>
                  <textarea
                    placeholder="e.g. Dal, 2 sabzi, rice, 2 roti, papad, sweet. Serves 1. Best eaten hot."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                  <small style={{ color: '#888' }}>Empty = no ⓘ button. Filled = customers tap ⓘ to read this.</small>
                </div>
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
