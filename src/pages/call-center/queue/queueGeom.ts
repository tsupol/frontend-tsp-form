// Timing and sound of the queue's two fun effects (staff only · nothing is saved).
// Kept out of the component files so fast refresh keeps working.

export interface Fx { kind: 'shout' | 'paid'; id: number; t0: number; key: number; amount?: number }

/** Whole shout: walk out, shout in the ear, walk back (owner 11-11 "ตะโกนนานขึ้นอีกหน่อย"). */
export const SHOUT_MS = 5000;
/** Walking out to the customer (and back again at the end). */
export const WALK_MS = 900;
export const PAID_MS = 2600;

/** Horn beeps all through the shout (WebAudio). No audio = picture only. */
export function honk() {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const n = Math.floor((SHOUT_MS - 2 * WALK_MS) / 420);
    for (let i = 0; i < n; i++) {
      const at = ac.currentTime + WALK_MS / 1000 + i * 0.42;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(560, at);
      o.frequency.exponentialRampToValueAtTime(330, at + 0.28);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(g).connect(ac.destination);
      o.start(at);
      o.stop(at + 0.32);
    }
    window.setTimeout(() => { ac.close().catch(() => {}); }, SHOUT_MS + 300);
  } catch { /* picture only */ }
}
