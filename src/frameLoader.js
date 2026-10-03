/**
 * frameLoader.js — BMW M4 Experience
 *
 * Responsibilities:
 *  - Detect real frame counts via binary-search HEAD probes (cached in localStorage)
 *  - High-performance ImageBitmap decoding on background threads
 *  - Smart strided preloading: keyframes first so every sequence has full timeline
 *    coverage within seconds, eliminating frame freeze/jerk
 *  - Strict sequence isolation: nearest-neighbour fallback stays within the same sequence
 *  - Anchor frames (start & end of every scene) preloaded immediately to guarantee
 *    flawless, glitch-free transitions
 */

const FRAME_BASE   = '/frames';
const FRAME_BASE_M = '/frames_m';

/** Zero-pad frame number to 4 digits */
export function pad4(n) {
  return String(n).padStart(4, '0');
}

/** URL for a given sequence + frame number */
export function frameUrl(seq, frame, mobile = false) {
  const base = mobile ? FRAME_BASE_M : FRAME_BASE;
  return `${base}/s${seq}/f_${pad4(frame)}.webp`;
}

/* ─────────────────────────────────────────────
   AUTO-DETECTION OF REAL FRAME COUNTS
───────────────────────────────────────────── */
export async function detectRealFrameCounts(mobile = false) {
  const CACHE_KEY = `bmw_m4_fc_${mobile ? 'm' : 'd'}_v4`;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && [1,2,3,4,5,6,7].every(s => parsed[s] > 0)) return parsed;
    }
  } catch { /* storage unavailable */ }

  const defaults = { 1: 192, 2: 192, 3: 192, 4: 240, 5: 240, 6: 240, 7: 192 };
  const counts   = { ...defaults };

  const checkExists = async (seq, frame) => {
    try {
      const r = await fetch(frameUrl(seq, frame, mobile), { method: 'HEAD' });
      return r.ok;
    } catch { return false; }
  };

  await Promise.all(
    [1,2,3,4,5,6,7].map(async seq => {
      let lo = defaults[seq];
      let hi = lo + 60;
      let found = lo;

      while (await checkExists(seq, hi)) { hi += 30; }

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (await checkExists(seq, mid)) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      counts[seq] = found;
    })
  );

  try { localStorage.setItem(CACHE_KEY, JSON.stringify(counts)); } catch {}
  return counts;
}

/* ─────────────────────────────────────────────
   STRIDED PRIORITY GENERATOR
   Produces a sequence order that rapidly covers the entire timeline
   (boundaries -> stride 8 -> stride 4 -> stride 2 -> full fill)
───────────────────────────────────────────── */
function getPriorityFrameOrder(count) {
  const seen = new Set();
  const order = [];

  const add = (n) => {
    if (n >= 1 && n <= count && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };

  // 1. Boundary anchor frames
  add(1);
  add(count);

  // 2. Keyframes every 8 frames
  for (let i = 1; i <= count; i += 8) add(i);

  // 3. Midpoints every 4 frames
  for (let i = 5; i <= count; i += 8) add(i);

  // 4. Midpoints every 2 frames
  for (let i = 3; i <= count; i += 4) add(i);

  // 5. All remaining frames
  for (let i = 1; i <= count; i++) add(i);

  return order;
}

/* ─────────────────────────────────────────────
   PROGRESSIVE LOADER
───────────────────────────────────────────── */
export class ProgressiveLoader {
  constructor(frameCounts, mobile) {
    this.frameCounts = frameCounts;
    this.mobile      = mobile;
    this.cache       = {};           // { [seq]: { [frameNum]: ImageBitmap } }
    this._done       = new Set();    // set of fully loaded section keys ('s1', etc.)
    this._promises   = new Map();    // in-flight section load promises
    this._lastBitmap = null;         // last rendered bitmap fallback
  }

  /** Load a single frame into cache */
  async loadFrame(seq, frameNum) {
    if (this.cache[seq]?.[frameNum]) return this.cache[seq][frameNum];
    if (!this.cache[seq]) this.cache[seq] = {};

    try {
      const res = await fetch(frameUrl(seq, frameNum, this.mobile));
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      this.cache[seq][frameNum] = bmp;
      return bmp;
    } catch {
      return null;
    }
  }

  /**
   * Preload the boundary anchor frames (frame 1 and frame count) for ALL sequences.
   * This is fast (~50-100ms) and guarantees that every transition target is ready.
   */
  async preloadAnchorFrames() {
    const promises = [];
    for (let s = 1; s <= 7; s++) {
      const count = this.frameCounts[s] || 192;
      promises.push(this.loadFrame(s, 1));
      promises.push(this.loadFrame(s, count));
    }
    await Promise.all(promises);
  }

  /**
   * Preload strided keyframes across all sequences [2..7] in the background.
   * Takes only ~150 requests and provides seamless coverage across the entire site.
   */
  async preloadAllKeyframes(stride = 8, concurrency = 16) {
    const tasks = [];
    for (let s = 2; s <= 7; s++) {
      const count = this.frameCounts[s] || 192;
      for (let f = 1; f <= count; f += stride) {
        tasks.push({ s, f });
      }
    }

    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      await Promise.all(batch.map(t => this.loadFrame(t.s, t.f)));
    }
  }

  /**
   * Get a frame with sequence-isolated nearest-neighbour fallback.
   *
   * @param {number} seq             - Sequence number
   * @param {number} frameNum        - Requested frame number
   * @param {boolean} fallbackToLast - If true, can fall back to _lastBitmap if sequence has 0 frames.
   *                                   If false (e.g. for crossfade target), returns null if sequence
   *                                   has no frames, avoiding bogus self-crossfades.
   */
  getFrame(seq, frameNum, fallbackToLast = true) {
    const seqCache = this.cache[seq];

    // 1. Exact match
    if (seqCache?.[frameNum]) {
      this._lastBitmap = seqCache[frameNum];
      return seqCache[frameNum];
    }

    // 2. Nearest-neighbour search within the SAME sequence
    if (seqCache) {
      const maxDelta = 60;
      for (let d = 1; d <= maxDelta; d++) {
        if (seqCache[frameNum - d]) {
          this._lastBitmap = seqCache[frameNum - d];
          return seqCache[frameNum - d];
        }
        if (seqCache[frameNum + d]) {
          this._lastBitmap = seqCache[frameNum + d];
          return seqCache[frameNum + d];
        }
      }

      // Any available frame in this sequence
      const keys = Object.keys(seqCache);
      if (keys.length > 0) {
        const b = seqCache[keys[0]];
        this._lastBitmap = b;
        return b;
      }
    }

    // 3. Fallback only if explicitly allowed (for current base frame)
    return fallbackToLast ? this._lastBitmap : null;
  }

  /**
   * Load all frames of a sequence using strided priority ordering.
   */
  async loadSection(seq, onProgress, concurrency = 12) {
    const count = this.frameCounts[seq];
    if (!count) return;

    const key = `s${seq}`;
    if (this._done.has(key)) return;

    if (this._promises.has(key)) {
      await this._promises.get(key);
      return;
    }

    const promise = this._doLoad(seq, key, onProgress, concurrency);
    this._promises.set(key, promise);
    try {
      await promise;
    } finally {
      this._promises.delete(key);
    }
  }

  async _doLoad(seq, key, onProgress, concurrency) {
    if (!this.cache[seq]) this.cache[seq] = {};

    const count = this.frameCounts[seq];
    const priorityList = getPriorityFrameOrder(count);

    const needed = priorityList.filter(fNum => !this.cache[seq][fNum]);
    if (onProgress) onProgress(priorityList.length - needed.length);

    for (let i = 0; i < needed.length; i += concurrency) {
      const batch = needed.slice(i, i + concurrency);
      await Promise.all(batch.map(async fNum => {
        await this.loadFrame(seq, fNum);
        if (onProgress) onProgress(1);
      }));
    }

    this._done.add(key);
  }

  /** Prioritize background loading for current and upcoming sections */
  preloadNeighbours(currentSeq, allSeqs = [1,2,3,4,5,6,7]) {
    const idx = allSeqs.indexOf(currentSeq);
    const priorities = [
      allSeqs[idx + 1],
      allSeqs[idx],
      allSeqs[idx + 2],
      allSeqs[idx - 1],
    ].filter(s => s != null && !this._done.has(`s${s}`) && !this._promises.has(`s${s}`));

    for (const seq of priorities) {
      this.loadSection(seq, null, 12).catch(() => {});
    }
  }

  /** Invalidate a sequence (after mobile ↔ desktop resize) */
  invalidateSection(seq) {
    delete this.cache[seq];
    this._done.delete(`s${seq}`);
  }
}
