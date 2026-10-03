/**
 * frameLoader.js — BMW M4 Experience
 *
 * Responsibilities:
 *  - Detect real frame counts via binary-search HEAD probes (cached in localStorage)
 *  - Decode frames as ImageBitmaps on a background thread
 *  - Serve frames with nearest-neighbour fallback while loading
 *  - Expose a priority-queue preloader (current section first, then neighbours)
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

/**
 * Probe frame counts via parallel binary-search HEAD requests.
 * Results are stored in localStorage so the next visit skips probing entirely.
 */
export async function detectRealFrameCounts(mobile = false) {
  const CACHE_KEY = `bmw_m4_fc_${mobile ? 'm' : 'd'}_v3`;

  // Return cached counts if available and complete
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && [1,2,3,4,5,6,7].every(s => parsed[s] > 0)) return parsed;
    }
  } catch { /* storage unavailable */ }

  // Known safe defaults (verified from filesystem)
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
      let lo = defaults[seq];   // start from known-good count
      let hi = lo + 60;         // search slightly above
      let found = lo;

      // Walk upward first
      while (await checkExists(seq, hi)) { hi += 30; }

      // Binary search between lo and hi
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
   PROGRESSIVE LOADER
───────────────────────────────────────────── */
export class ProgressiveLoader {
  constructor(frameCounts, mobile) {
    this.frameCounts    = frameCounts;
    this.mobile         = mobile;
    this.cache          = {};           // { seqId: { frameNum: ImageBitmap } }
    this._done          = new Set();    // fully loaded section keys
    this._promises      = new Map();    // key -> Promise (for concurrent waiters)
    this._lastBitmap    = null;         // anti-black-flash: last valid bitmap
  }

  /* ---- Single frame ---- */
  async loadFrame(seq, frameNum) {
    if (this.cache[seq]?.[frameNum]) return this.cache[seq][frameNum];
    if (!this.cache[seq]) this.cache[seq] = {};

    try {
      const res = await fetch(frameUrl(seq, frameNum, this.mobile));
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      this.cache[seq][frameNum] = bmp;
      return bmp;
    } catch { return null; }
  }

  /**
   * Get a frame with nearest-neighbour fallback and last-bitmap anti-flash.
   */
  getFrame(seq, frameNum) {
    const seqCache = this.cache[seq];
    if (seqCache?.[frameNum]) {
      this._lastBitmap = seqCache[frameNum];
      return seqCache[frameNum];
    }

    // Nearest-neighbour search ±50 frames
    if (seqCache) {
      for (let d = 1; d <= 50; d++) {
        if (seqCache[frameNum - d]) { this._lastBitmap = seqCache[frameNum - d]; return seqCache[frameNum - d]; }
        if (seqCache[frameNum + d]) { this._lastBitmap = seqCache[frameNum + d]; return seqCache[frameNum + d]; }
      }
      const keys = Object.keys(seqCache);
      if (keys.length) { const b = seqCache[keys[0]]; this._lastBitmap = b; return b; }
    }

    // Last-resort: hold last rendered frame — canvas never goes dark
    return this._lastBitmap;
  }

  /** Load all frames of a sequence. Concurrent callers await the same Promise. */
  async loadSection(seq, onProgress, concurrency = 10) {
    const count = this.frameCounts[seq];
    if (!count) return;

    const key = `s${seq}`;
    if (this._done.has(key)) return;

    // If already in flight, await the existing promise (no setInterval polling)
    if (this._promises.has(key)) {
      await this._promises.get(key);
      return;
    }

    // Start the load and register it
    const promise = this._doLoad(seq, key, onProgress, concurrency);
    this._promises.set(key, promise);
    try { await promise; } finally { this._promises.delete(key); }
  }

  async _doLoad(seq, key, onProgress, concurrency) {
    if (!this.cache[seq]) this.cache[seq] = {};

    const needed = [];
    for (let i = 1; i <= this.frameCounts[seq]; i++) {
      if (!this.cache[seq][i]) needed.push(i);
      else if (onProgress) onProgress(1);
    }

    for (let i = 0; i < needed.length; i += concurrency) {
      const batch = needed.slice(i, i + concurrency);
      await Promise.all(batch.map(async fNum => {
        await this.loadFrame(seq, fNum);
        if (onProgress) onProgress(1);
      }));
    }

    this._done.add(key);
  }

  /** Kick off background loads for upcoming sections (fire-and-forget) */
  preloadNeighbours(currentSeq, allSeqs = [1,2,3,4,5,6,7]) {
    const idx = allSeqs.indexOf(currentSeq);
    [allSeqs[idx + 1], allSeqs[idx - 1], allSeqs[idx + 2], allSeqs[idx - 2]]
      .filter(s => s != null && !this._done.has(`s${s}`) && !this._promises.has(`s${s}`))
      .forEach(seq => this.loadSection(seq, null, 8).catch(() => {}));
  }

  /** Invalidate a section (after mobile ↔ desktop switch) */
  invalidateSection(seq) {
    delete this.cache[seq];
    this._done.delete(`s${seq}`);
    // Let any in-flight promise finish; new requests will re-load after it resolves
  }
}
