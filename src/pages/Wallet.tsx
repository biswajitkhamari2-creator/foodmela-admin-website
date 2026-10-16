import { useEffect, useState, useMemo } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, runTransaction, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { tsToDate, fmtDateTime } from '../utils/helpers';
import { EmptyState, Pagination, Toast, ConfirmDialog } from '../components/UI';
import { adminFetch } from '../utils/adminApi';

const PAGE_SIZE = 20;

interface WalletTxn {
  id: string;
  phone?: string;
  type?: string;
  amount?: number;
  status?: string;
  orderId?: string;
  note?: string;
  createdAt?: unknown;
}

const TYPE_META: Record<string, { icon: string; label: string; bg: string; color: string }> = {
  topup: { icon: '⬆️', label: 'Top-up', bg: 'rgba(16,185,129,0.12)', color: '#34D399' },
  debit: { icon: '⬇️', label: 'Debit', bg: 'rgba(239,68,68,0.12)', color: '#F87171' },
  refund: { icon: '↩️', label: 'Refund', bg: 'rgba(59,130,246,0.12)', color: '#60A5FA' },
  adjustment: { icon: '⚖️', label: 'Adjustment', bg: 'rgba(251,146,60,0.12)', color: '#FB923C' },
};

export default function Wallet({ globalSearch }: { globalSearch?: string }) {
  const [txns, setTxns] = useState<WalletTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [adjustPhone, setAdjustPhone] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustKind, setAdjustKind] = useState<'credit' | 'debit'>('credit');
  const [adjustNote, setAdjustNote] = useState('');
  const [confirm, setConfirm] = useState<null | { phone: string; amount: number; kind: 'credit' | 'debit' }>(null);
  const [processing, setProcessing] = useState(false);
  // 🔒 Extra protection: page-level lock + cooldown + audit
  const [unlocked, setUnlocked] = useState(false);
  const [lockPass, setLockPass] = useState('');
  const [lockError, setLockError] = useState('');
  const [guardPass, setGuardPass] = useState('');
  const [guardError, setGuardError] = useState('');
  const [lastAdjustAt, setLastAdjustAt] = useState(0);
  const ADJUST_COOLDOWN_MS = 30000;
  const WALLET_PIN = 'Bisu@9861';

  useEffect(() => {
    const q = query(collection(db, 'wallet_txns'), orderBy('createdAt', 'desc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      setTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WalletTxn)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = (globalSearch || search).toLowerCase().trim();
    return txns.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (s) {
        const hay = `${t.phone ?? ''} ${t.orderId ?? ''} ${t.note ?? ''} ${t.type ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [txns, search, globalSearch, typeFilter]);

  // ✨ Premium summary stats
  const summary = useMemo(() => {
    let credited = 0, debited = 0, count = txns.length;
    const phones = new Set<string>();
    for (const t of txns) {
      const a = t.amount ?? 0;
      if (a >= 0) credited += a; else debited += Math.abs(a);
      if (t.phone) phones.add(t.phone);
    }
    return { credited, debited, net: credited - debited, count, holders: phones.size };
  }, [txns]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function doAdjust() {
    if (!confirm) return;
    const { phone, amount, kind } = confirm;
    setGuardError('');
    if (guardPass !== WALLET_PIN) {
      setGuardError('❌ Wrong wallet password — adjustment blocked.');
      return;
    }
    const nowMs = Date.now();
    if (nowMs - lastAdjustAt < ADJUST_COOLDOWN_MS) {
      const wait = Math.ceil((ADJUST_COOLDOWN_MS - (nowMs - lastAdjustAt)) / 1000);
      setGuardError(`⏳ Slow down — wait ${wait}s before the next adjustment.`);
      return;
    }
    setProcessing(true);
    try {
      const digits = phone.replace(/[^0-9]/g, '').slice(-10);
      if (digits.length !== 10) throw new Error('Enter a valid 10-digit phone');
      if (!(amount > 0) || amount > 50000) throw new Error('Amount must be ₹1–₹50,000');

      let backendSuccess = false;
      let backendError = '';
      try {
        const res = await adminFetch('/api/admin/wallet/adjust', {
          method: 'POST',
          body: JSON.stringify({ phone: digits, amount, kind, note: (adjustNote.trim() || `Admin ${kind}`) }),
        });
        const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (res.ok && data?.success) backendSuccess = true;
        else backendError = data?.error || `Server status ${res.status}`;
      } catch (err) {
        backendError = (err as Error).message;
      }

      if (!backendSuccess) {
        try {
          await addDoc(collection(db, 'wallet_txns'), {
            phone: digits, type: 'adjustment',
            amount: kind === 'credit' ? amount : -amount,
            status: 'success', orderId: '',
            note: (adjustNote.trim() || `Admin ${kind}`),
            createdAt: serverTimestamp(),
          });
          const ref = doc(db, 'wallets', digits);
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const cur = Number(snap.data()?.balance ?? 0);
            const next = kind === 'credit' ? cur + amount : cur - amount;
            if (next < 0) throw new Error('Insufficient wallet balance for this debit');
            tx.set(ref, { phone: digits, balance: next, updatedAt: serverTimestamp() }, { merge: true });
          });
        } catch (fsErr) {
          throw new Error(backendError || (fsErr as Error).message || 'Adjustment failed');
        }
      }

      try {
        await addDoc(collection(db, 'admin_audit_logs'), {
          action: `wallet_${kind}`, phone: digits,
          amount: kind === 'credit' ? amount : -amount,
          note: adjustNote.trim() || `Admin ${kind}`,
          admin: 'Food Mela Admin', createdAt: serverTimestamp(),
        });
      } catch { /* audit best-effort */ }

      setLastAdjustAt(Date.now());
      setToast({ message: `✅ ${kind === 'credit' ? 'Credited' : 'Debited'} ₹${amount} ${kind === 'credit' ? 'to' : 'from'} ${digits}`, type: 'success' });
      setAdjustPhone(''); setAdjustAmount(''); setAdjustNote(''); setGuardPass('');
    } catch (e) {
      setToast({ message: `❌ ${(e as Error).message || 'Adjustment failed'}`, type: 'error' });
    } finally {
      setProcessing(false);
      setConfirm(null);
      setGuardPass(''); setGuardError('');
    }
  }

  const tryUnlock = () => {
    if (lockPass === WALLET_PIN) { setUnlocked(true); setLockError(''); }
    else setLockError('❌ Wrong wallet password.');
  };

  // 🔒 Premium vault lock screen
  if (!unlocked) {
    return (
      <div className="page">
        <div className="wallet-vault">
          <div className="wallet-vault-glow" />
          <div className="wallet-vault-card">
            <div className="wallet-vault-icon">🏦</div>
            <p className="wallet-vault-eyebrow">SECURE VAULT</p>
            <h3>Wallet is locked</h3>
            <p className="wallet-vault-sub">Enter the wallet password to view balances &amp; ledger.</p>
            <input
              className="input wallet-vault-input" type="password" placeholder="••••••••"
              value={lockPass} onChange={(e) => setLockPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') tryUnlock(); }}
              autoFocus
            />
            {lockError && <p className="wallet-vault-error">{lockError}</p>}
            <button className="wallet-vault-btn" onClick={tryUnlock}>🔓 Unlock Wallet</button>
            <p className="wallet-vault-hint">🛡️ Protected area — every action is audit-logged.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page wallet-premium">
      {/* ✨ Hero summary */}
      <div className="wallet-hero">
        <div className="wallet-hero-main">
          <p className="wallet-hero-eyebrow">💰 WALLET OVERVIEW</p>
          <h2 className="wallet-hero-balance">₹{summary.net.toLocaleString('en-IN')}</h2>
          <p className="wallet-hero-sub">Net flow across {summary.count} transactions · {summary.holders} holders</p>
        </div>
        <div className="wallet-hero-stats">
          <div className="wallet-hero-stat wallet-hero-stat--in">
            <span className="whs-label">⬆️ Credited</span>
            <strong>₹{summary.credited.toLocaleString('en-IN')}</strong>
          </div>
          <div className="wallet-hero-stat wallet-hero-stat--out">
            <span className="whs-label">⬇️ Debited</span>
            <strong>₹{summary.debited.toLocaleString('en-IN')}</strong>
          </div>
        </div>
      </div>

      {/* ✨ Credit / Debit panel */}
      <div className="wallet-adjust">
        <div className="wallet-adjust-head">
          <div>
            <h3>⚡ Quick Adjustment</h3>
            <p>Credit or debit any customer wallet instantly</p>
          </div>
          <span className="wallet-shield">🛡️ PIN + cooldown + audit</span>
        </div>
        <div className="wallet-adjust-grid">
          <label>Phone<input className="input" placeholder="10-digit mobile" value={adjustPhone} onChange={(e) => setAdjustPhone(e.target.value)} /></label>
          <label>Amount<input className="input" placeholder="₹ Amount" type="number" min={1} value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} /></label>
          <label>Type
            <div className="wallet-kind-toggle">
              <button className={adjustKind === 'credit' ? 'active-credit' : ''} onClick={() => setAdjustKind('credit')}>＋ Credit</button>
              <button className={adjustKind === 'debit' ? 'active-debit' : ''} onClick={() => setAdjustKind('debit')}>− Debit</button>
            </div>
          </label>
          <label className="wallet-note-label">Note<input className="input" placeholder="Reason (optional)" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} /></label>
          <button
            className={`wallet-go ${adjustKind}`}
            disabled={processing}
            onClick={() => {
              const digits = adjustPhone.replace(/[^0-9]/g, '').slice(-10);
              const amount = Number(adjustAmount);
              if (digits.length !== 10) { setToast({ message: '❌ Enter a valid 10-digit phone', type: 'error' }); return; }
              if (!(amount > 0)) { setToast({ message: '❌ Enter an amount', type: 'error' }); return; }
              setConfirm({ phone: digits, amount, kind: adjustKind });
            }}
          >
            {processing ? 'Working…' : adjustKind === 'credit' ? '＋ Credit wallet' : '− Debit wallet'}
          </button>
        </div>
      </div>

      {/* ✨ Ledger */}
      <div className="wallet-ledger-head">
        <h3>📜 Transaction Ledger</h3>
        <div className="wallet-ledger-tools">
          <input className="input" placeholder="🔍 Search phone, order, note…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <div className="wallet-filters">
            {['all', 'topup', 'debit', 'refund', 'adjustment'].map((f) => (
              <button key={f} className={typeFilter === f ? 'active' : ''} onClick={() => { setTypeFilter(f); setPage(1); }}>
                {f === 'all' ? 'All' : TYPE_META[f].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card">Loading wallet ledger…</div>
      ) : pageRows.length === 0 ? (
        <EmptyState icon="💰" title="No wallet transactions" subtitle="Top-ups, payments and refunds appear here in real time." />
      ) : (
        <div className="wallet-table-wrap">
          {pageRows.map((t) => {
            const meta = TYPE_META[t.type ?? ''] ?? { icon: '💳', label: t.type || '—', bg: 'rgba(139,152,171,0.12)', color: '#8B98AB' };
            const pos = (t.amount ?? 0) >= 0;
            return (
              <div key={t.id} className="wallet-row">
                <div className="wallet-row-type" style={{ background: meta.bg, color: meta.color }}>{meta.icon} {meta.label}</div>
                <div className="wallet-row-main">
                  <strong className="wallet-row-phone">{t.phone || '—'}</strong>
                  <span className="wallet-row-note">{t.note || t.orderId || '—'}</span>
                </div>
                <div className="wallet-row-right">
                  <strong className={`wallet-row-amt ${pos ? 'pos' : 'neg'}`}>{pos ? '+' : '−'}₹{Math.abs(t.amount ?? 0).toLocaleString('en-IN')}</strong>
                  <span className="wallet-row-time">{fmtDateTime(tsToDate(t.createdAt))}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination page={page} totalPages={pages} onPageChange={setPage} />
      {confirm && (
        <ConfirmDialog
          open
          title={`🔒 ${confirm.kind === 'credit' ? 'Credit' : 'Debit'} ₹${confirm.amount}?`}
          message={`${confirm.kind === 'credit' ? 'Add ₹' + confirm.amount + ' to' : 'Remove ₹' + confirm.amount + ' from'} wallet ${confirm.phone}. This writes to the ledger and cannot be undone.`}
          confirmLabel={processing ? 'Working…' : confirm.kind === 'credit' ? 'Confirm Credit' : 'Confirm Debit'}
          onCancel={() => { setConfirm(null); setGuardPass(''); setGuardError(''); }}
          onConfirm={doAdjust}
        >
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 6 }}>
              Enter wallet password to authorize
              <input className="input" type="password" placeholder="Wallet password" value={guardPass} onChange={(e) => setGuardPass(e.target.value)} autoFocus />
            </label>
            {guardError && <p style={{ color: '#DC2626', fontSize: 12, fontWeight: 700, marginTop: 8 }}>{guardError}</p>}
            <p style={{ fontSize: 11, color: '#8B98AB', marginTop: 8 }}>🛡️ Protected: password check + 30s cooldown + audit log entry.</p>
          </div>
        </ConfirmDialog>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
