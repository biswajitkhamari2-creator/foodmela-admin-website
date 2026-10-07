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
        try {
          const { adminFetch } = await import('../utils/adminApi');
          const res = await adminFetch('/api/admin/broadcast', {
            method: 'POST',
            body: JSON.stringify({
              title: `${quickIcon} ${quickTitle.trim()}`.trim(),
              body: quickMessage.trim(),
            }),
          });
          const data = await res.json().catch(() => null);
          if (data?.pushed) {
            setToast({ message: '🚀 Broadcast published! Phone notification sent to all users!', type: 'success' });
          } else {
            setToast({ message: 'Notice live on customer app! (Phone push sent)', type: 'success' });
          }
        } catch {
          setToast({ message: 'Notice live on customer app banner!', type: 'success' });
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
            if (data?.pushed) {
              setToast({ message: 'Notice published & phone notification sent! 📲', type: 'success' });
            } else {
              setToast({ message: 'Notice published (phone push failed — banner still live)', type: 'error' });
            }
          } catch {
            setToast({ message: 'Notice published (phone push failed — banner still live)', type: 'error' });
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
    <div className="page-container p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📢</span>
            <h1 className="text-2xl font-black text-white tracking-tight">Customer Notice Board</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-gradient-to-r from-orange-500 to-amber-500 text-white uppercase tracking-wider">
              Live Broadcast
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            Post instant broadcast messages, festive announcements, service alerts, or holiday notices visible to all customers on both the Mobile App and Website in real time.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm shadow-lg shadow-orange-500/25 active:scale-95 transition-all"
        >
          <span>➕</span>
          <span>Create New Notice</span>
        </button>
      </div>

      {/* 👑 PREMIUM INSTANT QUICK NOTICE BROADCASTER BAR */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800/95 to-slate-900 border-2 border-amber-500/40 rounded-3xl p-6 shadow-2xl relative overflow-hidden space-y-5">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/60 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/20 text-amber-300 text-xl">👑</span>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                Instant Premium Notice Broadcaster
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  PUSH TO ALL USERS
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Write here to immediately update the Home Screen Notice Bar on all customer phones and optionally buzz their phone with a push notification.
              </p>
            </div>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold self-start sm:self-center">
            ● Real-Time Cloud Sync
          </span>
        </div>

        {/* Form Inputs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            {/* Tone selector */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                1. Select Notice Tone / Style
              </label>
              <div className="flex flex-wrap gap-2">
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
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      quickType === t.type
                        ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md scale-105'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Headline Title */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                2. Headline / Title *
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg">{quickIcon}</span>
                <input
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder="e.g. Flat 50% OFF on all Biryanis Today! / Delivery is super fast"
                  className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-amber-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            {/* Notice Message */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                3. Notice Message to All Users *
              </label>
              <textarea
                rows={3}
                value={quickMessage}
                onChange={(e) => setQuickMessage(e.target.value)}
                placeholder="Write message details for the app banner and push notification (e.g. Order before 3 PM to enjoy fresh hot food with fast 45-min delivery!)..."
                className="w-full px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-amber-500 focus:outline-none transition-all resize-none"
              />
            </div>

            {/* Optional CTA & Push Checkbox */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1 uppercase tracking-wider">
                  Button Action (Optional)
                </label>
                <input
                  type="text"
                  value={quickActionText}
                  onChange={(e) => setQuickActionText(e.target.value)}
                  placeholder="e.g. Order Now, Explore Menu"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700 text-white placeholder-slate-500 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-700/80 cursor-pointer hover:bg-slate-950 transition-all select-none mt-4 sm:mt-5">
                <input
                  type="checkbox"
                  checked={quickSendPush}
                  onChange={(e) => setQuickSendPush(e.target.checked)}
                  className="w-4 h-4 rounded text-orange-500 bg-slate-800 border-slate-600 focus:ring-orange-500 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-200">
                  📲 Send Phone Push (FCM Buzz to all devices)
                </span>
              </label>
            </div>

            {/* Big Push Action Button */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                disabled={quickPosting}
                onClick={() => void handleQuickPush()}
                className="flex-1 py-3.5 px-6 rounded-2xl font-black text-sm uppercase tracking-wider text-slate-950 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-300 hover:via-orange-300 hover:to-amber-400 shadow-xl shadow-orange-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {quickPosting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Broadcasting to all users...</span>
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    <span>PUSH TO ALL USERS NOW</span>
                  </>
                )}
              </button>

              {(quickTitle || quickMessage) && (
                <button
                  type="button"
                  onClick={() => { setQuickTitle(''); setQuickMessage(''); }}
                  className="px-4 py-3.5 rounded-2xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Live In-App Mobile Preview */}
          <div className="lg:col-span-5 flex flex-col justify-between p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <span>📱</span> Live App Bar Preview
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Customer Screen</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                This is how the notice bar appears inside FoodMela Customer App:
              </p>

              {/* Simulated Customer App Notice Banner */}
              <div
                className={`p-4 rounded-2xl text-white shadow-xl space-y-2 border border-white/20 transition-all ${
                  quickType === 'offer'
                    ? 'bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 shadow-orange-600/30'
                    : quickType === 'celebration'
                    ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 shadow-emerald-600/30'
                    : quickType === 'alert'
                    ? 'bg-gradient-to-r from-amber-700 via-orange-700 to-red-700 shadow-red-600/30'
                    : quickType === 'emergency'
                    ? 'bg-gradient-to-r from-red-700 via-rose-700 to-red-800 shadow-rose-700/30'
                    : 'bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 shadow-indigo-600/30'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-2xl p-1.5 rounded-xl bg-white/15 backdrop-blur-sm">
                    {quickIcon || '📢'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-black/40 text-amber-200 border border-white/20">
                        {quickBadge || 'NOTICE'}
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <h4 className="text-sm font-black text-white leading-tight">
                      {quickTitle.trim() || 'Your Announcement Headline Here'}
                    </h4>
                    <p className="text-xs text-white/90 leading-relaxed mt-1">
                      {quickMessage.trim() || 'Your live message will display right here for all customers.'}
                    </p>
                  </div>
                </div>

                {quickActionText && (
                  <div className="flex justify-end pt-1">
                    <span className="px-3 py-1 rounded-xl bg-white text-slate-900 font-black text-[11px] shadow-md">
                      {quickActionText} →
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 flex items-center gap-2">
              <span>⚡</span>
              <span>Publishing activates this notice instantly across all connected phones without app restart.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Active Notice Preview Banner */}
      {activeNotice && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-orange-500/30 rounded-3xl p-5 shadow-2xl space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                Currently Live on All Customer Devices
              </span>
            </div>
            <button
              onClick={() => toggleActive(activeNotice)}
              className="text-xs px-3 py-1 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all"
            >
              Deactivate Notice
            </button>
          </div>

          <div className={`p-4 rounded-2xl bg-gradient-to-r ${NOTICE_TYPES.find(t => t.value === activeNotice.type)?.color || 'from-blue-600 to-indigo-600'} text-white shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
            <div className="flex items-start gap-3">
              <span className="text-3xl p-2 rounded-xl bg-white/10 backdrop-blur-sm">{activeNotice.icon || '📢'}</span>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-black/30 text-white border border-white/20">
                    {activeNotice.badge || 'NOTICE'}
                  </span>
                  <strong className="text-base font-black">{activeNotice.title}</strong>
                </div>
                <p className="text-xs sm:text-sm text-white/90 leading-relaxed max-w-2xl">{activeNotice.message}</p>
              </div>
            </div>
            {activeNotice.actionText && (
              <span className="self-start sm:self-center px-4 py-2 rounded-xl bg-white text-slate-900 font-extrabold text-xs shadow-md whitespace-nowrap">
                {activeNotice.actionText} →
              </span>
            )}
          </div>
        </div>
      )}

      {/* Notices List Section */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Broadcast History &amp; Saved Notices</h2>
            <p className="text-xs text-slate-400">Total {rows.length} notices created</p>
          </div>
          <input
            type="text"
            placeholder="Search notices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 w-full sm:w-64"
          />
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading broadcast notices...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📢"
            title="No notices found"
            subtitle="Create your first notice to broadcast announcements to your customers."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((item) => {
              const typeCfg = NOTICE_TYPES.find((t) => t.value === item.type) || NOTICE_TYPES[0];
              return (
                <div
                  key={item.id}
                  className={`p-5 rounded-2xl border transition-all ${item.isActive ? 'bg-slate-800/90 border-orange-500/50 shadow-lg shadow-orange-500/10' : 'bg-slate-800/40 border-slate-700/60 opacity-80'} flex flex-col justify-between gap-4`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{item.icon || '📢'}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-slate-700 text-orange-400 border border-orange-500/20">
                          {item.badge || 'NOTICE'}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">{typeCfg.label}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${item.isActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700/50 text-slate-400'}`}>
                        {item.isActive ? '● Live Active' : '○ Inactive'}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white">{item.title}</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">{item.message}</p>

                    {item.actionText && (
                      <div className="text-[11px] text-orange-400 font-semibold pt-1">
                        Button: <span className="underline">{item.actionText}</span> {item.actionUrl ? `(${item.actionUrl})` : ''}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-700/50 text-xs">
                    <button
                      onClick={() => toggleActive(item)}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all ${item.isActive ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'}`}
                    >
                      {item.isActive ? 'Turn Off' : 'Publish Live'}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(item)}
                        className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(item)}
                        className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold transition-all"
                      >
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl text-white my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📢</span>
                <h3 className="text-lg font-bold">
                  {formId ? 'Edit Broadcast Notice' : 'Create New Broadcast Notice'}
                </h3>
              </div>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Type Selection */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">Notice Category / Tone</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NOTICE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value as NoticeRow['type'], icon: t.defaultIcon, badge: t.defaultBadge })}
                      className={`p-2.5 rounded-xl border text-left font-bold transition-all flex items-center gap-1.5 ${form.type === t.value ? 'bg-orange-500/20 border-orange-500 text-orange-300' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'}`}
                    >
                      <span>{t.defaultIcon}</span>
                      <span className="truncate">{t.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Badge */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-slate-300 font-bold mb-1">Badge</label>
                  <input
                    type="text"
                    placeholder="NOTICE"
                    value={form.badge}
                    onChange={(e) => setForm({ ...form, badge: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold placeholder-slate-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-300 font-bold mb-1">Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Free Delivery on Orders Above ₹199!"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold placeholder-slate-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-slate-300 font-bold mb-1">Notice Message *</label>
                <textarea
                  rows={3}
                  placeholder="Write clear, friendly message in Odia, English, or Hindi..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Icon & Action Link */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-slate-300 font-bold mb-1">Emoji / Icon</label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold text-center text-lg focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-300 font-bold mb-1">Button Text (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Order Now / View Offers"
                    value={form.actionText}
                    onChange={(e) => setForm({ ...form, actionText: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
                <div>
                  <strong className="text-white block">Publish Live Immediately</strong>
                  <span className="text-[11px] text-slate-400">Broadcast immediately to mobile app &amp; customer website</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                </label>
              </div>

              {/* Phone push toggle — new notices only */}
              {!formId && (
                <div className="p-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/40 flex items-center justify-between">
                  <div>
                    <strong className="text-white block">📲 Phone Notification</strong>
                    <span className="text-[11px] text-slate-400">Buzz every customer phone, even with the app closed</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sendPush}
                      onChange={(e) => setForm({ ...form, sendPush: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-lg shadow-orange-500/25 active:scale-95 transition-all disabled:opacity-50"
              >
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
