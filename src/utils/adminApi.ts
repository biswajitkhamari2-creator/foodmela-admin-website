// ─── Admin backend API helper (SECURITY 2026-09-18) ─────────────────────────
// Admin-only endpoints (/api/admin/*, clear-delivered) require the admin
// apiToken minted via POST /api/auth/admin/token with the admin's Firebase
// ID token. The token is cached in sessionStorage for the tab session.
import { auth } from '../firebase';

const BACKEND_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_BACKEND_URL
  ?? (import.meta.env.PROD ? '' : 'https://food-mela-backend.vercel.app');

let _cached: string | null = null;

async function mintAdminToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const idToken = await user.getIdToken();
    const res = await fetch(`${BACKEND_BASE}/api/auth/admin/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { apiToken?: string };
    if (data.apiToken) {
      _cached = data.apiToken;
      try { sessionStorage.setItem('fm_admin_api_token', data.apiToken); } catch { /* ignore */ }
      return data.apiToken;
    }
  } catch { /* ignore */ }
  return null;
}

export function getAdminToken(): string | null {
  if (_cached) return _cached;
  try {
    _cached = sessionStorage.getItem('fm_admin_api_token');
  } catch { /* ignore */ }
  return _cached;
}

/** Fetch with the admin apiToken attached; mints on first use. */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  let token = getAdminToken();
  if (!token) token = await mintAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res = await fetch(`${BACKEND_BASE}${path}`, { ...init, headers });
  if (res.status === 401 || res.status === 403) {
    // Token stale — mint fresh once and retry.
    _cached = null;
    try { sessionStorage.removeItem('fm_admin_api_token'); } catch { /* ignore */ }
    token = await mintAdminToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(`${BACKEND_BASE}${path}`, { ...init, headers });
    }
  }
  return res;
}

export function clearAdminToken() {
  _cached = null;
  try { sessionStorage.removeItem('fm_admin_api_token'); } catch { /* ignore */ }
}

export { BACKEND_BASE };
