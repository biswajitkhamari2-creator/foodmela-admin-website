import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

// ── Admin identity comes from env, never hardcoded ─────────────────────────
// VITE_ADMIN_EMAIL: the Firebase Auth email that counts as admin fallback.
// VITE_DEV_ADMIN_BYPASS=true (+ VITE_DEV_ADMIN_PIN): local-only emergency
// login when Firebase Auth isn't configured. NEVER enable in production —
// anyone reading the JS bundle could sign in as admin.
const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) ?? 'admin@foodmela.com';
const DEV_BYPASS_ENABLED = (import.meta.env.VITE_DEV_ADMIN_BYPASS as string | undefined) === 'true';
const DEV_ADMIN_PIN = import.meta.env.VITE_DEV_ADMIN_PIN as string | undefined;

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
    // Dev bypass session only counts when the flag is on — otherwise a stale
    // localStorage value from an old dev build could skip login in prod.
    if (DEV_BYPASS_ENABLED && localStorage.getItem('fm_admin_local') === 'true') {
      setIsAdmin(true);
      setIsLocalAdmin(true);
      setAdminName('Admin');
      setLoading(false);
      return;
    }
    localStorage.removeItem('fm_admin_local');

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setIsAdmin(false);
        setIsLocalAdmin(false);
        setAdminName('');
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', u.uid));
        if (snap.exists() && snap.data()?.role === 'admin') {
          setIsAdmin(true);
          setAdminName(snap.data()?.name || u.email?.split('@')[0] || 'Admin');
        } else if (u.email === ADMIN_EMAIL) {
          setIsAdmin(true);
          setAdminName('Admin');
        } else {
          setIsAdmin(false);
          setAdminName('');
        }
      } catch {
        if (u.email === ADMIN_EMAIL) {
          setIsAdmin(true);
          setAdminName('Admin');
        } else {
          setIsAdmin(false);
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const login = async (email: string, password: string) => {
    // Dev-only emergency bypass — requires VITE_DEV_ADMIN_BYPASS=true in .env.local.
    // Never set that flag in production builds.
    if (DEV_BYPASS_ENABLED && DEV_ADMIN_PIN && email === ADMIN_EMAIL && password === DEV_ADMIN_PIN) {
      localStorage.setItem('fm_admin_local', 'true');
      setIsAdmin(true);
      setIsLocalAdmin(true);
      setAdminName('Admin');
      // Try Firebase in background — don't block UI
      signInWithEmailAndPassword(auth, email, password).catch(() => {});
      return;
    }
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      const isAdminUser = snap.exists() && snap.data()?.role === 'admin';
      const isHardcodedAdmin = cred.user.email === ADMIN_EMAIL;
      if (!isAdminUser && !isHardcodedAdmin) {
        await signOut(auth);
        throw new Error('Access denied — admin privileges required.');
      }
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      const msg = err instanceof Error ? err.message : '';

      const isConfigError =
        code === 'auth/configuration-not-found' ||
        code === 'auth/operation-not-allowed' ||
        msg.includes('configuration-not-found') ||
        msg.includes('operation-not-allowed');

      if (isConfigError) {
        throw new Error('Invalid credentials. Please check your email and PIN.');
      }

      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        throw new Error('Invalid credentials. Please check your email and PIN.');
      }
      throw err;
    }
  };

  const logout = async () => {
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
