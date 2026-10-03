/**
 * canvasRenderer.js — BMW M4 Experience
 *
 * Responsibilities:
 *  - Maintain a DPR-aware, cover-fit canvas
 *  - Draw base frame + smooth crossfade frame with zero ghosting
 *  - Sequence transition guards: never crossfades identical bitmaps
 *  - Anti-flash fallback: holds last valid bitmap if a frame decode is pending
 *  - RAF loop only redraws when dirty
 */

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    this.dpr     = 1;
    this.width   = 0;
    this.height  = 0;

    // Frame state
    this.currentBmp    = null;   // primary base frame
    this.nextBmp       = null;   // crossfade target frame
    this.crossAlpha    = 0;      // blend ratio [0..1]
    this._lastValidBmp = null;   // anti-black-flash bitmap

    this._dirty = true;
    this._raf   = null;

    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this._startRaf();
  }

  /* ---- Layout ---- */
  resize() {
    this.dpr    = Math.min(window.devicePixelRatio || 1, 2);
    this.width  = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.style.width  = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.canvas.width  = Math.round(this.width  * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);

    // Apply DPR scale via setTransform to prevent cumulative scale
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._dirty = true;
  }

  /* ---- Object-fit cover math ---- */
  _coverRect(bmp) {
    const cw = this.width,  ch = this.height;
    const bw = bmp.width,   bh = bmp.height;
    const scale = Math.max(cw / bw, ch / bh);
    const w = bw * scale,   h = bh * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  _drawCover(bmp, alpha = 1) {
    if (!bmp) return;
    const ctx = this.ctx;
    if (alpha < 0.999) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const { x, y, w, h } = this._coverRect(bmp);
    ctx.drawImage(bmp, x, y, w, h);
    if (alpha < 0.999) ctx.globalAlpha = 1;
  }

  /**
   * Set the frame state for the next RAF render tick.
   *
   * @param {ImageBitmap|null} current - Base frame
   * @param {ImageBitmap|null} next    - Crossfade target frame (or null)
   * @param {number}           alpha   - Crossfade mix [0..1]
   */
  setFrame(current, next = null, alpha = 0) {
    if (current)                    this._lastValidBmp = current;
    else if (this._lastValidBmp)    current = this._lastValidBmp;

    this.currentBmp = current;

    // Disallow crossfading between identical bitmaps to prevent double-draw artifacts
    const isValidNext = next && next !== current && alpha > 0.005;
    this.nextBmp    = isValidNext ? next : null;
    this.crossAlpha = isValidNext ? Math.max(0, Math.min(1, alpha)) : 0;
    this._dirty     = true;
  }

  /* ---- Render ---- */
  _render() {
    if (!this._dirty) return;
    this._dirty = false;

    const ctx = this.ctx;
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, this.width, this.height);

    if (!this.currentBmp && !this.nextBmp) return;

    if (this.nextBmp && this.crossAlpha >= 0.995) {
      // 100% transition complete
      this._drawCover(this.nextBmp, 1);
    } else if (this.nextBmp && this.crossAlpha > 0.005) {
      // Smooth dissolve
      this._drawCover(this.currentBmp, 1);
      this._drawCover(this.nextBmp, this.crossAlpha);
    } else if (this.currentBmp) {
      this._drawCover(this.currentBmp, 1);
    }
  }

  _startRaf() {
    const tick = () => {
      this._render();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
