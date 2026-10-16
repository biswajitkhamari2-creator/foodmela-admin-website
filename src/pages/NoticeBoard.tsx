import { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ConfirmDialog, Toast } from '../components/UI';

export interface NoticeRow {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'alert' | 'offer' | 'emergency' | 'celebration';
  badge?: string;
  icon?: string;
  isActive: boolean;
  isSticky?: boolean;
  actionText?: string;
  actionUrl?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
}

const NOTICE_TYPES = [
  { value: 'info', label: 'Information ℹ️', color: 'from-blue-600 to-indigo-600', border: 'border-blue-500/40', defaultIcon: '📢', defaultBadge: 'NOTICE' },
  { value: 'offer', label: 'Special Offer / Festivity 🎉', color: 'from-amber-600 to-orange-600', border: 'border-orange-500/40', defaultIcon: '🎉', defaultBadge: 'OFFER' },
  { value: 'alert', label: 'Important Alert ⚠️', color: 'from-orange-600 to-red-600', border: 'border-amber-500/40', defaultIcon: '⚠️', defaultBadge: 'ALERT' },
  { value: 'emergency', label: 'Emergency / Closure 🚨', color: 'from-red-600 to-rose-700', border: 'border-red-500/40', defaultIcon: '🚨', defaultBadge: 'URGENT' },
  { value: 'celebration', label: 'Greeting / Announcement ✨', color: 'from-emerald-600 to-teal-600', border: 'border-emerald-500/40', defaultIcon: '✨', defaultBadge: 'FOOD MELA' },
];

const emptyForm = {
  title: '',
  message: '',
  type: 'info' as NoticeRow['type'],
  badge: 'NOTICE',
  icon: '📢',
  isActive: true,
  isSticky: false,
  actionText: '',
  actionUrl: '',
  sendPush: true,
};

export default function NoticeBoard({ globalSearch }: { globalSearch?: string }) {
  const { adminName } = useAuth();
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<NoticeRow | null>(null);

  // 👑 Premium Instant Quick Notice Broadcaster
  const [quickTitle, setQuickTitle] = useState('');
  const [quickMessage, setQuickMessage] = useState('');
  const [quickType, setQuickType] = useState<NoticeRow['type']>('offer');
  const [quickBadge, setQuickBadge] = useState('SPECIAL OFFER');
  const [quickIcon, setQuickIcon] = useState('🎉');
  const [quickActionText, setQuickActionText] = useState('Order Now');
  const [quickSendPush, setQuickSendPush] = useState(true);
  const [quickPosting, setQuickPosting] = useState(false);
  const [lastDebug, setLastDebug] = useState<string>('');
  // 'splash' = sirf phone push (app mein save nahi), 'inapp' = app banner mein save
  const [quickMode, setQuickMode] = useState<'splash' | 'inapp'>('splash');

  const handleQuickTone = (type: NoticeRow['type'], icon: string, badge: string) => {
    setQuickType(type);
    setQuickIcon(icon);
    setQuickBadge(badge);
  };

  const handleQuickPush = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!quickTitle.trim()) {
      setToast({ message: 'Notice headline / title daalna zaroori hai', type: 'error' });
      return;
    }
    if (!quickMessage.trim()) {
      setToast({ message: 'Notice message daalna zaroori hai', type: 'error' });
      return;
    }

    setQuickPosting(true);
    try {
      // SPLASH mode: sirf phone push — app mein save nahi hota
      if (quickMode === 'splash') {
        if (!quickSendPush) {
          setToast({ message: 'Splash mode mein phone push ON hona zaroori hai', type: 'error' });
          return;
        }
        const dbg: string[] = [];
        try {
          const { adminFetch, BACKEND_BASE, getAdminToken } = await import('../utils/adminApi');
          dbg.push(`backend=${BACKEND_BASE || '(same-origin)'}`);
          dbg.push(`hasApiToken=${!!getAdminToken()}`);
          let res: Response;
          try {
            res = await adminFetch('/api/admin/broadcast', {
              method: 'POST',
              body: JSON.stringify({
                title: `${quickIcon} ${quickTitle.trim()}`.trim(),
                body: quickMessage.trim(),
              }),
            });
          } catch (fetchErr) {
            const msg = `❌ Request never left the browser: ${(fetchErr as Error).message}.`;
            setLastDebug([...dbg, `fetch threw: ${(fetchErr as Error).message}`].join('\n'));
            setToast({ message: msg, type: 'error' });
            setQuickTitle('');
            setQuickMessage('');
            return;
          }
          const raw = await res.text().catch(() => '');
          let data: { pushed?: boolean; error?: string } | null = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
          dbg.push(`http=${res.status}`);
          dbg.push(`serverBody=${raw.slice(0, 200) || '(empty)'}`);
          setLastDebug(dbg.join('\n'));
          if (res.ok && data?.pushed) {
            setToast({ message: '🚀 Splash sent! Phone notification delivered (app mein save nahi hua).', type: 'success' });
          } else if (res.ok) {
            setToast({ message: '⚠️ Splash request gaya par server ne push reject kiya (pushed=false).', type: 'error' });
          } else {
            setToast({ message: `❌ Splash FAILED (server ${res.status}: ${data?.error || raw.slice(0, 80) || 'unknown'}).`, type: 'error' });
          }
        } catch (e) {
          const msg = `❌ Splash request failed (${(e as Error).message}).`;
          setLastDebug([...dbg, `outer threw: ${(e as Error).message}`].join('\n'));
          setToast({ message: msg, type: 'error' });
        }
        setQuickTitle('');
        setQuickMessage('');
        return;
      }

      // IN-APP mode: app banner mein save (push optional)
      // 1. Deactivate other active notices so this one takes spotlight
      for (const r of rows.filter((x) => x.isActive)) {
        await updateDoc(doc(db, 'app_notices', r.id), { isActive: false, updatedAt: serverTimestamp() }).catch(() => {});
      }

      const payload = {
        title: quickTitle.trim(),
        message: quickMessage.trim(),
        type: quickType,
        badge: quickBadge.trim() || 'NOTICE',
        icon: quickIcon.trim() || '📢',
        isActive: true,
        isSticky: true,
        actionText: quickActionText.trim(),
        actionUrl: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: adminName || 'Admin',
      };

      await addDoc(collection(db, 'app_notices'), payload);

      // 2. Broadcast via FCM phone push notification
      if (quickSendPush) {
        const dbg: string[] = [];
        try {
          const { adminFetch, BACKEND_BASE, getAdminToken } = await import('../utils/adminApi');
          dbg.push(`backend=${BACKEND_BASE || '(same-origin)'}`);
          dbg.push(`hasApiToken=${!!getAdminToken()}`);
          let res: Response;
          try {
            res = await adminFetch('/api/admin/broadcast', {
              method: 'POST',
              body: JSON.stringify({
                title: `${quickIcon} ${quickTitle.trim()}`.trim(),
                body: quickMessage.trim(),
              }),
            });
          } catch (fetchErr) {
            const msg = `❌ Request never left the browser: ${(fetchErr as Error).message}. Banner is live, phones won't buzz.`;
            setLastDebug([...dbg, `fetch threw: ${(fetchErr as Error).message}`].join('\n'));
            setToast({ message: msg, type: 'error' });
            setQuickTitle('');
            setQuickMessage('');
            return;
          }
          const raw = await res.text().catch(() => '');
          let data: { pushed?: boolean; error?: string } | null = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
          dbg.push(`http=${res.status}`);
          dbg.push(`serverBody=${raw.slice(0, 200) || '(empty)'}`);
          setLastDebug(dbg.join('\n'));
          if (res.ok && data?.pushed) {
            setToast({ message: '🚀 Broadcast published! Phone notification sent to all users!', type: 'success' });
          } else if (res.ok) {
            setToast({ message: `⚠️ Notice saved, but phone push FAILED (server: pushed=false). Banner is live, phones won't buzz.`, type: 'error' });
          } else {
            setToast({ message: `❌ Phone push FAILED (server ${res.status}: ${data?.error || raw.slice(0, 80) || 'unknown'}). Banner is live, phones won't buzz.`, type: 'error' });
          }
        } catch (e) {
          const msg = `❌ Phone push request failed (${(e as Error).message}). Banner is live, phones won't buzz.`;
          setLastDebug([...dbg, `outer threw: ${(e as Error).message}`].join('\n'));
          setToast({ message: msg, type: 'error' });
        }
      } else {
        setToast({ message: 'Notice bar activated and live for all customers!', type: 'success' });
      }

      setQuickTitle('');
      setQuickMessage('');
    } catch (err: unknown) {
      setToast({ message: `Broadcast failed: ${(err as Error).message}`, type: 'error' });
    } finally {
      setQuickPosting(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'app_notices'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NoticeRow, 'id'>) })));
      setLoading(false);
    }, (err) => {
      console.error('Error fetching notices:', err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const activeNotice = useMemo(() => {
    return rows.find((r) => r.isActive) || null;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) => `${r.title} ${r.message} ${r.badge ?? ''} ${r.type}`.toLowerCase().includes(s));
  }, [rows, search, globalSearch]);

  const openNew = () => {
    setFormId(null);
    setForm({ ...emptyForm });
  };

  const openEdit = (r: NoticeRow) => {
    setFormId(r.id);
    setForm({
      title: r.title || '',
      message: r.message || '',
      type: r.type || 'info',
      badge: r.badge || 'NOTICE',
      icon: r.icon || '📢',
      isActive: r.isActive ?? true,
      isSticky: r.isSticky ?? false,
      actionText: r.actionText || '',
      actionUrl: r.actionUrl || '',
      sendPush: false,
    });
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.title.trim()) {
      setToast({ message: 'Please enter a title for the notice', type: 'error' });
      return;
    }
    if (!form.message.trim()) {
      setToast({ message: 'Please enter the message content', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        badge: form.badge.trim() || 'NOTICE',
        icon: form.icon.trim() || '📢',
        isActive: form.isActive,
        isSticky: form.isSticky,
        actionText: form.actionText.trim(),
        actionUrl: form.actionUrl.trim(),
        updatedAt: serverTimestamp(),
        createdBy: adminName || 'Admin',
      };

      if (formId) {
        await updateDoc(doc(db, 'app_notices', formId), payload);
        if (form.sendPush) {
          try {
            const { adminFetch } = await import('../utils/adminApi');
            await adminFetch('/api/admin/broadcast', {
              method: 'POST',
              body: JSON.stringify({
                title: `${form.icon} ${form.title.trim()}`.trim(),
                body: form.message.trim(),
              }),
            });
          } catch (_) {}
        }
        setToast({ message: 'Notice updated & broadcasted successfully! 📲', type: 'success' });
      } else {
        await addDoc(collection(db, 'app_notices'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        // Phone push to every customer & rider (killed-app safe FCM topic).
        // In-app banner shows regardless; this is the extra buzz.
        if (form.sendPush) {
          try {
            const { adminFetch } = await import('../utils/adminApi');
            const res = await adminFetch('/api/admin/broadcast', {
              method: 'POST',
              body: JSON.stringify({
                title: `${form.icon} ${form.title.trim()}`.trim(),
                body: form.message.trim(),
              }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.pushed) {
              setToast({ message: 'Notice published & phone notification sent! 📲', type: 'success' });
            } else if (res.ok) {
              setToast({ message: '⚠️ Notice saved, but phone push FAILED (pushed=false). Banner live, phones won\'t buzz.', type: 'error' });
            } else {
              setToast({ message: `❌ Phone push FAILED (server ${res.status}: ${data?.error || 'unknown'}). Banner live, phones won't buzz.`, type: 'error' });
            }
          } catch {
            setToast({ message: '❌ Phone push request failed (network/auth). Banner live, phones won\'t buzz.', type: 'error' });
          }
        } else {
          setToast({ message: 'New notice published & broadcasted to all users!', type: 'success' });
        }
        setForm(null);
        setFormId(null);
        setSaving(false);
        return;
      }
      setForm(null);
      setFormId(null);
    } catch (e: unknown) {
      const err = e as Error;
      setToast({ message: `Failed to save notice: ${err.message || 'Error'}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: NoticeRow) => {
    try {
      await updateDoc(doc(db, 'app_notices', r.id), {
        isActive: !r.isActive,
        updatedAt: serverTimestamp(),
      });
      setToast({
        message: !r.isActive ? 'Notice activated & live for customers!' : 'Notice deactivated.',
        type: 'success',
      });
    } catch (e: unknown) {
      const err = e as Error;
      setToast({ message: `Toggle failed: ${err.message || 'Error'}`, type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, 'app_notices', deleting.id));
      setToast({ message: 'Notice deleted.', type: 'success' });
    } catch (e: unknown) {
      const err = e as Error;
      setToast({ message: `Delete failed: ${err.message || 'Error'}`, type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="notice-page">
      {/* Header */}
      <div className="notice-hero">
        <div>
          <h1>
            <span>📢</span>
            Customer Notice Board
            <span className="notice-live-pill">Live Broadcast</span>
          </h1>
          <p>
            Post instant broadcast messages, festive announcements, service alerts, or holiday notices visible to all customers on both the Mobile App and Website in real time.
          </p>
        </div>
        <button onClick={openNew} className="btn btn-primary" style={{ padding: '12px 22px', fontSize: 14 }}>
          ➕ Create New Notice
        </button>
      </div>

      {/* 👑 PREMIUM INSTANT QUICK NOTICE BROADCASTER BAR */}
      <div className="notice-broadcaster">
        <div className="notice-broadcaster-head">
          <div>
            <h2>
              <span>👑</span>
              Instant Premium Notice Broadcaster
              <span className="notice-live-pill">Push to all users</span>
            </h2>
              <p style={{ fontSize: 12, color: '#B45309', margin: '4px 0 0' }}>
                Write here to immediately update the Home Screen Notice Bar on all customer phones and optionally buzz their phone with a push notification.
              </p>
            </div>
            <span className="notice-sync-pill">● Real-Time Cloud Sync</span>
        </div>

        {/* Form Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Mode selector: Splash vs In-App */}
            <div>
              <label className="notice-label">1. Delivery Mode</label>
              <div className="notice-tone-row">
                <button
                  type="button"
                  onClick={() => setQuickMode('splash')}
                  className={`notice-tone-btn${quickMode === 'splash' ? ' active' : ''}`}
                >
                  🔔 Splash — Sirf Phone Push (app mein nahi)
                </button>
                <button
                  type="button"
                  onClick={() => setQuickMode('inapp')}
                  className={`notice-tone-btn${quickMode === 'inapp' ? ' active' : ''}`}
                >
                  📱 In-App — App Banner mein save
                </button>
              </div>
            </div>

            {/* Tone selector */}
            <div>
              <label className="notice-label">2. Select Notice Tone / Style</label>
              <div className="notice-tone-row">
                {[
                  { type: 'offer' as const, icon: '🎉', badge: 'SPECIAL OFFER', label: 'Festive / Offer 🎉' },
                  { type: 'info' as const, icon: '📢', badge: 'ANNOUNCEMENT', label: 'Announcement 📢' },
                  { type: 'celebration' as const, icon: '✨', badge: 'FOOD MELA', label: 'Celebration / Greeting ✨' },
                  { type: 'alert' as const, icon: '⚠️', badge: 'ALERT', label: 'Important Alert ⚠️' },
                  { type: 'emergency' as const, icon: '🚨', badge: 'URGENT', label: 'Emergency / Delay 🚨' },
                ].map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => handleQuickTone(t.type, t.icon, t.badge)}
                    className={`notice-tone-btn${quickType === t.type ? ' active' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Headline Title */}
            <div>
              <label className="notice-label">2. Headline / Title *</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>{quickIcon}</span>
                <input
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="e.g. Flat 50% OFF on all Biryanis Today!"
                  className="notice-input"
                />
              </div>
            </div>

            {/* Notice Message */}
            <div>
              <label className="notice-label">3. Notice Message to All Users *</label>
              <textarea
                rows={3}
                value={quickMessage}
                onChange={(e) => setQuickMessage(e.target.value)}
                placeholder="Write message details for the app banner and push notification..."
                className="notice-textarea"
                style={{ resize: 'none' }}
              />
            </div>

            {/* Optional CTA & Push Checkbox */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'end' }}>
              <div>
                <label className="notice-label">Button Action (Optional)</label>
                <input
                  type="text"
                  value={quickActionText}
                  onChange={(e) => setQuickActionText(e.target.value)}
                  placeholder="e.g. Order Now, Explore Menu"
                  className="notice-input"
                />
              </div>

              <label className="notice-push-row">
                <input
                  type="checkbox"
                  checked={quickSendPush}
                  onChange={(e) => setQuickSendPush(e.target.checked)}
                />
                <span>📲 Send Phone Push (FCM Buzz to all devices)</span>
              </label>
            </div>

            {/* Big Push Action Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
              <button
                type="button"
                disabled={quickPosting}
                onClick={() => void handleQuickPush()}
                className="notice-push-btn"
              >
                {quickPosting ? 'Broadcasting to all users...' : '🚀 PUSH TO ALL USERS NOW'}
              </button>

              {(quickTitle || quickMessage) && (
                <button
                  type="button"
                  onClick={() => { setQuickTitle(''); setQuickMessage(''); }}
                  className="notice-clear-btn"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Live In-App Mobile Preview */}
          <div style={{ background: '#FFF7ED', border: '1.5px solid #FDBA74', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #FDE68A', paddingBottom: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#B45309' }}>
                  📱 Live App Bar Preview
                </span>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>Customer Screen</span>
              </div>
              <p style={{ fontSize: 11, color: '#92400E', margin: '0 0 10px' }}>
                This is how the notice bar appears inside FoodMela Customer App:
              </p>

              {/* Simulated Customer App Notice Banner */}
              <div className={`notice-preview-card notice-preview-${quickType}`}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 24, background: 'rgba(255,255,255,0.2)', borderRadius: 10, padding: 6 }}>
                    {quickIcon || '📢'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(0,0,0,0.35)', padding: '2px 8px', borderRadius: 6 }}>
                        {quickBadge || 'NOTICE'}
                      </span>
                    </div>
                    <h4 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 4px', lineHeight: 1.3 }}>
                      {quickTitle.trim() || 'Your Announcement Headline Here'}
                    </h4>
                    <p style={{ fontSize: 12, margin: 0, opacity: 0.92, lineHeight: 1.5 }}>
                      {quickMessage.trim() || 'Your live message will display right here for all customers.'}
                    </p>
                  </div>
                </div>

                {quickActionText && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                    <span style={{ padding: '4px 12px', borderRadius: 8, background: '#fff', color: '#1F2937', fontWeight: 800, fontSize: 11 }}>
                      {quickActionText} →
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#92400E', background: '#FFFBEB', padding: 10, borderRadius: 10, border: '1px solid #FDE68A' }}>
              ⚡ Publishing activates this notice instantly across all connected phones without app restart.
            </div>

            {lastDebug && (
              <div className="notice-debug-box">
                <strong>🔍 LAST PUSH DEBUG (screenshot bhejo):</strong>
                {lastDebug}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Active Notice Preview Banner */}
      {activeNotice && (
        <div className="notice-live-banner">
          <div className="notice-live-banner-head">
            <span className="notice-live-label">
              <span className="notice-live-dot" />
              Currently Live on All Customer Devices
            </span>
            <button onClick={() => toggleActive(activeNotice)} className="btn btn-sm" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5' }}>
              Deactivate Notice
            </button>
          </div>

          <div className={`notice-preview-card notice-preview-${activeNotice.type}`}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 30 }}>{activeNotice.icon || '📢'}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 6 }}>
                    {activeNotice.badge || 'NOTICE'}
                  </span>
                  <strong style={{ fontSize: 16 }}>{activeNotice.title}</strong>
                </div>
                <p style={{ fontSize: 13, margin: '4px 0 0', opacity: 0.92 }}>{activeNotice.message}</p>
              </div>
              {activeNotice.actionText && (
                <span style={{ padding: '8px 16px', borderRadius: 10, background: '#fff', color: '#1F2937', fontWeight: 800, fontSize: 12 }}>
                  {activeNotice.actionText} →
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notices List Section */}
      <div className="notice-section">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F3F4F6', paddingBottom: 14, marginBottom: 16 }}>
          <div>
            <h2>Broadcast History &amp; Saved Notices</h2>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>Total {rows.length} notices created</p>
          </div>
          <input
            type="text"
            placeholder="Search notices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="notice-input"
            style={{ maxWidth: 260 }}
          />
        </div>

        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>Loading broadcast notices...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📢"
            title="No notices found"
            subtitle="Create your first notice to broadcast announcements to your customers."
          />
        ) : (
          <div className="notice-card-grid">
            {filtered.map((item) => {
              const typeCfg = NOTICE_TYPES.find((t) => t.value === item.type) || NOTICE_TYPES[0];
              return (
                <div key={item.id} className={`notice-card${item.isActive ? ' live' : ''}`}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>{item.icon || '📢'}</span>
                        <span className={`notice-type-tag notice-type-${item.type}`}>
                          {item.badge || 'NOTICE'}
                        </span>
                      </div>
                      <span className={item.isActive ? 'notice-status-live' : 'notice-status-off'}>
                        {item.isActive ? '● Live Active' : '○ Inactive'}
                      </span>
                    </div>

                    <h3>{item.title}</h3>
                    <p>{item.message}</p>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{typeCfg.label}</div>

                    {item.actionText && (
                      <div style={{ fontSize: 11, color: '#EA580C', fontWeight: 600, paddingTop: 4 }}>
                        Button: <span style={{ textDecoration: 'underline' }}>{item.actionText}</span> {item.actionUrl ? `(${item.actionUrl})` : ''}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 12 }}>
                    <button onClick={() => toggleActive(item)} className="btn btn-sm" style={item.isActive ? { background: '#FEF3C7', color: '#B45309' } : { background: '#D1FAE5', color: '#047857' }}>
                      {item.isActive ? 'Turn Off' : 'Publish Live'}
                    </button>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openEdit(item)} className="btn btn-sm btn-ghost">
                        Edit
                      </button>
                      <button onClick={() => setDeleting(item)} className="btn btn-sm" style={{ background: '#FEE2E2', color: '#B91C1C' }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Modal Dialog */}
      {form && (
        <div className="dialog-overlay" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div className="notice-modal">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6', paddingBottom: 12, marginBottom: 16 }}>
              <h3>
                <span style={{ marginRight: 8 }}>📢</span>
                {formId ? 'Edit Broadcast Notice' : 'Create New Broadcast Notice'}
              </h3>
              <button onClick={() => setForm(null)} className="btn btn-sm btn-ghost">✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
              {/* Type Selection */}
              <div>
                <label className="notice-label">Notice Category / Tone</label>
                <div className="notice-tone-row">
                  {NOTICE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value as NoticeRow['type'], icon: t.defaultIcon, badge: t.defaultBadge })}
                      className={`notice-tone-btn${form.type === t.value ? ' active' : ''}`}
                    >
                      {t.defaultIcon} {t.label.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Badge */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <div>
                  <label className="notice-label">Badge</label>
                  <input
                    type="text"
                    placeholder="NOTICE"
                    value={form.badge}
                    onChange={(e) => setForm({ ...form, badge: e.target.value })}
                    className="notice-input"
                  />
                </div>
                <div>
                  <label className="notice-label">Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Free Delivery on Orders Above ₹199!"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="notice-input"
                  />
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="notice-label">Notice Message *</label>
                <textarea
                  rows={3}
                  placeholder="Write clear, friendly message in Odia, English, or Hindi..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="notice-textarea"
                  style={{ resize: 'none' }}
                />
              </div>

              {/* Icon & Action Link */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <div>
                  <label className="notice-label">Emoji / Icon</label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    className="notice-input"
                    style={{ textAlign: 'center', fontSize: 18 }}
                  />
                </div>
                <div>
                  <label className="notice-label">Button Text (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Order Now / View Offers"
                    value={form.actionText}
                    onChange={(e) => setForm({ ...form, actionText: e.target.value })}
                    className="notice-input"
                  />
                </div>
              </div>

              {/* Toggles */}
              <label className="notice-push-row">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span>Publish Live Immediately — broadcast to mobile app &amp; website</span>
              </label>

              {/* Phone push toggle — new notices only */}
              {!formId && (
                <label className="notice-push-row">
                  <input
                    type="checkbox"
                    checked={form.sendPush}
                    onChange={(e) => setForm({ ...form, sendPush: e.target.checked })}
                  />
                  <span>📲 Phone Notification — buzz every customer phone, even with app closed</span>
                </label>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, marginTop: 16, borderTop: '1px solid #F3F4F6' }}>
              <button type="button" onClick={() => setForm(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleSave} className="btn btn-primary">
                {saving ? 'Publishing...' : formId ? 'Save Changes' : 'Publish Broadcast Notice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Notice?"
        message={`Are you sure you want to permanently delete "${deleting?.title}"?`}
        confirmLabel="Delete Notice"
        confirmColor="#EF4444"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      {/* Toast feedback */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
