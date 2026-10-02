/**
 * frameLoader.js
 * Automatic frame count probing, caching, ImageBitmap decoding,
 * and progressive section-by-section preloading.
 */

const FRAME_BASE = '/frames';
const FRAME_BASE_M = '/frames_m';

/** Pad number to 4 digits */
export function pad4(n) {
  return String(n).padStart(4, '0');
}

/** Build the URL for a specific sequence/frame */
export function frameUrl(seq, frame, mobile = false) {
  const base = mobile ? FRAME_BASE_M : FRAME_BASE;
  return `${base}/s${seq}/f_${pad4(frame)}.webp`;
}

/**
 * Detect the real frame count automatically by probing files until a 404 occurs,
 * then cache it in localStorage.
 */
export async function detectRealFrameCounts(mobile = false) {
  const cacheKey = `bmw_m4_frame_counts_${mobile ? 'm' : 'd'}_v2`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed[1] && parsed[7]) {
        return parsed;
      }
    }
  } catch {
    // localStorage may be unavailable
  }

  // Fallback defaults from specifications in case probing fails
  const defaults = { 1: 192, 2: 192, 3: 192, 4: 240, 5: 240, 6: 240, 7: 192 };
  const counts = { ...defaults };
  const seqs = [1, 2, 3, 4, 5, 6, 7];

  // Helper to check if a specific frame exists (HEAD request)
  const checkFrame = async (seq, frame) => {
    try {
      const res = await fetch(frameUrl(seq, frame, mobile), { method: 'HEAD' });
      return res.status === 200 || res.ok;
    } catch {
      return false;
    }
  };

  await Promise.all(
    seqs.map(async (seq) => {
      try {
        let lo = 1;
        let hi = 350;
        let maxFound = defaults[seq];

        // Binary search to find highest frame before 404
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const exists = await checkFrame(seq, mid);
          if (exists) {
            maxFound = Math.max(maxFound, mid);
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        counts[seq] = maxFound;
      } catch {
        counts[seq] = defaults[seq];
      }
    })
  );

  try {
    localStorage.setItem(cacheKey, JSON.stringify(counts));
  } catch {
    // Ignore storage errors
  }

  return counts;
}

/**
 * Progressive preloader: loads current section first, then neighbors.
 * Uses ImageBitmap decoding for background thread decompression (60fps).
 */
export class ProgressiveLoader {
  constructor(frameCounts, mobile) {
    this.frameCounts = frameCounts; // { 1: 192, ... }
    this.mobile = mobile;
    this.cache = {}; // { seqId: { frameNum: ImageBitmap } }
    this.loading = new Set();
  }

  /** Load a single frame into cache */
  async loadFrame(seq, frameNum) {
    if (this.cache[seq]?.[frameNum]) return this.cache[seq][frameNum];
    if (!this.cache[seq]) this.cache[seq] = {};

    const url = frameUrl(seq, frameNum, this.mobile);
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      this.cache[seq][frameNum] = bmp;
      return bmp;
    } catch {
      return null;
    }
  }

  /** Get a frame from cache with fallback to nearest available frame */
  getFrame(seq, frameNum) {
    if (this.cache[seq]?.[frameNum]) return this.cache[seq][frameNum];

    // Fallback: look for closest loaded frame in sequence
    if (this.cache[seq]) {
      for (let delta = 1; delta <= 30; delta++) {
        if (this.cache[seq][frameNum - delta]) return this.cache[seq][frameNum - delta];
        if (this.cache[seq][frameNum + delta]) return this.cache[seq][frameNum + delta];
      }
      const keys = Object.keys(this.cache[seq]);
      if (keys.length > 0) return this.cache[seq][keys[0]];
    }

    return null;
  }

  /** Load all frames of a sequence in small concurrent batches */
  async loadSection(seq, onProgress, concurrency = 8) {
    const count = this.frameCounts[seq];
    if (!count) return;

    const key = `section-${seq}`;
    if (this.loading.has(key)) return;
    this.loading.add(key);

    if (!this.cache[seq]) this.cache[seq] = {};

    const frameIndices = [];
    for (let i = 1; i <= count; i++) {
      if (!this.cache[seq][i]) frameIndices.push(i);
      else if (onProgress) onProgress(1);
    }

    // Process in batches to avoid overwhelming browser network connections
    for (let i = 0; i < frameIndices.length; i += concurrency) {
      const batch = frameIndices.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (fNum) => {
          await this.loadFrame(seq, fNum);
          if (onProgress) onProgress(1);
        })
      );
    }
  }

  /** Background preloading: prioritizes neighbors of current section */
  async preloadAround(currentSeq) {
    const allSeqs = [1, 2, 3, 4, 5, 6, 7];
    const idx = allSeqs.indexOf(currentSeq);
    const neighbors = [allSeqs[idx + 1], allSeqs[idx - 1], allSeqs[idx + 2]].filter(
      (s) => s && !this.loading.has(`section-${s}`)
    );

    for (const seq of neighbors) {
      this.loadSection(seq, null, 6).catch(() => {});
    }
  }
}
