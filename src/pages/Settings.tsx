import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Toast } from '../components/UI';

// Same-domain backend: foodmela.online/api in production.
const BACKEND_BASE =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '')
  ?? (import.meta.env.PROD ? '' : 'https://food-mela-backend.vercel.app');

export default function Settings() {
  const { adminName, user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [eta, setEta] = useState('30 min');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [serverState, setServerState] = useState<{ enabled: boolean; eta: string } | null>(null);

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

  // Server kill-switch ka live status (Redis flag) — har 5 sec refresh.
  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch(`${BACKEND_BASE}/api/maintenance/status`);
        const d = await r.json();
        if (alive && d.success) setServerState({ enabled: d.enabled === true, eta: d.eta || '' });
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
