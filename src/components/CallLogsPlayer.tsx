import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { fmtDateTime, tsToDate } from '../utils/helpers';

// ─── Food Mela — Admin call recordings player ───────────────────────────────
// Lists masked VoIP calls for one order with playable recordings.
// Sources (merged, deduped by call id):
//  1. Backend  GET <backend>/api/admin/orders/:orderId/call-logs  (has mp3 URLs)
//  2. Firestore orders/{orderId}/calls live snapshot (signaling states)
// Only role labels are shown — phone numbers stay hidden by design.

// Same-domain backend: foodmela.online/api in production, VITE_BACKEND_URL
// override for local dev, legacy vercel.app URL as last resort.
const BACKEND_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_BACKEND_URL
  ?? (import.meta.env.PROD ? '' : 'https://food-mela-backend.vercel.app');

export interface CallLog {
  id: string;
  orderId: string;
  callerRole: string;
  receiverRole: string;
  status: string;
  duration: number;
  recordingUrl: string | null;
  /** Backend-signed playback path (works with the private GCS bucket). */
  playbackUrl?: string | null;
  createdAt: string | null;
}

function PlayableRecording({ log }: { log: CallLog }) {
  const [src, setSrc] = useState<string | null>(log.recordingUrl);
  const [triedSigned, setTriedSigned] = useState(false);

  // Prefer the backend-signed URL (private bucket); fall back to direct URL.
  useEffect(() => {
    if (!log.playbackUrl || triedSigned) return;
    let cancelled = false;
    fetch(`${BACKEND_BASE}${log.playbackUrl}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { url?: string }) => {
        if (!cancelled && typeof data.url === 'string') {
          setSrc(data.url);
          setTriedSigned(true);
        }
      })
      .catch(() => {
        // Signed URL unavailable (storage keys missing?) — keep direct URL.
        if (!cancelled) setTriedSigned(true);
      });
    return () => {
      cancelled = true;
    };
  }, [log.playbackUrl, triedSigned]);

  if (!src) return null;
  return (
    <audio
      controls
      preload="none"
      src={src}
      className="call-audio"
      onError={() => {
        // Direct GCS URL 403s on the private bucket — try the signed URL.
        if (log.playbackUrl && !triedSigned) setTriedSigned(false);
        else if (src !== log.recordingUrl) setSrc(log.recordingUrl);
      }}
    />
  );
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'ended':
    case 'accepted':
      return '#059669';
    case 'ringing':
      return '#D97706';
    case 'rejected':
    case 'missed':
    case 'failed':
      return '#DC2626';
    default:
      return '#64748B';
  }
}

export default function CallLogsPlayer({ orderId }: { orderId: string }) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    // 1. Backend logs (authoritative — includes recordingUrl mp3s)
    fetch(`${BACKEND_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/call-logs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { logs?: unknown[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.logs) ? data.logs : [];
        setLogs((prev) => mergeLogs(prev, normalizeBackend(list)));
        setBackendOk(true);
      })
      .catch(() => {
        if (!cancelled) setBackendOk(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // 2. Firestore live signaling (instant states while calls happen)
    const q = query(
      collection(db, 'orders', orderId, 'calls'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const live: CallLog[] = snap.docs.map((d) => {
          const v = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            orderId: (v.orderId as string) ?? orderId,
            callerRole: (v.callerRole as string) ?? 'customer',
            receiverRole: (v.receiverRole as string) ?? 'rider',
            status: (v.status as string) ?? 'ringing',
            duration: 0,
            recordingUrl: null,
            createdAt:
              typeof v.createdAt === 'number'
                ? new Date(v.createdAt).toISOString()
                : null,
          };
        });
        setLogs((prev) => mergeLogs(prev, live));
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="detail-card">
        <h3>📞 Call Recordings</h3>
        <div className="skeleton" style={{ height: 80 }} />
      </div>
    );
  }

  return (
    <div className="detail-card">
      <h3>📞 Call Recordings {logs.length > 0 && <span className="muted">({logs.length})</span>}</h3>
      {!backendOk && (
        <div className="info-banner" style={{ marginBottom: 12 }}>
          Backend call-log API unreachable — showing live signaling only. Recordings appear once the backend is deployed.
        </div>
      )}
      {logs.length === 0 ? (
        <p className="muted">No calls on this order yet. Customer ↔ rider VoIP calls will appear here with playable recordings.</p>
      ) : (
        <div className="call-log-list">
          {logs.map((log) => (
            <div key={log.id} className="call-log-row">
              <div className="call-log-head">
                <strong>
                  {roleLabel(log.callerRole)} → {roleLabel(log.receiverRole)}
                </strong>
                <span
                  className="call-status-pill"
                  style={{
                    background: `${statusColor(log.status)}1A`,
                    color: statusColor(log.status),
                  }}
                >
                  {log.status.toUpperCase()} • {fmtDuration(log.duration)}
                </span>
              </div>
              <div className="call-log-time">
                {log.createdAt ? fmtDateTime(new Date(log.createdAt)) : '—'}
              </div>
              {log.recordingUrl ? (
                <PlayableRecording log={log} />
              ) : (
                <p className="call-no-recording">
                  {log.status === 'ringing'
                    ? '🔔 Ringing…'
                    : '⚠️ No recording yet — capture starts when the call connects.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roleLabel(role: string): string {
  return role === 'rider' ? 'Assigned Rider' : 'Customer';
}

function normalizeBackend(list: unknown[]): CallLog[] {
  return list.map((item) => {
    const v = item as Record<string, unknown>;
    const id = String(v.id ?? v._id ?? Math.random());
    return {
      id,
      orderId: String(v.orderId ?? ''),
      callerRole: String(v.callerRole ?? 'customer'),
      receiverRole: String(v.receiverRole ?? 'rider'),
      status: String(v.status ?? 'ringing'),
      duration: Number(v.duration ?? 0),
      recordingUrl: (v.recordingUrl as string) ?? null,
      playbackUrl: (v.playbackUrl as string) ?? null,
      createdAt:
        typeof v.createdAt === 'string'
          ? v.createdAt
          : tsToDate(v.createdAt)?.toISOString() ?? null,
    };
  });
}

// Backend entries win on recordingUrl/duration; Firestore wins on fresh status.
function mergeLogs(a: CallLog[], b: CallLog[]): CallLog[] {
  const map = new Map<string, CallLog>();
  for (const log of [...a, ...b]) {
    const prev = map.get(log.id);
    if (!prev) {
      map.set(log.id, log);
    } else {
      map.set(log.id, {
        ...prev,
        ...log,
        recordingUrl: log.recordingUrl ?? prev.recordingUrl,
        duration: log.duration || prev.duration,
        status: pickStatus(prev.status, log.status),
      });
    }
  }
  return [...map.values()].sort((x, y) =>
    (y.createdAt ?? '').localeCompare(x.createdAt ?? ''),
  );
}

const RANK: Record<string, number> = {
  ringing: 0,
  accepted: 1,
  rejected: 2,
  missed: 2,
  failed: 2,
  ended: 3,
};

function pickStatus(s1: string, s2: string): string {
  return (RANK[s2] ?? 0) >= (RANK[s1] ?? 0) ? s2 : s1;
}
