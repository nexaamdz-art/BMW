/**
 * canvasRenderer.js — BMW M4 Experience
 *
 * Responsibilities:
 *  - Maintain a DPR-aware, cover-fit canvas
 *  - Draw the current frame + optional crossfade to the next frame
 *  - Velocity-influenced crossfade strength
 *  - Never flash black: if bitmap is null, hold last valid frame
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
    this.currentBmp   = null;   // what's drawn as the base layer
    this.nextBmp      = null;   // what's drawn on top (crossfade)
    this.crossAlpha   = 0;

    // Held last-valid bitmap to prevent black flash
    this._lastValidBmp = null;

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

    // Use setTransform to avoid cumulative scale on every resize
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._dirty = true;
  }

  /* ---- Object-fit cover math ---- */
  _coverRect(bmp) {
    const cw = this.width, ch = this.height;
    const bw = bmp.width,  bh = bmp.height;
    const scale = Math.max(cw / bw, ch / bh);
    const w = bw * scale,  h = bh * scale;
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
   * Set the frame state for the next RAF tick.
   *
   * @param {ImageBitmap|null} current   – primary frame
   * @param {ImageBitmap|null} next      – crossfade target (or null)
   * @param {number}           alpha     – crossfade mix [0..1]
   */
  setFrame(current, next = null, alpha = 0) {
    // Hold last valid bitmap so canvas never goes dark
    if (current)                    this._lastValidBmp = current;
    else if (this._lastValidBmp)    current = this._lastValidBmp;

    this.currentBmp = current;
    this.nextBmp    = next && alpha > 0.005 ? next : null;
    this.crossAlpha = Math.max(0, Math.min(1, alpha));
    this._dirty = true;
  }

  /* ---- Render ---- */
  _render() {
    if (!this._dirty) return;
    this._dirty = false;

    const ctx = this.ctx;
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, this.width, this.height);

    this._drawCover(this.currentBmp, 1);

    if (this.nextBmp && this.crossAlpha > 0.005) {
      this._drawCover(this.nextBmp, this.crossAlpha);
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
