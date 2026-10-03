/**
 * main.js — BMW M4 Fan Concept: The Art of Power
 *
 * Canvas and grain now live at body root — they render frames
 * even during the loader & entry screen, so "Enter" reveals them
 * instantly with no black flash.
 */

import './style.css';
import gsap              from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis             from 'lenis';
import { detectRealFrameCounts, ProgressiveLoader } from './frameLoader.js';
import { CanvasRenderer }  from './canvasRenderer.js';
import { AudioManager }    from './audioManager.js';
import { I18n }            from './i18n.js';

gsap.registerPlugin(ScrollTrigger);

/* ═══════════════════════════════════════════════
   TIMELINE CONFIG
═══════════════════════════════════════════════ */
const TOTAL_VH    = 900;
const CROSSFADE_F = 6;
const MOBILE_BP   = 768;

const CHAPTERS = [
  { id: 'scene-1', seq: 1, start: 0.000, end: 0.125 },
  { id: 'scene-2', seq: 2, start: 0.125, end: 0.250 },
  { id: 'scene-3', seq: 3, start: 0.250, end: 0.375 },
  { id: 'scene-r', seq: 'r', start: 0.375, end: 0.520 },
  { id: 'scene-4', seq: 4, start: 0.520, end: 0.640 },
  { id: 'scene-5', seq: 5, start: 0.640, end: 0.760 },
  { id: 'scene-6', seq: 6, start: 0.760, end: 0.880 },
  { id: 'scene-7', seq: 7, start: 0.880, end: 1.000 },
];

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let isMobile        = window.innerWidth < MOBILE_BP;
let frameCounts     = { 1:192, 2:192, 3:192, 4:240, 5:240, 6:240, 7:192 };
let loaderObj, renderer, audio, i18n, lenis;
let activeChapterId = null;
let statsAnimated   = false;
let entryDone       = false;
let scrollHintGone  = false;

/* ═══════════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════════ */
const $loader    = document.getElementById('loader');
const $loaderBar = document.getElementById('loader-fill');
const $loaderPct = document.getElementById('loader-pct');
const $loaderLbl = document.getElementById('loader-label');
const $exp       = document.getElementById('experience');
const $canvas    = document.getElementById('main-canvas');
const $progLine  = document.getElementById('progress-line');
const $btnLang   = document.getElementById('btn-lang');
const $btnMute   = document.getElementById('btn-mute');
const $langLabel = document.getElementById('lang-label');
const $scrollBox = document.getElementById('scroll-container');
const $chapterNav= document.getElementById('chapter-nav');
const $chapterDots = $chapterNav ? Array.from($chapterNav.querySelectorAll('.chapter-dot')) : [];

// Cached text overlay elements (populated in setupScrubber after DOM is ready)
const _textEls = new Map();

/* ═══════════════════════════════════════════════
   BOOT — canvas renders s1 frames immediately
═══════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  document.body.style.overflow = 'hidden';
  // Canvas is at body level — init renderer now so frames render behind the loader
  renderer = new CanvasRenderer($canvas);
  boot().catch(err => console.error('[Boot]', err));
});

async function boot() {
  isMobile = window.innerWidth < MOBILE_BP;

  $loaderLbl.textContent = 'Analyzing frames…';
  frameCounts = await detectRealFrameCounts(isMobile);

  loaderObj = new ProgressiveLoader(frameCounts, isMobile);
  audio     = new AudioManager();
  i18n      = new I18n();

  // Load s1 and display immediately — canvas is already rendering
  $loaderLbl.textContent = 'Loading experience…';
  let loaded = 0;
  const s1Total = frameCounts[1];

  await loaderObj.loadSection(1, () => {
    loaded++;
    const pct = Math.min(100, Math.round(loaded / s1Total * 100));
    $loaderBar.style.width = pct + '%';
    $loaderPct.textContent = pct + '%';
  });

  // Show first frame (canvas is visible — no flash)
  const f1 = loaderObj.getFrame(1, 1, true);
  if (f1) renderer.setFrame(f1);

  // Preload boundary anchor frames for ALL sequences (fast: only 12 frames)
  loaderObj.preloadAnchorFrames().catch(() => {});

  // Background load remaining sections with strided keyframes first
  _bgLoad();

  // Reveal experience directly — no intermediate button screen
  $loader.classList.add('fade-out');
  setTimeout(() => $loader.classList.add('hidden'), 650);

  enterExperience();
}

async function _bgLoad() {
  // Step 1: Preload sparse keyframes (stride 8) across all sequences 2..7
  // This takes only ~150 requests and guarantees full timeline coverage immediately
  await loaderObj.preloadAllKeyframes(8, 16);

  // Step 2: Fill in remaining frames section by section
  for (const seq of [2, 3, 4, 5, 6, 7]) {
    await loaderObj.loadSection(seq, null, 12);
    await new Promise(r => setTimeout(r, 16));
  }
}

/* ═══════════════════════════════════════════════
   ENTER EXPERIENCE (DIRECTLY)
═══════════════════════════════════════════════ */
function enterExperience() {
  if (entryDone) return;
  entryDone = true;

  document.body.style.overflow = '';

  _setSceneHeights();
  setupLenis();
  setupScrubber();
  setupControls();
  setupKeyboard();
  setupAudioUnlock();

  tick(0);
}

/* ═══════════════════════════════════════════════
   AUDIO UNLOCK ON FIRST GESTURE (Autoplay compliance)
═══════════════════════════════════════════════ */
function setupAudioUnlock() {
  let unlocked = false;
  const unlock = async () => {
    if (unlocked) return;
    unlocked = true;

    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('wheel', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);

    await audio.init(true);
    await Promise.all([
      audio.loadTrack('teardown', '/audio/teardown.mp3'),
      audio.loadTrack('engine',   '/audio/engine_dive.mp3'),
      audio.loadTrack('launch',   '/audio/launch.mp3'),
    ]);
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('wheel', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

/* ═══════════════════════════════════════════════
   SECTION HEIGHTS
═══════════════════════════════════════════════ */
function _setSceneHeights() {
  let total = 0;
  CHAPTERS.forEach(ch => {
    const el = document.getElementById(ch.id);
    if (!el) return;
    const vh = Math.round((ch.end - ch.start) * TOTAL_VH * 10) / 10;
    el.style.height = vh + 'vh';
    total += vh;
  });
  $scrollBox.style.height = total + 'vh';
}

/* ═══════════════════════════════════════════════
   LENIS
═══════════════════════════════════════════════ */
function setupLenis() {
  lenis = new Lenis({
    duration:        1.25,
    easing:          t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation:     'vertical',
    smoothWheel:     true,
    wheelMultiplier: 0.85,
    touchMultiplier: 1.5,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Hide scroll hint once user starts scrolling
  lenis.on('scroll', ({ scroll }) => {
    if (!scrollHintGone && scroll > 50) {
      scrollHintGone = true;
      const hint = document.querySelector('.scroll-hint');
      if (hint) gsap.to(hint, { opacity: 0, y: -8, duration: 0.5, ease: 'power2.in' });
    }
  });
}

/* ═══════════════════════════════════════════════
   MASTER SCRUBBER
═══════════════════════════════════════════════ */
let _prevProg = 0;
let _vel      = 0;

function setupScrubber() {
  // Cache text overlay elements
  CHAPTERS.forEach(ch => {
    const el = document.querySelector(`#${ch.id} .scene-text`);
    if (el) _textEls.set(ch.id, el);
  });

  ScrollTrigger.create({
    trigger: $scrollBox,
    start  : 'top top',
    end    : 'bottom bottom',
    scrub  : true,
    onUpdate(self) {
      _vel = Math.min(0.008, Math.abs(self.progress - _prevProg));
      _prevProg = self.progress;
      tick(self.progress);
    },
  });
}

/* ═══════════════════════════════════════════════
   KEYBOARD NAVIGATION — arrow keys jump chapters
═══════════════════════════════════════════════ */
function setupKeyboard() {
  let lastKey = 0;
  window.addEventListener('keydown', e => {
    if (!lenis) return;
    const now = Date.now();
    if (now - lastKey < 600) return; // debounce
    lastKey = now;

    const totalH = $scrollBox.scrollHeight || document.documentElement.scrollHeight;
    const curProg = _prevProg;

    let targetChIdx = -1;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      // Jump to next chapter start
      for (let i = 0; i < CHAPTERS.length; i++) {
        if (CHAPTERS[i].start > curProg + 0.01) { targetChIdx = i; break; }
      }
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      // Jump to previous chapter start
      for (let i = CHAPTERS.length - 1; i >= 0; i--) {
        if (CHAPTERS[i].start < curProg - 0.01) { targetChIdx = i; break; }
      }
    }

    if (targetChIdx >= 0) {
      e.preventDefault();
      scrollToChapter(targetChIdx);
    }
  }, { passive: false });
}

function scrollToChapter(chIdx) {
  if (!lenis || chIdx < 0 || chIdx >= CHAPTERS.length) return;
  const ch = CHAPTERS[chIdx];
  const totalScrollable = document.documentElement.scrollHeight - window.innerHeight;
  const targetY = ch.start * totalScrollable;
  lenis.scrollTo(targetY, { duration: 1.6, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
}

/* ═══════════════════════════════════════════════
   CHAPTER DOTS
═══════════════════════════════════════════════ */
function setupChapterDots() {
  $chapterDots.forEach((dot, i) => {
    dot.addEventListener('click', () => scrollToChapter(i));
  });
}

function updateChapterDots(activeIdx) {
  $chapterDots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIdx);
  });
}

/* ═══════════════════════════════════════════════
   MAIN TICK
═══════════════════════════════════════════════ */
function tick(progress) {
  const p = Math.max(0, Math.min(1, progress));

  if ($progLine) $progLine.style.height = (p * 100) + '%';

  // Find active chapter (scan from end for efficiency)
  let ch = CHAPTERS[0], chIdx = 0;
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    if (p >= CHAPTERS[i].start) { ch = CHAPTERS[i]; chIdx = i; break; }
  }

  const span  = ch.end - ch.start;
  const localP = span > 0 ? Math.max(0, Math.min(1, (p - ch.start) / span)) : 0;

  drawFrame(ch, chIdx, localP);
  handleAudio(ch, localP);
  updateText(ch, localP);
  updateChapterDots(chIdx);

  if (ch.id === 'scene-3' && localP >= 0.08 && !statsAnimated) {
    statsAnimated = true;
    countUp();
  }
  if (p < 0.25) statsAnimated = false;

  if (localP > 0.65 && typeof ch.seq === 'number') {
    loaderObj.preloadNeighbours(ch.seq);
  }
}

/* ═══════════════════════════════════════════════
   CANVAS FRAME RENDERING
═══════════════════════════════════════════════ */
function drawFrame(ch, chIdx, localP) {
  let cur = null, nxt = null, alpha = 0;

  if (ch.seq === 'r') {
    const s3 = frameCounts[3] || 192;
    const s2 = frameCounts[2] || 192;

    if (localP < 0.5) {
      // First half: Sequence 3 in reverse (frame 192 down to 1)
      const sp = localP / 0.5;
      const f = Math.max(1, Math.min(s3, Math.round((1 - sp) * (s3 - 1)) + 1));
      cur = loaderObj.getFrame(3, f, true);

      // Smooth dissolve into s2 frame 192 near midpoint (sp > 0.85)
      if (sp > 0.85) {
        alpha = (sp - 0.85) / 0.15;
        nxt = loaderObj.getFrame(2, s2, false);
      }
    } else {
      // Second half: Sequence 2 in reverse (frame 192 down to 1)
      const sp = (localP - 0.5) / 0.5;
      const f = Math.max(1, Math.min(s2, Math.round((1 - sp) * (s2 - 1)) + 1));
      cur = loaderObj.getFrame(2, f, true);

      // Smooth dissolve into s4 frame 1 at the end of reassembly (sp > 0.85)
      if (sp > 0.85 && chIdx < CHAPTERS.length - 1) {
        alpha = (sp - 0.85) / 0.15;
        nxt = loaderObj.getFrame(CHAPTERS[chIdx + 1].seq, 1, false);
      }
    }
  } else {
    const seq = ch.seq;
    const count = frameCounts[seq] || 192;
    const f = Math.max(1, Math.min(count, Math.round(localP * (count - 1)) + 1));
    cur = loaderObj.getFrame(seq, f, true);

    // Transitions between sequences:
    const nextCh = CHAPTERS[chIdx + 1];
    if (nextCh) {
      // NOTE: Scene 3 ends at s3 frame 192, and Scene R begins at s3 frame 192 in reverse.
      // This is a continuous sequence reversal — NO CROSSFADE to avoid double-image ghosting!
      if (nextCh.seq !== 'r') {
        const crossFrames = 10 + Math.round(_vel * 1500);
        const fadeStart = 1 - (crossFrames / count);

        if (localP > fadeStart) {
          alpha = Math.min(1, (localP - fadeStart) / (crossFrames / count));
          nxt = loaderObj.getFrame(nextCh.seq, 1, false);
        }
      }
    }
  }

  renderer.setFrame(cur, nxt, alpha);
}

/* ═══════════════════════════════════════════════
   AUDIO — gated on chapter change
═══════════════════════════════════════════════ */
function handleAudio(ch, localP) {
  const chId   = ch.id;
  const changed = chId !== activeChapterId;
  activeChapterId = chId;

  switch (chId) {
    case 'scene-2':
      if (changed) { audio.play('teardown', { loop: true, volume: 0.3 }); audio.stop('engine', 0.5); audio.stop('launch', 0.3); }
      audio.setVolume('teardown', 0.25 + 0.7 * localP);
      break;

    case 'scene-3':
      if (changed) { audio.play('engine', { loop: true, volume: 0.3 }); audio.stop('teardown', 0.6); audio.stop('launch', 0.3); }
      audio.setVolume('engine', 0.3 + 0.65 * localP);
      break;

    case 'scene-r':
      // Low ambient during reassembly — setVolume guards against non-playing tracks
      audio.setVolume('teardown', 0.06, 0.4);
      audio.setVolume('engine',   0.06, 0.4);
      break;

    case 'scene-7':
      if (changed) { audio.play('launch', { loop: false, volume: 0.2 }); audio.stop('teardown', 0.4); audio.stop('engine', 0.4); }
      audio.setVolume('launch', Math.min(1.0, 0.2 + localP * 0.8));
      audio.setRate('launch', 0.8 + localP * 0.55);
      break;

    default:
      if (changed) { audio.stop('teardown', 0.5); audio.stop('engine', 0.5); audio.stop('launch', 0.5); }
      break;
  }
}

/* ═══════════════════════════════════════════════
   TEXT OVERLAYS
═══════════════════════════════════════════════ */
function updateText(activeCh, localP) {
  CHAPTERS.forEach((ch, idx) => {
    const el = _textEls.get(ch.id);
    if (!el) return;

    let opacity = 0, yPx = 0;

    if (ch.id === activeCh.id) {
      const fIn = 0.14, fOut = 0.86;
      if (idx === 0) {
        opacity = localP > 0.80 ? 1 - (localP - 0.80) / 0.20 : 1;
      } else if (idx === CHAPTERS.length - 1) {
        opacity = localP < fIn ? localP / fIn : 1;
        yPx     = localP < fIn ? 28 * (1 - opacity) : 0;
      } else {
        if (localP < fIn)        { opacity = localP / fIn;                    yPx =  28 * (1 - opacity); }
        else if (localP > fOut)  { opacity = 1 - (localP - fOut) / (1 - fOut); yPx = -28 * (1 - opacity); }
        else                     { opacity = 1; }
      }
    }

    const clamped = Math.max(0, Math.min(1, opacity));
    el.style.opacity      = clamped.toFixed(3);
    el.style.setProperty('--y', yPx.toFixed(1) + 'px');
    el.style.pointerEvents= clamped > 0.5 ? 'auto' : 'none';
  });
}

/* ═══════════════════════════════════════════════
   STAT COUNTERS
═══════════════════════════════════════════════ */
function countUp() {
  document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    const target    = parseFloat(el.dataset.target);
    const suffix    = el.dataset.suffix || '';
    const isDecimal = !!el.dataset.decimal;
    const proxy = { val: 0 };
    gsap.to(proxy, {
      val: target, duration: 1.8, ease: 'power2.out',
      onUpdate() {
        el.textContent = isDecimal
          ? (proxy.val / 10).toFixed(1) + suffix
          : Math.round(proxy.val) + suffix;
      },
    });
  });
}

/* ═══════════════════════════════════════════════
   CONTROLS
═══════════════════════════════════════════════ */
function setupControls() {
  setupChapterDots();

  if ($btnLang) {
    $btnLang.addEventListener('click', () => {
      const lang = i18n.toggle();
      if ($langLabel) $langLabel.textContent = lang === 'en' ? 'AR' : 'EN';
    });
  }

  if ($btnMute) {
    $btnMute.addEventListener('click', () => {
      const muted = audio.toggleMute();
      const waves = document.getElementById('sound-waves');
      if (waves) waves.style.opacity = muted ? '0.15' : '1';
      $btnMute.style.opacity = muted ? '0.4' : '1';
    });
  }
}

/* ═══════════════════════════════════════════════
   RESIZE
═══════════════════════════════════════════════ */
window.addEventListener('resize', () => {
  const mobile = window.innerWidth < MOBILE_BP;
  if (mobile !== isMobile && loaderObj) {
    isMobile = mobile;
    loaderObj.mobile = mobile;
    for (let s = 1; s <= 7; s++) loaderObj.invalidateSection(s);
    _bgLoad();
  }
}, { passive: true });
