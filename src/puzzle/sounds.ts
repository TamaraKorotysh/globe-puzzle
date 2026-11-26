/** Tiny synthesized sound effects (Web Audio) — no audio files to download. */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const setMuted = (m: boolean) => { muted = m; };
export const isMuted = () => muted;

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, from: number, to: number, delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  /** Pieces fly off the globe. */
  scatter() {
    noise(0.7, 0.35, 300, 2400);
    tone(180, 0.5, 'sine', 0.15, 0, 60);
  },
  /** A piece is picked up. */
  pick() { tone(520, 0.08, 'triangle', 0.12, 0, 700); },
  /** A piece clicks into its place. */
  snap() {
    tone(880, 0.09, 'square', 0.06);
    tone(1320, 0.18, 'sine', 0.12, 0.04);
    noise(0.05, 0.2, 3000, 1500);
  },
  /** Dropped in the wrong place — floats back. */
  miss() { tone(300, 0.22, 'sine', 0.1, 0, 170); },
  /** The whole continent is assembled. */
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.12, i * 0.12));
    tone(1568, 0.6, 'sine', 0.08, 0.5);
  },
};
