import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, serverTimestamp, addDoc, getDocs } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmptyState, ConfirmDialog, Toast, Pagination } from '../components/UI';
import type { UserRecord } from '../types';

// ── Auto-generate password from name + phone ───────────────────────────────
function genPasswordFromNamePhone(name: string, phone: string): string {
  const firstName = (name.trim().split(/\s+/)[0] || 'User').replace(/[^a-zA-Z]/g, '');
  const cap = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  const base = cap.length >= 2 ? cap : 'FoodMela';
  const digits = phone.replace(/[^0-9]/g, '').slice(-4) || String(1000 + Math.floor(Math.random() * 9000));
  const rand = String(10 + Math.floor(Math.random() * 90));
  const syms = ['@', '#', '*', '!'];
  const sym = syms[Math.floor(Math.random() * syms.length)];
  return `${base}${sym}${digits}${rand}`;
}

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};

const PAGE_SIZE = 20;

function genPartnerId(name: string): string {
  const clean = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = clean.length >= 3 ? clean.slice(0, 3) : (clean + 'XXX').slice(0, 3);
  const suffix = String(1000 + Math.floor(Math.random() * 9000));
  return `${prefix}-${suffix}`;
}

async function uniquePartnerId(name: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const cand = genPartnerId(name);
    // Check both new format (XXX-XXXX) and legacy FM-XXX-XXXX
    const snap = await getDocs(query(collection(db, 'users'), where('partnerId', '==', cand)));
    if (snap.empty) {
      const legacySnap = await getDocs(query(collection(db, 'users'), where('partnerId', '==', `FM-${cand}`)));
      if (legacySnap.empty) return cand;
    }
  }
  return `${name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3).padEnd(3, 'X')}-${String(Date.now() % 10000).padStart(4, '0')}`;
}

export default function Partners({ globalSearch }: { globalSearch?: string }) {
  const { user, adminName } = useAuth();
  const [partners, setPartners] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [approvalFilter, setApprovalFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; blocked: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addPasswordShow, setAddPasswordShow] = useState(false);
  const [addCopied, setAddCopied] = useState(false);
  const [adding, setAdding] = useState(false);

  // ── Password reset ─────────────────────────────────────────────────
  const [pwdTarget, setPwdTarget] = useState<UserRecord | null>(null);
  const [pwdValue, setPwdValue] = useState('');
  const [pwdShow, setPwdShow] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'delivery_partner'));
    const unsub = onSnapshot(q, (snap) => {
      setPartners(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRecord)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    const isDigits = /^\d{1,4}$/.test(s);
    return partners.filter((p) => {
      const status = p.accountStatus ?? 'active';
      const approval = p.approvalStatus ?? 'approved';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (approvalFilter !== 'all' && approval !== approvalFilter) return false;
      if (!s) return true;
      const hay = `${p.name ?? ''} ${p.id} ${p.partnerId ?? ''}`.toLowerCase();
      if (hay.includes(s)) return true;
      // 4-digit search: match last 4 digits of partnerId
      if (isDigits) {
        const pidDigits = (p.partnerId ?? '').replace(/[^0-9]/g, '');
        if (pidDigits.endsWith(s) || pidDigits.includes(s)) return true;
        const phoneDigits = (p.id ?? '').replace(/[^0-9]/g, '');
        if (phoneDigits.includes(s)) return true;
      }
      return false;
    });
  }, [partners, search, globalSearch, statusFilter, approvalFilter]);

  useEffect(() => { setPage(1); }, [search, globalSearch, statusFilter, approvalFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleToggle = async () => {
    if (!confirm) return;
    const isBlocked = confirm.blocked;
    try {
      await updateDoc(doc(db, 'users', confirm.id), { accountStatus: isBlocked ? 'active' : 'blocked', updatedAt: serverTimestamp() });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
        action: isBlocked ? 'partnerUnblocked' : 'partnerBlocked', targetId: confirm.id, targetType: 'partner', metadata: {},
        timestamp: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setToast(isBlocked ? 'Partner unblocked' : 'Partner blocked');
    } catch (e: unknown) { setToast(e instanceof Error ? e.message : 'Action failed'); }
    setConfirm(null);
  };

  const handleAdd = async () => {
    if (!addName.trim() || !addPhone.trim()) { setToast('Name and phone are required'); return; }
    if (!addEmail.trim() || !addEmail.includes('@')) { setToast('Valid email is required for rider login'); return; }
    if (!addPassword.trim() || addPassword.length < 6) { setToast('Password must be at least 6 characters — click Generate or type one'); return; }
    const cleanPhone = addPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) { setToast('Enter valid phone number'); return; }
    const emailLower = addEmail.trim().toLowerCase();
    const pwd = addPassword;
    setAdding(true);
    try {
      // Create Firebase Auth user via secondary app so admin session is NOT signed out
      const secAppName = `sec-${Date.now()}`;
      const secApp = getApps().find((a) => a.name === secAppName) ?? initializeApp(FIREBASE_CONFIG, secAppName);
      const secAuth = getAuth(secApp);
      try {
        await createUserWithEmailAndPassword(secAuth, emailLower, pwd);
      } catch (authErr: unknown) {
        const code = (authErr as { code?: string })?.code ?? '';
        if (code === 'auth/email-already-in-use') {
          setToast('Email already in use — choose a different email');
          setAdding(false);
          try { await deleteApp(secApp); } catch { /* ignore */ }
          return;
        }
        throw authErr;
      }
      try { await deleteApp(secApp); } catch { /* ignore */ }

      await setDoc(doc(db, 'users', cleanPhone), {
        name: addName.trim(), email: emailLower, phone: cleanPhone,
        role: 'delivery_partner', accountStatus: 'active', approvalStatus: 'pending',
        passwordStatus: 'configured',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
        action: 'partnerCreated', targetId: cleanPhone, targetType: 'partner', metadata: { name: addName.trim(), email: emailLower },
        timestamp: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setToast(`Partner ${addName.trim()} created — pending approval`);
      setShowAdd(false); setAddName(''); setAddPhone(''); setAddEmail(''); setAddPassword(''); setAddPasswordShow(false); setAddCopied(false);
    } catch (e: unknown) { setToast(e instanceof Error ? e.message : 'Failed to create partner'); }
    setAdding(false);
  };

  const handleResetPassword = async () => {
    if (!pwdTarget || !pwdValue.trim()) { setToast('Please enter a new password'); return; }
    if (pwdValue.length < 6) { setToast('Password must be at least 6 characters'); return; }
    const email = (pwdTarget.email ?? '').toLowerCase();
    if (!email || !email.includes('@')) { setToast('Rider has no valid email — cannot set password'); return; }
    setPwdLoading(true);
    const newPassword = pwdValue; // capture before clearing
    try {
      // Try to create or update Firebase Auth user
      // We use a secondary approach: createUser or update via Admin SDK would be ideal,
      // but on client we create the Auth user if not exists
      try {
        await createUserWithEmailAndPassword(auth, email, newPassword);
      } catch (authErr: unknown) {
        const code = (authErr as { code?: string })?.code ?? '';
        if (code === 'auth/email-already-in-use') {
          // User exists — we need to update password
          // Client SDK cannot update another user's password directly
          // So we store a flag and the rider will use the new password on next login
          // The actual password update happens via Firebase Admin SDK or by the rider re-authenticating
          // For now, we mark password as configured and log the reset
          // The admin should use Firebase Console or Admin SDK for existing users
          setToast('Account already exists. Use Firebase Console → Authentication → Reset password for existing riders, or the rider can use the new password if re-created.');
          setPwdLoading(false);
          return;
        } else {
          throw authErr;
        }
      }

      // Mark password as configured in Firestore (never store the password itself)
      await updateDoc(doc(db, 'users', pwdTarget.id), {
        passwordStatus: 'configured',
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'admin_audit_logs'), {
        adminPhone: user?.uid ?? 'admin', adminName: adminName || 'Admin',
        action: 'riderPasswordReset', targetId: pwdTarget.id, targetType: 'partner',
        metadata: { partnerId: (pwdTarget as unknown as Record<string, unknown>).partnerId ?? '' },
        timestamp: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setToast('Password set successfully');
      // Clear password from UI immediately — never retain
      setPwdValue('');
      setPwdShow(false);
      setPwdTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to set password';
      setToast(msg);
    }
    setPwdLoading(false);
    // Ensure password is cleared even on error
    setPwdValue('');
  };

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  return (
    <div className="page">
      <div className="filters-bar">
        <div className="filters-row">
          <div className="search-wrap">
            <span>🔍</span>
            <input placeholder="Search by 4-digit ID, name, phone..." value={globalSearch ? globalSearch : search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Partner</button>
        </div>
        <div className="filters-row">
          <span className="filter-label">Status:</span>
          {['all', 'active', 'blocked'].map((v) => (
            <button key={v} className={`chip ${statusFilter === v ? 'chip-active' : ''}`} onClick={() => setStatusFilter(v)}>{v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
          <span className="filter-label">Approval:</span>
          {['all', 'pending', 'approved', 'rejected'].map((v) => (
            <button key={v} className={`chip ${approvalFilter === v ? 'chip-active' : ''}`} onClick={() => setApprovalFilter(v)}>{v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      {partners.length === 0 ? <EmptyState icon="🛵" title="No delivery partners yet" subtitle="Add a partner or wait for sign-ups." /> :
        filtered.length === 0 ? <EmptyState icon="🔍" title="No matching partners" subtitle="Try adjusting search or filters." /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Partner</th><th>Partner ID</th><th>Phone</th><th>Approval</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {paged.map((p) => {
                  const blocked = p.accountStatus === 'blocked';
                  const pending = p.approvalStatus === 'pending';
                  return (
                    <tr key={p.id}>
                      <td><div className="cell-main">{p.name || '—'}</div><div className="cell-sub">{p.email || ''}</div></td>
                      <td><span className="partner-id">{(p.partnerId || '—').replace(/^FM-/, '')}</span></td>
                      <td>{p.id}</td>
                      <td><span className={`badge ${p.approvalStatus === 'pending' ? 'badge-pending' : p.approvalStatus === 'approved' ? 'badge-active' : 'badge-blocked'}`}>{(p.approvalStatus ?? 'approved').toUpperCase()}</span></td>
                      <td><span className={`badge ${blocked ? 'badge-blocked' : 'badge-active'}`}>{blocked ? 'BLOCKED' : 'ACTIVE'}</span></td>
                      <td>{pending ? <span className="muted">—</span> : <button className={`btn btn-sm ${blocked ? 'btn-success' : 'btn-danger'}`} onClick={() => setConfirm({ id: p.id, blocked })}>{blocked ? 'Unblock' : 'Block'}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      <ConfirmDialog open={!!confirm} title={confirm?.blocked ? 'Unblock partner?' : 'Block partner?'} message={confirm?.blocked ? 'Partner will be able to receive new orders again.' : 'Partner will NOT receive new orders and cannot accept orders. Existing history remains.'} confirmLabel={confirm?.blocked ? 'Unblock' : 'Block'} confirmColor={confirm?.blocked ? '#059669' : '#DC2626'} onConfirm={handleToggle} onCancel={() => setConfirm(null)} />

      {showAdd && (() => {
        const initials = (() => {
          const parts = addName.trim().split(/\s+/).filter(Boolean);
          if (parts.length === 0) return '';
          if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
          return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        })();
        const hasName = addName.trim().length >= 2;
        const hasPhone = addPhone.replace(/[^0-9]/g, '').length >= 10;
        const hasEmail = addEmail.includes('@') && addEmail.includes('.');
        const hasPassword = addPassword.length >= 6;
        return (
        <div className="dialog-overlay dialog-overlay--premium" onClick={() => setShowAdd(false)}>
          <div className="dialog dialog--premium" onClick={(e) => e.stopPropagation()}>
            {/* ── Premium Header ───────────────────────────────────────── */}
            <div className="premium-head">
              <div className="premium-head-left">
                <div className="premium-head-icon">🍽️</div>
                <div>
                  <h3>Add Delivery Partner</h3>
                  <p>Create and onboard a new Food Mela delivery partner</p>
                </div>
              </div>
              <button className="premium-close" onClick={() => setShowAdd(false)} aria-label="Close">×</button>
            </div>

            {/* ── Profile Preview ──────────────────────────────────────── */}
            <div className="premium-preview">
              <div className="premium-avatar" aria-hidden>
                <span>{initials || '?'}</span>
              </div>
              <div className="premium-preview-text">
                <strong>{addName.trim() || 'New Partner'}</strong>
                <span>Enter the partner details below</span>
              </div>
              <span className="badge badge-pending premium-pending-badge">PENDING APPROVAL</span>
            </div>

            {/* ── Two-column layout ────────────────────────────────────── */}
            <div className="premium-layout">
              {/* LEFT — Form */}
              <div className="premium-form">
                {/* Personal Information */}
                <div className="premium-section">
                  <div className="premium-section-head">
                    <span className="premium-section-icon">👤</span>
                    <div>
                      <h4>Personal Information</h4>
                      <p>Basic details of the delivery partner</p>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Full Name</label>
                    <div className="premium-input">
                      <span className="premium-input-icon">👤</span>
                      <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Rahul Sharma" autoComplete="name" />
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="premium-section">
                  <div className="premium-section-head">
                    <span className="premium-section-icon">📞</span>
                    <div>
                      <h4>Contact Information</h4>
                      <p>How we will reach the partner</p>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Phone Number</label>
                    <div className="premium-input">
                      <span className="premium-input-icon">📱</span>
                      <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="10-digit number" inputMode="numeric" autoComplete="tel" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Email Address</label>
                    <div className="premium-input">
                      <span className="premium-input-icon">✉️</span>
                      <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="partner@foodmela.com" autoComplete="email" />
                    </div>
                  </div>
                </div>

                {/* Account Setup */}
                <div className="premium-section">
                  <div className="premium-section-head">
                    <span className="premium-section-icon">🔐</span>
                    <div>
                      <h4>Account Setup</h4>
                      <p>Login credentials for the rider app</p>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <div className="premium-input">
                      <span className="premium-input-icon">🔑</span>
                      <input
                        type={addPasswordShow ? 'text' : 'password'}
                        value={addPassword}
                        onChange={(e) => { setAddPassword(e.target.value); setAddCopied(false); }}
                        placeholder="Click Generate or type a password"
                        autoComplete="new-password"
                      />
                      <button type="button" className="premium-show" onClick={() => setAddPasswordShow(!addPasswordShow)}>{addPasswordShow ? 'Hide' : 'Show'}</button>
                    </div>
                    <div className="premium-pwd-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (!addName.trim() || !addPhone.trim()) { setToast('Enter name and phone first to generate password'); return; }
                          const gen = genPasswordFromNamePhone(addName, addPhone);
                          setAddPassword(gen);
                          setAddPasswordShow(true);
                          setAddCopied(false);
                        }}
                      >
                        ✨ Generate Password
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!addPassword}
                        title={addPassword ? 'Copy password to clipboard' : 'Generate or type a password first'}
                        onClick={async () => {
                          if (!addPassword) { setToast('No password to copy'); return; }
                          try {
                            await navigator.clipboard.writeText(addPassword);
                            setAddCopied(true);
                            setTimeout(() => setAddCopied(false), 2000);
                            setToast('Password copied to clipboard');
                          } catch {
                            const ta = document.createElement('textarea');
                            ta.value = addPassword;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            setAddCopied(true);
                            setTimeout(() => setAddCopied(false), 2000);
                            setToast('Password copied to clipboard');
                          }
                        }}
                      >
                        {addCopied ? '✓ Copied!' : '📋 Copy'}
                      </button>
                      <span className="muted" style={{ fontSize: 11 }}>Auto from name + phone — editable</span>
                    </div>
                  </div>

                  <div className="premium-meta-grid">
                    <div className="premium-meta-card">
                      <span>Partner ID</span>
                      <strong>Auto on approval</strong>
                      <small>XXX-XXXX</small>
                    </div>
                    <div className="premium-meta-card">
                      <span>Account Status</span>
                      <strong>Active</strong>
                      <small>Ready to receive orders after approval</small>
                    </div>
                    <div className="premium-meta-card">
                      <span>Approval Status</span>
                      <strong>Pending</strong>
                      <small>Requires admin approval</small>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT — Summary */}
              <div className="premium-summary">
                <h4>Partner Onboarding</h4>
                <ul className="premium-checklist">
                  <li className={hasName ? 'done' : ''}><span className="check">{hasName ? '✓' : '○'}</span> Personal information</li>
                  <li className={hasPhone && hasEmail ? 'done' : ''}><span className="check">{hasPhone && hasEmail ? '✓' : '○'}</span> Contact information</li>
                  <li className={hasPassword ? 'done' : ''}><span className="check">{hasPassword ? '✓' : '○'}</span> Account setup</li>
                  <li className="done"><span className="check">✓</span> Approval</li>
                </ul>
                <div className="premium-summary-foot">
                  <span>Partner will be created as</span>
                  <span className="badge badge-pending">PENDING APPROVAL</span>
                  <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Share the password with the rider after creation. Partner ID is generated on approval.</p>
                </div>
              </div>
            </div>

            {/* ── Submit ───────────────────────────────────────────────── */}
            <div className="premium-submit">
              <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setAddPassword(''); setAddPasswordShow(false); setAddCopied(false); }}>Cancel</button>
              <button className="btn btn-primary premium-submit-btn" onClick={handleAdd} disabled={adding}>
                {adding ? 'Creating…' : '＋ Create Delivery Partner'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// Export for Approvals page
export { uniquePartnerId };
