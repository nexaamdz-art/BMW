/**
 * audioManager.js
 * Web Audio API manager for BMW M4 cinematic audio experience.
 * Initialized strictly after user gesture to comply with autoplay policy.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.tracks = {}; // { id: { buffer, gainNode, sourceNode, isPlaying, loop } }
    this.masterGain = null;
    this.muted = false;
    this.enabled = false;
  }

  async init(withSound) {
    this.enabled = withSound;
    if (!withSound) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch (e) {
      console.warn('Web Audio initialization failed:', e);
      this.enabled = false;
    }
  }

  async loadTrack(id, url) {
    if (!this.enabled || !this.ctx) return;
    try {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.tracks[id] = {
        buffer: audioBuffer,
        gainNode: null,
        sourceNode: null,
        isPlaying: false,
      };
    } catch (e) {
      console.warn(`Failed to load audio track [${id}] from ${url}:`, e);
    }
  }

  playTrack(id, { loop = true, volume = 1.0 } = {}) {
    if (!this.enabled || !this.ctx || !this.tracks[id]) return;
    const track = this.tracks[id];

    if (track.isPlaying) {
      // Just adjust volume smoothly if already playing
      this.setVolume(id, volume);
      return;
    }

    try {
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(this.muted ? 0 : Math.max(0, volume), this.ctx.currentTime);
      gainNode.connect(this.masterGain);

      const sourceNode = this.ctx.createBufferSource();
      sourceNode.buffer = track.buffer;
      sourceNode.loop = loop;
      sourceNode.connect(gainNode);
      sourceNode.start(0);

      sourceNode.onended = () => {
        track.isPlaying = false;
      };

      track.gainNode = gainNode;
      track.sourceNode = sourceNode;
      track.isPlaying = true;
    } catch (e) {
      console.warn(`Error playing track [${id}]:`, e);
    }
  }

  stopTrack(id, fadeDuration = 0.3) {
    const track = this.tracks[id];
    if (!track || !track.isPlaying) return;

    if (fadeDuration > 0 && track.gainNode && this.ctx) {
      const now = this.ctx.currentTime;
      track.gainNode.gain.cancelScheduledValues(now);
      track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
      track.gainNode.gain.linearRampToValueAtTime(0, now + fadeDuration);

      setTimeout(() => {
        try {
          if (track.sourceNode) {
            track.sourceNode.stop();
            track.sourceNode.disconnect();
          }
        } catch {}
        track.isPlaying = false;
      }, fadeDuration * 1000 + 50);
    } else {
      try {
        if (track.sourceNode) {
          track.sourceNode.stop();
          track.sourceNode.disconnect();
        }
      } catch {}
      track.isPlaying = false;
    }
  }

  setVolume(id, volume, rampTime = 0.08) {
    const track = this.tracks[id];
    if (!track || !track.gainNode || !this.ctx) return;

    const target = this.muted ? 0 : Math.max(0, Math.min(1.5, volume));
    const now = this.ctx.currentTime;
    track.gainNode.gain.cancelScheduledValues(now);
    track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
    track.gainNode.gain.linearRampToValueAtTime(target, now + rampTime);
  }

  setPlaybackRate(id, rate) {
    const track = this.tracks[id];
    if (!track || !track.sourceNode || !this.ctx) return;
    try {
      track.sourceNode.playbackRate.setValueAtTime(
        Math.max(0.2, Math.min(3.0, rate)),
        this.ctx.currentTime
      );
    } catch {}
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(this.muted ? 0 : 1.0, now + 0.15);
    }
    return this.muted;
  }
}
