import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

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
import { useAuth } from '../contexts/AuthContext';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState, ConfirmDialog, Toast } from '../components/UI';

interface BannerRow {
  id: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  imageUrl?: string;
  emoji?: string;
  isActive?: boolean;
  sortOrder?: number;
  startAt?: Timestamp | null;
  endAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  aiPrompt?: string;
  frames?: string[];
}

const emptyForm = {
  title: '',
  subtitle: '',
  badge: '',
  imageUrl: '',
  emoji: '🎉',
  isActive: true,
  sortOrder: '0',
  startAt: '',
  endAt: '',
  aiPrompt: '',
};

// FREE AI — Pollinations, no key, no money. Turbo model = fast.
// Seed-based URLs are stable/permanent → saved directly, no upload needed.
// Smaller preview size (768x384) loads faster in the admin grid.
function pollinationsUrl(prompt: string, seed: number): string {
  const styled = `appetizing Indian food delivery promotional banner, vibrant festive colors, professional food photography, no text overlay: ${prompt.trim()}`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=768&height=384&seed=${seed}&nologo=true&model=turbo`;
}

// Preloads one image with a timeout — resolves true only if it fully loads.
function preloadImage(url: string, timeoutMs = 90000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const img = new Image();
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

// FREE AI copywriting — attractive banner lines from the theme.
async function aiCopyLines(theme: string): Promise<{ title: string; subtitle: string; badge: string }> {
  const fallback = {
    title: `🎉 ${theme.trim().slice(0, 40)}`,
    subtitle: 'Fresh taste • Best prices • Free delivery',
    badge: 'SPECIAL OFFER',
  };
  try {
    const system = 'You write short, punchy Indian food-delivery promo lines. Reply ONLY as JSON: {"title":"...","subtitle":"...","badge":"..."}. Title max 40 chars with one emoji. Subtitle max 60 chars with offer + price hook. Badge max 16 chars uppercase, no emoji.';
    const url = `https://text.pollinations.ai/${encodeURIComponent(`Theme: ${theme.trim()}`)}?model=openai&system=${encodeURIComponent(system)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const text = (await res.text()).trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return fallback;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    return {
      title: String(parsed.title ?? fallback.title).slice(0, 50),
      subtitle: String(parsed.subtitle ?? fallback.subtitle).slice(0, 80),
      badge: String(parsed.badge ?? fallback.badge).slice(0, 20),
    };
  } catch {
    return fallback;
  }
}

function toInputValue(ts?: Timestamp | null): string {
  const d = tsToDate(ts);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Banners({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [rows, setRows] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<BannerRow | null>(null);
  // AI studio: prompt → 3 generated frames → approve ALL as animated slideshow draft
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreviews, setAiPreviews] = useState<{ url: string; seed: number }[]>([]);
  const [aiImgState, setAiImgState] = useState<Record<number, 'loading' | 'ok' | 'error'>>({});
  const aiOkCount = aiPreviews.filter((p) => aiImgState[p.seed] === 'ok' && p.url).length;

  useEffect(() => {
    const q = query(collection(db, 'app_banners'), orderBy('sortOrder', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BannerRow, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) => `${r.id} ${r.title ?? ''} ${r.badge ?? ''}`.toLowerCase().includes(s));
  }, [rows, search, globalSearch]);

  const resetAi = () => { setAiLoading(false); setAiPreviews([]); setAiImgState({}); };
  const openNew = () => { setFormId(null); setForm({ ...emptyForm }); resetAi(); };
  const openEdit = (r: BannerRow) => {
    setFormId(r.id);
    setForm({
      title: r.title ?? '',
      subtitle: r.subtitle ?? '',
      badge: r.badge ?? '',
      imageUrl: r.imageUrl ?? '',
      emoji: r.emoji ?? '🎉',
      isActive: r.isActive ?? true,
      sortOrder: String(r.sortOrder ?? 0),
      startAt: toInputValue(r.startAt),
      endAt: toInputValue(r.endAt),
      aiPrompt: '',
    });
    resetAi();
  };

  // Generate 3 AI banner frames — FREE, no key needed (turbo model = fast).
  // AI also writes the title/subtitle/badge lines — admin only types the theme.
  // Each frame is PRELOADED with a 90s timeout before showing — no silent stuck.
  const handleAiGenerate = async () => {
    if (!form || !form.aiPrompt.trim()) {
      setToast({ message: 'Pehle AI prompt likho (e.g. Diwali sweets dhamaka)', type: 'error' });
      return;
    }
    setAiLoading(true);
    const theme = form.aiPrompt.trim();
    const base = Date.now() % 100000;
    const seeds = [0, 1, 2].map((i) => base + i * 7919);
    setAiPreviews(seeds.map((seed) => ({ seed, url: '' })));
    setAiImgState(Object.fromEntries(seeds.map((seed) => [seed, 'loading' as const])));
    // Lines first (fast), then preload each image — show only when fully loaded
    const lines = await aiCopyLines(theme);
    setForm((f) => f ? { ...f, title: lines.title, subtitle: lines.subtitle, badge: lines.badge } : f);
    await Promise.all(seeds.map(async (seed) => {
      const url = pollinationsUrl(theme, seed);
      const ok = await preloadImage(url, 90000);
      if (ok) {
        setAiPreviews((prev) => prev.map((p) => (p.seed === seed ? { ...p, url } : p)));
        setAiImgState((s) => ({ ...s, [seed]: 'ok' }));
      } else {
        setAiImgState((s) => ({ ...s, [seed]: 'error' }));
      }
    }));
    setAiLoading(false);
  };

  const retryAiImage = async (seed: number) => {
    if (!form) return;
    setAiImgState((s) => ({ ...s, [seed]: 'loading' }));
    // Fresh seed = brand new image, no cache issues
    const freshSeed = Date.now() % 1000000;
    const url = pollinationsUrl(form.aiPrompt.trim(), freshSeed);
    const ok = await preloadImage(url, 90000);
    if (ok) {
      setAiPreviews((prev) => prev.map((p) => (p.seed === seed ? { ...p, seed: freshSeed, url } : p)));
      setAiImgState((s) => {
        const next = { ...s };
        delete next[seed];
        next[freshSeed] = 'ok';
        return next;
      });
    } else {
      setAiImgState((s) => ({ ...s, [seed]: 'error' }));
      setToast({ message: 'Image load nahi hui (90s timeout) — dobara Retry dabao', type: 'error' });
    }
  };

  // Approve ALL 3 AI frames → seed URLs saved directly (permanent, no upload).
  const handleAiApprove = async () => {
    if (!form) return;
    const okFrames = aiPreviews.filter((p) => p.url && aiImgState[p.seed] === 'ok');
    if (okFrames.length === 0) {
      setToast({ message: 'Pehle Generate dabakar AI frames banao', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      // Strip cache-busters — clean seed URLs regenerate the same image forever
      const urls = okFrames.map((f) => f.url.split('&t=')[0]);
      const payload = {
        title: form.title.trim() || `AI: ${form.aiPrompt.trim().slice(0, 40)}`,
        subtitle: form.subtitle.trim(),
        badge: form.badge.trim(),
        imageUrl: urls[0],
        frames: urls, // ← animated slideshow frames
        emoji: form.emoji.trim() || '🎉',
        isActive: false, // draft — admin enables separately
        sortOrder: Number(form.sortOrder) || 0,
        startAt: form.startAt ? new Date(form.startAt) : null,
        endAt: form.endAt ? new Date(form.endAt) : null,
        aiPrompt: form.aiPrompt.trim(),
        updatedAt: serverTimestamp(),
      };
      const id = formId ?? `ai-banner-${Date.now()}`;
      if (formId) {
        await updateDoc(doc(db, 'app_banners', formId), payload);
      } else {
        await setDoc(doc(db, 'app_banners', id), { ...payload, createdAt: serverTimestamp() });
      }
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: formId ? 'bannerUpdated' : 'bannerCreated',
        targetId: id,
        targetType: 'banner',
        metadata: { title: payload.title, aiGenerated: true, draft: true },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: `🎬 Animated banner draft save ho gaya (${urls.length} frames) ✅ — Enable dabakar live karo`, type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setForm(null);
    setFormId(null);
    resetAi();
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        badge: form.badge.trim(),
        imageUrl: form.imageUrl.trim(),
        emoji: form.emoji.trim() || '🎉',
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
        startAt: form.startAt ? new Date(form.startAt) : null,
        endAt: form.endAt ? new Date(form.endAt) : null,
        updatedAt: serverTimestamp(),
      };
      const id = formId ?? `campaign-${Date.now()}`;
      if (formId) {
        await updateDoc(doc(db, 'app_banners', formId), payload);
      } else {
        await setDoc(doc(db, 'app_banners', id), { ...payload, createdAt: serverTimestamp() });
      }
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: formId ? 'bannerUpdated' : 'bannerCreated',
        targetId: id,
        targetType: 'banner',
        metadata: { title: payload.title, isActive: payload.isActive },
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: formId ? 'Banner updated' : 'Banner created', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    }
    setSaving(false);
    setForm(null);
    setFormId(null);
  };

  const handleToggle = async (r: BannerRow) => {
    try {
      await updateDoc(doc(db, 'app_banners', r.id), { isActive: !(r.isActive ?? true), updatedAt: serverTimestamp() });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: r.isActive ? 'bannerDisabled' : 'bannerEnabled',
        targetId: r.id,
        targetType: 'banner',
        metadata: {},
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: r.isActive ? 'Banner disabled' : 'Banner enabled', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Action failed', type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, 'app_banners', deleting.id));
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin',
        adminName: adminName || 'Admin',
        action: 'bannerDeleted',
        targetId: deleting.id,
        targetType: 'banner',
        metadata: {},
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setToast({ message: 'Banner deleted', type: 'success' });
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
            <input placeholder="Search campaigns..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openNew}>➕ New campaign</button>
        </div>
        <span className="muted">The lowest sort-order active banner within its date window shows on the customer home screen. GIF / animated WebP URLs animate automatically.</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🎉" title="No campaigns yet" subtitle="Create a Diwali, Nuakhai, New Year or offer campaign — it appears on the home screen without an app update." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Campaign</th><th>Badge</th><th>Window</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-main">
                      {r.emoji ?? '🎉'} {r.title || r.id}
                      {r.aiPrompt && <span className="badge badge-active" style={{ marginLeft: 6 }}>✨ AI</span>}
                      {r.frames && r.frames.length > 1 && <span className="badge badge-active" style={{ marginLeft: 6 }}>🎬 {r.frames.length} frames</span>}
                      {!r.isActive && <span className="badge badge-pending" style={{ marginLeft: 6 }}>DRAFT</span>}
                    </div>
                    <div className="cell-sub">{r.subtitle || '—'}</div>
                    {r.imageUrl && (
                      <div style={{ marginTop: 6 }}>
                        <img src={r.imageUrl} alt="" style={{ width: 160, height: 60, objectFit: 'cover', borderRadius: 8, display: 'block' }} loading="lazy" />
                      </div>
                    )}
                  </td>
                  <td>{r.badge || '—'}</td>
                  <td className="cell-sub">
                    {r.startAt ? fmtDateTime(tsToDate(r.startAt)) : '—'} → {r.endAt ? fmtDateTime(tsToDate(r.endAt)) : '—'}
                  </td>
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
        <div className="dialog-overlay" onClick={() => { setForm(null); setFormId(null); resetAi(); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>{formId ? 'Edit campaign' : 'New campaign'}</h3>
            <p>Diwali, Nuakhai, New Year, offers — shows on the customer home screen without an app update.</p>

            {/* ── AI STUDIO (FREE, no key) ────────────────────────────── */}
            <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>✨ AI Banner Studio <span className="badge badge-active" style={{ marginLeft: 6 }}>100% FREE</span></div>
              <p className="muted" style={{ marginBottom: 8 }}>Koi key nahi, koi paisa nahi — bas theme likho aur Generate dabao! 🚀</p>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>Describe the banner (AI will generate images)</label>
                <input
                  placeholder="e.g. Diwali sweets dhamaka with diyas and gulab jamun"
                  value={form.aiPrompt}
                  onChange={(e) => setForm({ ...form, aiPrompt: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: aiPreviews.length ? 12 : 0 }}>
                <button className="btn btn-sm btn-primary" disabled={aiLoading || !form.aiPrompt.trim()} onClick={handleAiGenerate}>
                  {aiLoading ? 'Generating...' : aiPreviews.length ? '🔄 Regenerate' : '✨ Generate with AI'}
                </button>
                {aiPreviews.length > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={resetAi}>Clear</button>
                )}
              </div>
              {aiPreviews.length > 0 && (
                <>
                  <p className="muted" style={{ marginBottom: 8 }}>🎬 Teeno frames app me slideshow ban kar chalengi — full animated banner!</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                    {aiPreviews.map((p, idx) => {
                      const st = aiImgState[p.seed] ?? 'loading';
                      return (
                        <div
                          key={p.seed}
                          style={{
                            borderRadius: 10,
                            overflow: 'hidden',
                            border: '2px solid #E2E8F0',
                            position: 'relative',
                            background: '#F1F5F9',
                            minHeight: 90,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {st === 'loading' && <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>⏳ Frame {idx + 1}...</div>}
                          {st === 'error' && (
                            <div style={{ textAlign: 'center', padding: 8 }}>
                              <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 700, marginBottom: 6 }}>⚠️ Load failed</div>
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={(e) => { e.stopPropagation(); retryAiImage(p.seed); }}
                              >
                                🔄 Retry
                              </button>
                            </div>
                          )}
                          {p.url !== '' && st === 'ok' && (
                            <img
                              src={p.url}
                              alt={`AI frame ${idx + 1}`}
                              style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
                            />
                          )}
                          {st === 'ok' && (
                            <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(15,23,42,0.75)', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 800, padding: '2px 8px' }}>Frame {idx + 1}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn btn-success" disabled={aiOkCount === 0 || saving} onClick={handleAiApprove} style={{ width: '100%' }}>
                    {saving ? 'Saving...' : `🎬 Approve — save animated banner (${aiOkCount} frames) as draft`}
                  </button>
                  <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>Approve = draft save hoga (live nahi). List me Enable dabakar app par dikhao.</p>
                </>
              )}
            </div>

            {(form.title || form.subtitle || form.badge) && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#065F46', marginBottom: 6 }}>✨ AI-written lines (auto-filled)</div>
                {form.badge && <div><span className="badge badge-pending">{form.badge}</span></div>}
                {form.title && <div style={{ fontWeight: 800, marginTop: 4 }}>{form.title}</div>}
                {form.subtitle && <div className="cell-sub">{form.subtitle}</div>}
              </div>
            )}
            <div className="form-group"><label>Banner image / GIF URL (optional — or pick AI above)</label><input placeholder="https://.../diwali.gif" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></div>
            {form.imageUrl.trim() !== '' && (
              <div style={{ marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                <img src={form.imageUrl.trim()} alt="preview" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <div className="form-group"><label>Emoji fallback</label><input placeholder="🎉" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></div>
            <div className="form-group"><label>Sort order (lowest shows first)</label><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></div>
            <div className="form-group"><label>Start (optional)</label><input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></div>
            <div className="form-group"><label>End (optional)</label><input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></div>
            <div className="form-group">
              <label>Active</label>
              <button className={`chip ${form.isActive ? 'chip-active' : ''}`} onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                {form.isActive ? 'Active ✓' : 'Disabled'}
              </button>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => { setForm(null); setFormId(null); resetAi(); }}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Save campaign'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete campaign?"
        message={`"${deleting?.title || deleting?.id}" will be removed. The home screen falls back to the default banner.`}
        confirmLabel="Delete"
        confirmColor="#DC2626"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
