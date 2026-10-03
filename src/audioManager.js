/**
 * audioManager.js — BMW M4 Experience
 *
 * Responsibilities:
 *  - Initialize Web Audio API strictly after user gesture
 *  - Load and decode audio buffers
 *  - Smooth volume ramps (no zipper noise)
 *  - playbackRate modulation for launch section
 *  - Mute/unmute master gain
 *  - Chapter-transition-aware: only stop/start on chapter change, not every scroll tick
 */

export class AudioManager {
  constructor() {
    this.ctx        = null;
    this.master     = null;         // master gain node
    this.tracks     = {};           // { id: { buffer, source, gain, playing } }
    this.muted      = false;
    this.enabled    = false;

    // Track the last chapter to avoid redundant stop/start calls
    this._activeChapter = null;
  }

  /* ---- Init (must be called inside a user gesture handler) ---- */
  async init(withSound) {
    this.enabled = withSound;
    if (!withSound) return;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx  = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(1, this.ctx.currentTime);
      this.master.connect(this.ctx.destination);

      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (e) {
      console.warn('[Audio] Init failed:', e);
      this.enabled = false;
    }
  }

  /* ---- Load ---- */
  async loadTrack(id, url) {
    if (!this.enabled || !this.ctx) return;
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(buf);
      this.tracks[id] = { buffer: decoded, source: null, gain: null, playing: false };
    } catch (e) {
      console.warn(`[Audio] Failed to load "${id}" from ${url}:`, e);
    }
  }

  /* ---- Playback ---- */
  /**
   * Start a track if not already playing.
   * If already playing, smoothly ramp to the target volume.
   */
  play(id, { loop = true, volume = 0.8 } = {}) {
    if (!this.enabled || !this.ctx || !this.tracks[id]) return;
    const t = this.tracks[id];

    if (t.playing) {
      // Just update volume — don't restart
      this._rampGain(t.gain, volume);
      return;
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.muted ? 0 : 0.0001, this.ctx.currentTime); // fade in from silence
    gain.connect(this.master);

    const src = this.ctx.createBufferSource();
    src.buffer    = t.buffer;
    src.loop      = loop;
    src.connect(gain);
    src.start(0);
    src.onended   = () => { t.playing = false; };

    // Fade in
    this._rampGain(gain, volume, 0.4);

    t.source  = src;
    t.gain    = gain;
    t.playing = true;
  }

  /**
   * Stop a track with a fade-out. Disconnects nodes to prevent AudioContext graph leaks.
   */
  stop(id, fadeTime = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const t = this.tracks[id];
    if (!t || !t.playing) return;

    // Mark not playing immediately so no new ramps are applied during fade
    t.playing = false;

    const gain = t.gain;
    const src  = t.source;
    // Null out track references so future setVolume calls skip this track
    t.gain   = null;
    t.source = null;

    if (gain && fadeTime > 0) {
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeTime);
      setTimeout(() => {
        try { src.stop(); } catch {}
        try { src.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
      }, (fadeTime * 1000) + 60);
    } else {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    }
  }

  /** Ramp track volume to target — only if track is currently playing */
  setVolume(id, volume, rampTime = 0.1) {
    if (!this.enabled || !this.ctx) return;
    const t = this.tracks[id];
    if (!t || !t.playing || !t.gain) return;   // ← guard: skip stopped tracks
    this._rampGain(t.gain, volume, rampTime);
  }

  /** Set playbackRate (clamped 0.2–3) */
  setRate(id, rate) {
    if (!this.enabled || !this.ctx) return;
    const t = this.tracks[id];
    if (!t || !t.playing || !t.source) return;
    try {
      t.source.playbackRate.setTargetAtTime(
        Math.max(0.2, Math.min(3.0, rate)),
        this.ctx.currentTime,
        0.05
      );
    } catch {}
  }

  isPlaying(id) { return this.tracks[id]?.playing ?? false; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 1, now + 0.15);
    }
    return this.muted;
  }

  /* ---- Internal ---- */
  _rampGain(gainNode, target, time = 0.12) {
    if (!gainNode || !this.ctx) return;
    const clamped = this.muted ? 0 : Math.max(0, Math.min(1.5, target));
    const now = this.ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(clamped, now + time);
  }
}
