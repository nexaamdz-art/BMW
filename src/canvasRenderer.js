/**
 * canvasRenderer.js
 * Fixed fullscreen canvas that draws image-sequence frames
 * with object-fit: cover logic and smooth cross-fade blending.
 */

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.currentBitmap = null;
    this.nextBitmap = null;
    this.crossfadeAlpha = 0;
    this._raf = null;
    this._dirty = true;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._startRaf();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._dirty = true;
  }

  /** Cover-fit: draw bitmap centered, scaled to cover the canvas */
  _drawCover(bmp, alpha = 1) {
    if (!bmp) return;
    const cw = this.width;
    const ch = this.height;
    const bw = bmp.width;
    const bh = bmp.height;

    const scale = Math.max(cw / bw, ch / bh);
    const sw = bw * scale;
    const sh = bh * scale;
    const sx = (cw - sw) / 2;
    const sy = (ch - sh) / 2;

    if (alpha < 1) {
      this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    }
    this.ctx.drawImage(bmp, sx, sy, sw, sh);
    if (alpha < 1) {
      this.ctx.globalAlpha = 1;
    }
  }

  /**
   * Set the frame to draw.
   * If nextBitmap is provided with crossfadeAlpha > 0, blends nextBitmap over currentBitmap.
   */
  setFrame(bitmap, nextBitmap = null, crossfadeAlpha = 0) {
    this.currentBitmap = bitmap;
    this.nextBitmap = nextBitmap;
    this.crossfadeAlpha = Math.max(0, Math.min(1, crossfadeAlpha));
    this._dirty = true;
  }

  _render() {
    if (!this._dirty) return;
    this._dirty = false;

    const ctx = this.ctx;
    const cw = this.width;
    const ch = this.height;

    // Background fill
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, cw, ch);

    if (this.currentBitmap) {
      this._drawCover(this.currentBitmap, 1);
    }

    if (this.nextBitmap && this.crossfadeAlpha > 0.005) {
      this._drawCover(this.nextBitmap, this.crossfadeAlpha);
    }
  }

  _startRaf() {
    const loop = () => {
      this._render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
