import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Toast } from '../components/UI';

// Backend lives at foodmela.online (admin site is static-only —
// same-origin /api/* on Vercel returns 405 for POST).
const BACKEND_BASE =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '')
  ?? 'https://foodmela.online';

export default function Settings() {
  const { adminName, user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [eta, setEta] = useState('30 min');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [serverState, setServerState] = useState<{ enabled: boolean; eta: string } | null>(null);
  // Reviewer demo-login card visibility in customer app (default ON).
  const [reviewerOn, setReviewerOn] = useState(true);
  const [reviewerSaving, setReviewerSaving] = useState(false);
  // ── Server-driven fee controls (app_settings/fees) ──
  // App + website read these live; hardcoded values are only fallback.
  const [fees, setFees] = useState({ baseFee: '12', perKm: '2', freeAbove: '249', platformFee: '10', smallOrderFee: '20', smallOrderBelow: '100', lunchSurge: '5', dinnerSurge: '5', nightSurge: '5' });
  const [feesSaving, setFeesSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'maintenance'), (snap) => {
      setError('');
      if (snap.exists()) {
        const d = snap.data();
        setEnabled(d.enabled === true);
        setEta(d.eta || '30 min');
      }
    }, (err) => {
      setError(`Firestore read failed: ${err.code} — ${err.message}`);
    });
    return () => unsub();
  }, []);

  // Reviewer demo-login flag — live from Firestore, missing doc = visible.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'reviewer_login'), (snap) => {
      if (snap.exists()) setReviewerOn(snap.data().enabled !== false);
      else setReviewerOn(true);
    }, () => setReviewerOn(true));
    return () => unsub();
  }, []);

  const toggleReviewer = async () => {
    setReviewerSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', 'reviewer_login'), {
        enabled: !reviewerOn,
        updatedBy: adminName || 'admin',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setToast(!reviewerOn ? '🟢 Reviewer login VISIBLE in app' : '🔴 Reviewer login HIDDEN from app');
    } catch (e) {
      setToast(`❌ Save failed — ${e instanceof Error ? e.message : e}`);
    } finally {
      setReviewerSaving(false);
    }
  };

  // Fee controls — live from Firestore app_settings/fees, missing doc = defaults.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'fees'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setFees({
          baseFee: String(d.baseFee ?? 12),
          perKm: String(d.perKm ?? 2),
          freeAbove: String(d.freeAbove ?? 249),
          platformFee: String(d.platformFee ?? 10),
          smallOrderFee: String(d.smallOrderFee ?? 20),
          smallOrderBelow: String(d.smallOrderBelow ?? 100),
          lunchSurge: String(d.lunchSurge ?? 5),
          dinnerSurge: String(d.dinnerSurge ?? 5),
          nightSurge: String(d.nightSurge ?? 5),
        });
      }
    }, () => {});
    return () => unsub();
  }, []);

  const saveFees = async () => {
    setFeesSaving(true);
    try {
      const num = (v: string, fb: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fb; };
      await setDoc(doc(db, 'app_settings', 'fees'), {
        baseFee: num(fees.baseFee, 12),
        perKm: num(fees.perKm, 2),
        freeAbove: num(fees.freeAbove, 249),
        platformFee: num(fees.platformFee, 10),
        smallOrderFee: num(fees.smallOrderFee, 20),
        smallOrderBelow: num(fees.smallOrderBelow, 100),
        lunchSurge: num(fees.lunchSurge, 5),
        dinnerSurge: num(fees.dinnerSurge, 5),
        nightSurge: num(fees.nightSurge, 5),
        updatedBy: adminName || 'admin',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setToast('💰 Fee settings saved — app + website update live ✅');
    } catch (e) {
      setToast(`❌ Save failed — ${e instanceof Error ? e.message : e}`);
    } finally {
      setFeesSaving(false);
    }
  };

  // Server kill-switch ka live status (Redis flag) — har 5 sec refresh.
  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch(`${BACKEND_BASE}/api/maintenance/status`);
        const d = (await r.json().catch(() => null)) as { success?: boolean; enabled?: boolean; eta?: string } | null;
        if (alive && d?.success) setServerState({ enabled: d.enabled === true, eta: d.eta || '' });
      } catch { /* ignore — neeche error dikhega */ }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Ek button → dono kill-switch: Firestore (website) + Redis via backend (purane apps/API).
  const toggle = async () => {
    setSaving(true);
    setError('');
    try {
      await setDoc(doc(db, 'app_settings', 'maintenance'), {
        enabled: !enabled,
        eta,
        updatedBy: adminName || 'admin',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      // Server-side kill-switch — purane installed apps ke liye.
      try {
        const idToken = await user?.getIdToken();
        if (!idToken) {
          setError('⚠️ Website flag save ho gaya, par server flag ke liye admin login chahiye — dobara login karo.');
        } else {
          const resp = await fetch(`${BACKEND_BASE}/api/admin/maintenance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ enabled: !enabled, eta }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.success) {
            setError(`⚠️ Website flag save ho gaya, par server flag fail: ${data.error || resp.status}`);
          } else {
            setServerState({ enabled: !enabled, eta });
          }
        }
      } catch (e) {
        setError(`⚠️ Website flag save ho gaya, par server tak nahi pahuncha: ${e instanceof Error ? e.message : e}`);
      }
      setToast(!enabled ? '🔴 Maintenance ON — website + apps + server band' : '🟢 Maintenance OFF — sab normal');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`❌ Save failed: ${msg}`);
      setToast('❌ Save failed — neeche error dekho');
    } finally {
      setSaving(false);
    }
  };

  const saveEta = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', 'maintenance'), {
        eta,
        updatedBy: adminName || 'admin',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setToast('⏳ ETA update ho gaya');
    } catch {
      setToast('❌ Save failed — dobara try karo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      <div className="card" style={{ padding: '24px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px' }}>🛠️ Maintenance Mode</h2>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: '13px' }}>
          ON karne par foodmela.online par animated maintenance page dikhega. Admin panel khula rahega.
        </p>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px', borderRadius: '12px', marginBottom: '16px',
          background: enabled ? '#FEF2F2' : '#F0FDF4',
          border: `1px solid ${enabled ? '#FECACA' : '#BBF7D0'}`,
        }}>
          <div>
            <div style={{ fontWeight: 800, color: enabled ? '#DC2626' : '#16A34A' }}>
              {enabled ? '🔴 Maintenance ON hai' : '🟢 Site normal chal rahi hai'}
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
              {enabled ? 'Customers ko maintenance screen dikh raha hai' : 'Customers normal order kar sakte hain'}
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className="btn"
            style={{
              background: enabled ? '#16A34A' : '#DC2626',
              color: '#fff', border: 'none', padding: '12px 20px',
              borderRadius: '10px', fontWeight: 800, cursor: 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '...' : enabled ? 'OFF karo' : 'ON karo'}
          </button>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13px', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {serverState && (
          <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', background: serverState.enabled ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${serverState.enabled ? '#FECACA' : '#BBF7D0'}`, fontSize: '13px', fontWeight: 700, color: serverState.enabled ? '#DC2626' : '#16A34A' }}>
            🖥️ Server kill-switch: {serverState.enabled ? `🔴 ON (ETA: ${serverState.eta})` : '🟢 OFF'} — purane apps {serverState.enabled ? 'band hain' : 'chal rahe hain'}
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px', borderRadius: '12px', marginBottom: '16px',
          background: reviewerOn ? '#FFF7ED' : '#F0FDF4',
          border: `1px solid ${reviewerOn ? '#FDBA74' : '#BBF7D0'}`,
        }}>
          <div>
            <div style={{ fontWeight: 800, color: reviewerOn ? '#EA580C' : '#16A34A' }}>
              {reviewerOn ? '🛡️ Reviewer Demo Login VISIBLE' : '🟢 Reviewer Login HIDDEN'}
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
              {reviewerOn ? 'App sign-in par "Google Reviewer Demo Login" card dikh raha hai' : 'Customers ko reviewer card nahi dikhega'}
            </div>
          </div>
          <button
            onClick={toggleReviewer}
            disabled={reviewerSaving}
            className="btn"
            style={{
              background: reviewerOn ? '#16A34A' : '#EA580C',
              color: '#fff', border: 'none', padding: '12px 20px',
              borderRadius: '10px', fontWeight: 800, cursor: 'pointer',
              opacity: reviewerSaving ? 0.6 : 1,
            }}
          >
            {reviewerSaving ? '...' : reviewerOn ? 'HIDE karo' : 'SHOW karo'}
          </button>
        </div>

      {/* ── 💰 Delivery & Fee Controls (server-driven, live on app + website) ── */}
      <div className="card" style={{ padding: '24px', marginTop: '16px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px' }}>💰 Delivery & Fee Controls</h2>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: '13px' }}>
          Ye values app + website par LIVE lagti hain — save karte hi. UI same rahega, sirf numbers badlenge.
        </p>
        {[
          { k: 'baseFee', label: '🛵 Base delivery fee (₹)', hint: '0–3 km tak' },
          { k: 'perKm', label: '📏 Per-km charge (₹/km)', hint: 'har extra km par' },
          { k: 'freeAbove', label: '🎉 FREE delivery above (₹)', hint: 'is order value par delivery free' },
          { k: 'platformFee', label: '🏢 Platform fee (₹)', hint: 'har order par' },
          { k: 'smallOrderFee', label: '📦 Small-order fee (₹)', hint: 'chhote order par extra' },
          { k: 'smallOrderBelow', label: '📦 Small-order below (₹)', hint: 'is value se neeche small fee' },
          { k: 'lunchSurge', label: '🍱 Lunch surge (₹)', hint: '12–3:30 PM' },
          { k: 'dinnerSurge', label: '🌙 Dinner surge (₹)', hint: '7–10:30 PM' },
          { k: 'nightSurge', label: '🌌 Late-night surge (₹)', hint: '11 PM–4 AM' },
        ].map((f) => (
          <div key={f.k} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, flex: 1 }}>{f.label} <span style={{ color: '#999', fontWeight: 400 }}>({f.hint})</span></label>
            <input
              type="number" min="0"
              value={(fees as Record<string, string>)[f.k]}
              onChange={(e) => setFees({ ...fees, [f.k]: e.target.value })}
              style={{ width: '110px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #ddd' }}
            />
          </div>
        ))}
        <button onClick={saveFees} disabled={feesSaving} className="btn" style={{ width: '100%', padding: '12px', borderRadius: '10px', cursor: 'pointer', background: '#16A34A', color: '#fff', border: 'none', fontWeight: 800, opacity: feesSaving ? 0.6 : 1 }}>
          {feesSaving ? 'Saving...' : '💾 Save Fee Settings'}
        </button>
      </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>⏳ Expected time:</label>
          <input
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder="30 min"
            style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #ddd' }}
          />
          <button onClick={saveEta} disabled={saving} className="btn" style={{ padding: '10px 16px', borderRadius: '10px', cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}
