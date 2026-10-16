import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { EmptyState, Toast, ConfirmDialog } from '../components/UI';

export interface HomeSection {
  section_id: string;
  section_type: string;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  video_url: string;
  lottie_url: string;
  cta_text: string;
  cta_action: string;
  is_enabled: boolean;
  display_order: number;
  style_config: Record<string, string>;
  updated_at?: unknown;
}

const BUILTINS: Array<{ id: string; type: string; label: string }> = [
  { id: 'festival', type: 'festival_banner', label: '🎉 Festive Banner (Lottie/Video — playback untouched)' },
  { id: 'hero', type: 'hero_carousel', label: '🖼️ Hero Banner Carousel' },
  { id: 'search', type: 'search_bar', label: '🔍 Search Bar' },
  { id: 'promo_strip', type: 'promo_animation', label: '🎬 Promo Animation Strip (Video/GIF — playback untouched)' },
  { id: 'categories', type: 'category_grid', label: '🗂️ Categories Grid' },
  { id: 'specials', type: 'special_sections', label: '✨ Special Sections' },
  { id: 'healthy', type: 'healthy_banner', label: '🥗 Healthy Choices Banner' },
  { id: 'restaurants', type: 'restaurant_list', label: '🍽️ Restaurants' },
];

const emptySection = (order: number): HomeSection => ({
  section_id: `custom_${Date.now()}`,
  section_type: 'custom_card',
  title: '',
  subtitle: '',
  description: '',
  image_url: '',
  video_url: '',
  lottie_url: '',
  cta_text: '',
  cta_action: '',
  is_enabled: true,
  display_order: order,
  style_config: {},
});

async function uploadMedia(file: File, folder: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 4).replace(/[^a-z0-9]/g, '') || 'png';
  const path = `home_sections/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/png' });
  return getDownloadURL(snap.ref);
}

function validUrl(u: string): boolean {
  if (!u.trim()) return true;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}

export default function HomepageBuilder() {
  const [draft, setDraft] = useState<HomeSection[]>([]);
  const [published, setPublished] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HomeSection | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const [dSnap, pSnap] = await Promise.all([
          getDoc(doc(db, 'app_home_config', 'draft')),
          getDoc(doc(db, 'app_home_config', 'published')),
        ]);
        const dList = (dSnap.data()?.sections as HomeSection[]) ?? [];
        const pList = (pSnap.data()?.sections as HomeSection[]) ?? [];
        if (!done) {
          setDraft(dList.length ? dList : pList.length ? pList : BUILTINS.map((b, i) => ({ ...emptySection(i), section_id: b.id, section_type: b.type, title: b.label, display_order: i })));
          setPublished(pList);
        }
      } catch { if (!done) setToast({ message: 'Could not load homepage config', type: 'error' }); }
      if (!done) setLoading(false);
    })();
    const un = onSnapshot(doc(db, 'app_home_config', 'published'), (s) => {
      const list = (s.data()?.sections as HomeSection[]) ?? [];
      setPublished(list);
    });
    getDocs(collection(db, 'app_home_history')).then((s) => setHistoryCount(s.size)).catch(() => {});
    return () => { done = true; un(); };
  }, []);

  const sorted = useMemo(() => [...draft].sort((a, b) => a.display_order - b.display_order), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(published), [draft, published]);

  const move = (id: string, dir: -1 | 1) => {
    const list = [...sorted];
    const i = list.findIndex((s) => s.section_id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i].display_order;
    list[i].display_order = list[j].display_order;
    list[j].display_order = a;
    setDraft(list);
  };

  const toggle = (id: string) => setDraft((d) => d.map((s) => s.section_id === id ? { ...s, is_enabled: !s.is_enabled } : s));

  const saveDraft = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_home_config', 'draft'), { sections: draft, updatedAt: serverTimestamp() }, { merge: true });
      setToast({ message: '✅ Draft saved', type: 'success' });
    } catch { setToast({ message: 'Save failed — check connection', type: 'error' }); }
    setSaving(false);
  };

  const publish = async () => {
    setConfirmPublish(false);
    setPublishing(true);
    try {
      if (published.length) {
        await addDoc(collection(db, 'app_home_history'), { sections: published, createdAt: serverTimestamp() });
        getDocs(collection(db, 'app_home_history')).then((s) => setHistoryCount(s.size)).catch(() => {});
      }
      await setDoc(doc(db, 'app_home_config', 'published'), { sections: draft, updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, 'app_home_config', 'draft'), { sections: draft, updatedAt: serverTimestamp() }, { merge: true });
      setToast({ message: '🚀 Published — customer app updates on refresh', type: 'success' });
    } catch { setToast({ message: 'Publish failed — try again', type: 'error' }); }
    setPublishing(false);
  };

  const rollback = async () => {
    setConfirmRollback(false);
    try {
      const snap = await getDocs(collection(db, 'app_home_history'));
      if (snap.empty) { setToast({ message: 'No previous version to restore', type: 'error' }); return; }
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as { sections: HomeSection[]; createdAt?: { seconds: number } }) }));
      docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      const prev = docs[0].sections ?? [];
      setDraft(prev);
      await setDoc(doc(db, 'app_home_config', 'published'), { sections: prev, updatedAt: serverTimestamp() }, { merge: true });
      setToast({ message: '↩️ Restored previous published version', type: 'success' });
    } catch { setToast({ message: 'Rollback failed', type: 'error' }); }
  };

  const saveEdit = () => {
    if (!editing) return;
    for (const [k, v] of [['image_url', editing.image_url], ['video_url', editing.video_url], ['lottie_url', editing.lottie_url]] as const) {
      if (!validUrl(v)) { setToast({ message: `Invalid URL in ${k} — must start with http(s)://`, type: 'error' }); return; }
    }
    setDraft((d) => d.map((s) => s.section_id === editing.section_id ? { ...editing } : s));
    setEditing(null);
    setToast({ message: '✅ Section updated — Save draft, then Publish', type: 'success' });
  };

  if (loading) return <div className="page-loading">Loading homepage builder…</div>;

  return (
    <div className="hb-wrap">
      <div className="hb-toolbar">
        <div>
          <h2>🏠 Homepage Builder {dirty && <span className="hb-dirty">• unsaved changes</span>}</h2>
          <p className="hb-sub">Reorder, edit, hide, preview — then publish. Customer app refreshes automatically. {historyCount} rollback snapshot{historyCount === 1 ? '' : 's'} saved.</p>
        </div>
        <div className="hb-actions">
          <button className="btn" onClick={() => setDraft((d) => [...d, emptySection(d.length)])}>+ Add section</button>
          <button className="btn" disabled={saving} onClick={saveDraft}>{saving ? 'Saving…' : '💾 Save draft'}</button>
          <button className="btn secondary" onClick={() => setConfirmRollback(true)}>↩️ Rollback</button>
          <button className="btn primary" disabled={publishing} onClick={() => setConfirmPublish(true)}>{publishing ? 'Publishing…' : '🚀 Preview & Publish'}</button>
        </div>
      </div>

      <div className="hb-grid">
        <div className="hb-list">
          {sorted.length === 0 && <EmptyState icon="🏠" title="No sections" subtitle="Add a section to start building the homepage." />}
          {sorted.map((s) => (
            <div key={s.section_id} className={`hb-row ${s.is_enabled ? '' : 'off'}`}>
              <div className="hb-order">
                <button onClick={() => move(s.section_id, -1)} title="Move up">▲</button>
                <span>{s.display_order}</span>
                <button onClick={() => move(s.section_id, 1)} title="Move down">▼</button>
              </div>
              <div className="hb-info">
                <strong>{s.title || s.section_id}</strong>
                <span className="hb-type">{s.section_type}</span>
                {!s.is_enabled && <span className="hb-hidden">HIDDEN</span>}
              </div>
              <div className="hb-row-actions">
                <button className="btn sm" onClick={() => setPreviewId(previewId === s.section_id ? null : s.section_id)}>👁 Preview</button>
                <button className="btn sm" onClick={() => toggle(s.section_id)}>{s.is_enabled ? '🙈 Hide' : '👀 Show'}</button>
                <button className="btn sm primary" onClick={() => setEditing({ ...s, style_config: { ...(s.style_config ?? {}) } })}>✏️ Edit</button>
              </div>
              {previewId === s.section_id && (
                <div className="hb-preview">
                  {(s.image_url || s.video_url || s.lottie_url) ? (
                    <div className="hb-phone">
                      {s.video_url ? <video src={s.video_url} muted loop autoPlay playsInline /> : s.image_url ? <img src={s.image_url} alt={s.title} /> : <div className="hb-lottie">🎞️ Lottie: {s.lottie_url.slice(0, 60)}…</div>}
                      <div className="hb-phone-text"><strong>{s.title || s.section_id}</strong><span>{s.subtitle}</span>{s.cta_text && <em>{s.cta_text} →</em>}</div>
                    </div>
                  ) : (
                    <div className="hb-phone hb-phone-textonly"><strong>{s.title || s.section_id}</strong><span>{s.subtitle || s.description || 'Built-in section — rendered by the app'}</span></div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hb-side">
          <h3>📱 Live order preview</h3>
          <div className="hb-phone-lg">
            {sorted.map((s) => (
              <div key={s.section_id} className={`hb-mini ${s.is_enabled ? '' : 'off'}`}>{s.is_enabled ? '●' : '○'} {s.title || s.section_id}</div>
            ))}
          </div>
          <p className="hb-note">○ = hidden from customers. ▲▼ reorders instantly after publish. Lottie/Video playback code is never modified — only URLs, text & visibility change.</p>
        </div>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ {editing.section_id}</h3>
            <label>Title<input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
            <label>Subtitle<input value={editing.subtitle} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} /></label>
            <label>Description<textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label>Image URL<input value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} placeholder="https://…" /></label>
            <label>Video URL (mp4 — playback logic untouched)<input value={editing.video_url} onChange={(e) => setEditing({ ...editing, video_url: e.target.value })} placeholder="https://…mp4" /></label>
            <label>Lottie URL (json — playback logic untouched)<input value={editing.lottie_url} onChange={(e) => setEditing({ ...editing, lottie_url: e.target.value })} placeholder="https://…json" /></label>
            <label>CTA text<input value={editing.cta_text} onChange={(e) => setEditing({ ...editing, cta_text: e.target.value })} /></label>
            <label>CTA action<input value={editing.cta_action} onChange={(e) => setEditing({ ...editing, cta_action: e.target.value })} placeholder="search / category:food / url:…" /></label>
            <div className="hb-upload-row">
              <label className="btn sm">📤 Upload image<input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                setUploading(true);
                try { const url = await uploadMedia(f, 'images'); setEditing((ed) => ed ? { ...ed, image_url: url } : ed); }
                catch { setToast({ message: 'Upload failed', type: 'error' }); }
                setUploading(false);
              }} /></label>
              {uploading && <span>Uploading…</span>}
            </div>
            <label className="hb-check"><input type="checkbox" checked={editing.is_enabled} onChange={(e) => setEditing({ ...editing, is_enabled: e.target.checked })} /> Visible to customers</label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={saveEdit}>Save section</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmPublish} title="Publish homepage?" message="This goes live to all customers on refresh. A rollback snapshot of the current version is saved first." confirmLabel="🚀 Publish" onConfirm={publish} onCancel={() => setConfirmPublish(false)} />
      <ConfirmDialog open={confirmRollback} title="Restore previous version?" message="Replaces the draft AND published config with the last snapshot." confirmLabel="↩️ Restore" onConfirm={rollback} onCancel={() => setConfirmRollback(false)} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
