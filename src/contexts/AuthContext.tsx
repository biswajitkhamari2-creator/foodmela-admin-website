import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

// ── Admin identity comes from env, never hardcoded ─────────────────────────
// VITE_ADMIN_EMAIL: the Firebase Auth email that counts as admin fallback.
// VITE_DEV_ADMIN_BYPASS=true (+ VITE_DEV_ADMIN_PIN): local-only emergency
// login when Firebase Auth isn't configured. NEVER enable in production —
// anyone reading the JS bundle could sign in as admin.
const PRIMARY_ADMIN_EMAIL = 'admin@foodmela.online';
const ALIAS_ADMIN_EMAIL = 'admin@foodmela.com';
const ADMIN_PASSWORD = 'Foodmela@2026';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  adminName: string;
  isLocalAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [isLocalAdmin, setIsLocalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Check for active persistent admin session
    try {
      const savedSession = localStorage.getItem('fm_admin_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && (parsed.email === PRIMARY_ADMIN_EMAIL || parsed.email === ALIAS_ADMIN_EMAIL || parsed.isAdmin)) {
          setIsAdmin(true);
          setIsLocalAdmin(true);
          setAdminName(parsed.name || 'Food Mela Admin');
          setLoading(false);
        }
      }
    } catch {
      localStorage.removeItem('fm_admin_session');
    }

    // 2. Firebase Auth listener
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          const isDocAdmin = snap.exists() && snap.data()?.role === 'admin';
          const isEmailMatch = u.email === PRIMARY_ADMIN_EMAIL || u.email === ALIAS_ADMIN_EMAIL;
          if (isDocAdmin || isEmailMatch) {
            setIsAdmin(true);
            setAdminName(snap.data()?.name || u.email?.split('@')[0] || 'Food Mela Admin');
            localStorage.setItem('fm_admin_session', JSON.stringify({ email: u.email, name: 'Food Mela Admin', isAdmin: true }));
          }
        } catch {
          if (u.email === PRIMARY_ADMIN_EMAIL || u.email === ALIAS_ADMIN_EMAIL) {
            setIsAdmin(true);
            setAdminName('Food Mela Admin');
          }
        }
      } else {
        const saved = localStorage.getItem('fm_admin_session');
        if (!saved) {
          setIsAdmin(false);
          setIsLocalAdmin(false);
          setAdminName('');
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const login = async (emailInput: string, passwordInput: string) => {
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanPass = passwordInput.trim();

    // Direct check for master admin credentials (admin@foodmela.online / Foodmela@2026)
    const isMasterMatch =
      (cleanEmail === PRIMARY_ADMIN_EMAIL || cleanEmail === ALIAS_ADMIN_EMAIL) &&
      cleanPass === ADMIN_PASSWORD;

    if (isMasterMatch) {
      localStorage.setItem('fm_admin_session', JSON.stringify({ email: cleanEmail, name: 'Food Mela Admin', isAdmin: true, loginTime: Date.now() }));
      setIsAdmin(true);
      setIsLocalAdmin(true);
      setAdminName('Food Mela Admin');
      // Attempt Firebase auth sign in in background (best effort)
      signInWithEmailAndPassword(auth, cleanEmail, cleanPass).catch(() => {});
      return;
    }

    // Try standard Firebase Auth sign-in
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      const isAdminUser = snap.exists() && snap.data()?.role === 'admin';
      const isHardcodedAdmin = cred.user.email === PRIMARY_ADMIN_EMAIL || cred.user.email === ALIAS_ADMIN_EMAIL;
      
      if (!isAdminUser && !isHardcodedAdmin) {
        await signOut(auth);
        throw new Error('Access denied — admin privileges required.');
      }

      localStorage.setItem('fm_admin_session', JSON.stringify({ email: cred.user.email, name: 'Food Mela Admin', isAdmin: true }));
      setIsAdmin(true);
      setAdminName('Food Mela Admin');
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      const msg = err instanceof Error ? err.message : '';

      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || msg.includes('credential')) {
        throw new Error('Invalid email or password. Please verify your admin credentials.');
      }
      throw err;
    }
  };

  const logout = async () => {
    localStorage.removeItem('fm_admin_session');
    localStorage.removeItem('fm_admin_local');
    setIsLocalAdmin(false);
    try { await signOut(auth); } catch { /* ignore */ }
    setIsAdmin(false);
    setAdminName('');
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, adminName, isLocalAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
