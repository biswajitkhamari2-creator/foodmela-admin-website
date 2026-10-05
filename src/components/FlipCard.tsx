import { useState } from 'react';

/// ─── FLIP CARD ─────────────────────────────────────────────────────────────
/// Tap to flip (3D rotateY): front = summary, back = full details.
/// Tap again (or ✕) to flip back / close. Neon glow, no dependency.
export default function FlipCard({
  front,
  back,
  onClose,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  onClose: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: '92%' }}>
        <div
          className={`flip-scene ${flipped ? 'flipped' : ''}`}
          onClick={() => setFlipped(!flipped)}
          title={flipped ? 'Tap to flip back' : 'Tap to see details'}
        >
          <div className="flip-inner">
            <div className="flip-face flip-front">{front}</div>
            <div className="flip-face flip-back">{back}</div>
          </div>
        </div>
        <p className="flip-hint">{flipped ? '👆 Tap card to flip back' : '👆 Tap card for full details'}</p>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
