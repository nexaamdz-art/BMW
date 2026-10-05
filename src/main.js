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
const TOTAL_VH    = 1050;
const CROSSFADE_F = 6;
const MOBILE_BP   = 768;

const CHAPTERS = [
  { id: 'scene-1', seq: 1, start: 0.000, end: 0.120 },
  { id: 'scene-2', seq: 2, start: 0.120, end: 0.240 },
  { id: 'scene-3', seq: 3, start: 0.240, end: 0.360 },
  { id: 'scene-r', seq: 'r', start: 0.360, end: 0.490 },
  { id: 'scene-4', seq: 4, start: 0.490, end: 0.610 },
  { id: 'scene-5', seq: 5, start: 0.610, end: 0.730 },
  { id: 'scene-6', seq: 6, start: 0.730, end: 0.840 },
  { id: 'scene-7', seq: 7, start: 0.840, end: 1.000 },
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

// Launch animation state
let isLaunching       = false;
let launchRaf         = null;
let _lastScene7Frame  = 1;
let scene7AutoPlayed   = false;

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

  $loaderLbl.textContent = 'Loading experience…';
  frameCounts = await detectRealFrameCounts(isMobile);

  loaderObj = new ProgressiveLoader(frameCounts, isMobile);
  audio     = new AudioManager();
  i18n      = new I18n();

  let loaded = 0;
  const s1Total = frameCounts[1] || 192;

  const onLoad = () => {
    loaded++;
    const pct = Math.min(100, Math.round((loaded / s1Total) * 100));
    $loaderBar.style.width = pct + '%';
    $loaderPct.textContent = pct + '%';
  };

  // 1. Load full Scene 1 so opening scene is 100% ready
  await loaderObj.loadSection(1, onLoad, 16);

  // 2. Preload boundary anchors + keyframes across ALL scenes 1–7
  $loaderLbl.textContent = 'Preparing experience…';
  await loaderObj.preloadAnchorFrames();
  await loaderObj.preloadAllKeyframes(8, 20); // dense keyframe coverage for ALL scenes 1..7!

  // Show first frame — canvas is already visible behind loader
  const f1 = loaderObj.getFrame(1, 1, true);
  if (f1) renderer.setFrame(f1);

  // Background load all scenes progressively in priority presentation order
  _bgLoad();

  // Reveal experience
  $loader.classList.add('fade-out');
  setTimeout(() => $loader.classList.add('hidden'), 650);

  enterExperience();
}

async function _bgLoad() {
  // Load remaining frames in strategic order:
  // Immediate next scenes (2 & 3), then finale (7), then scenes 4, 5, 6
  for (const seq of [2, 3, 7, 4, 5, 6]) {
    await loaderObj.loadSection(seq, null, 16);
    await new Promise(r => setTimeout(r, 10));
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
    // Proactively preload target sequence keyframes on hover
    dot.addEventListener('mouseenter', () => {
      const ch = CHAPTERS[i];
      if (ch && typeof ch.seq === 'number') {
        loaderObj.preloadSectionKeyframes(ch.seq, 4).catch(() => {});
      } else if (ch && ch.seq === 'r') {
        loaderObj.preloadSectionKeyframes(2, 4).catch(() => {});
        loaderObj.preloadSectionKeyframes(3, 4).catch(() => {});
      }
    });

    dot.addEventListener('click', () => {
      const ch = CHAPTERS[i];
      if (ch && typeof ch.seq === 'number') {
        loaderObj.preloadSectionKeyframes(ch.seq, 4).catch(() => {});
      }
      scrollToChapter(i);
    });
  });
}

function updateChapterDots(activeIdx) {
  $chapterDots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIdx);
  });
}

/* ═══════════════════════════════════════════════
   SCENE 7 LAUNCH ANIMATION CONTROLLER
═══════════════════════════════════════════════ */
export function playLaunchAnimation(fromStart = false) {
  if (isLaunching) {
    cancelAnimationFrame(launchRaf);
    isLaunching = false;
  }

  isLaunching = true;

  if (audio) {
    audio.play('launch', { loop: false, volume: 0.95 });
    audio.stop('teardown', 0.3);
    audio.stop('engine', 0.3);
  }

  const totalFrames = frameCounts[7] || 192;
  let currentF = fromStart ? 1 : (_lastScene7Frame || 1);
  if (currentF >= totalFrames - 2) currentF = 1;

  let lastTime = performance.now();
  const fps = 32; // ~6 seconds for 192 frames, perfectly timed with engine acceleration sound
  const frameInterval = 1000 / fps;

  function step(now) {
    if (!isLaunching) return;

    const elapsed = now - lastTime;
    if (elapsed >= frameInterval) {
      const advance = Math.max(1, Math.floor(elapsed / frameInterval));
      currentF = Math.min(totalFrames, currentF + advance);
      lastTime = now - (elapsed % frameInterval);

      _lastScene7Frame = currentF;
      const bmp = loaderObj.getFrame(7, currentF, true);
      if (bmp) {
        renderer.setFrame(bmp);
      } else {
        loaderObj.loadFrame(7, currentF).then(b => {
          if (b && isLaunching) renderer.setFrame(b);
        }).catch(() => {});
      }
    }

    if (currentF < totalFrames) {
      launchRaf = requestAnimationFrame(step);
    } else {
      isLaunching = false;
    }
  }

  cancelAnimationFrame(launchRaf);
  launchRaf = requestAnimationFrame(step);
}

/* ═══════════════════════════════════════════════
   MAIN TICK
═══════════════════════════════════════════════ */
function tick(progress) {
  // Manual scroll takes immediate priority over auto-launch animation
  if (isLaunching) {
    isLaunching = false;
    cancelAnimationFrame(launchRaf);
  }

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

  // Auto-launch trigger when entering Scene 7
  if (ch.id === 'scene-7') {
    if (!scene7AutoPlayed) {
      scene7AutoPlayed = true;
      setTimeout(() => {
        if (activeChapterId === 'scene-7' && !isLaunching) {
          playLaunchAnimation(false);
        }
      }, 450);
    }
  } else if (p < 0.70) {
    scene7AutoPlayed = false;
  }

  if (localP > 0.5) {
    if (ch.seq === 'r') {
      loaderObj.loadSection(2, null, 12).catch(() => {});
      loaderObj.loadSection(4, null, 12).catch(() => {});
    } else if (typeof ch.seq === 'number') {
      loaderObj.preloadNeighbours(ch.seq);
      if (ch.seq === 6) {
        loaderObj.loadSection(7, null, 24).catch(() => {});
      }
    }
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

      // On-demand fetch + neighbor prefetch for Scene 3
      if (!loaderObj.cache[3]?.[f]) {
        loaderObj.loadFrame(3, f).then(bmp => {
          if (bmp && activeChapterId === ch.id) renderer.setFrame(bmp);
        }).catch(() => {});
      }
      if (f > 1 && !loaderObj.cache[3]?.[f - 1]) loaderObj.loadFrame(3, f - 1).catch(() => {});
      if (f < s3 && !loaderObj.cache[3]?.[f + 1]) loaderObj.loadFrame(3, f + 1).catch(() => {});

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

      // On-demand fetch + neighbor prefetch for Scene 2
      if (!loaderObj.cache[2]?.[f]) {
        loaderObj.loadFrame(2, f).then(bmp => {
          if (bmp && activeChapterId === ch.id) renderer.setFrame(bmp);
        }).catch(() => {});
      }
      if (f > 1 && !loaderObj.cache[2]?.[f - 1]) loaderObj.loadFrame(2, f - 1).catch(() => {});
      if (f < s2 && !loaderObj.cache[2]?.[f + 1]) loaderObj.loadFrame(2, f + 1).catch(() => {});

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

    if (seq === 7) {
      _lastScene7Frame = f;
    }

    // Universal on-demand fetch for ALL sequences (1, 2, 3, 4, 5, 6, 7)
    if (!loaderObj.cache[seq]?.[f]) {
      loaderObj.loadFrame(seq, f).then(bmp => {
        if (bmp && !isLaunching && activeChapterId === ch.id) {
          renderer.setFrame(bmp);
        }
      }).catch(() => {});
    }

    // Proactive lookahead prefetching in scrub directions
    if (f + 1 <= count && !loaderObj.cache[seq]?.[f + 1]) {
      loaderObj.loadFrame(seq, f + 1).catch(() => {});
    }
    if (f + 2 <= count && !loaderObj.cache[seq]?.[f + 2]) {
      loaderObj.loadFrame(seq, f + 2).catch(() => {});
    }
    if (f - 1 >= 1 && !loaderObj.cache[seq]?.[f - 1]) {
      loaderObj.loadFrame(seq, f - 1).catch(() => {});
    }

    // Transitions between sequences:
    const nextCh = CHAPTERS[chIdx + 1];
    if (nextCh) {
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
  const isRtl = document.documentElement.getAttribute('dir') === 'rtl' ||
                document.body.getAttribute('dir') === 'rtl';

  CHAPTERS.forEach((ch, idx) => {
    const el = _textEls.get(ch.id);
    if (!el) return;

    let opacity = 0;

    if (ch.id === activeCh.id) {
      const fIn = 0.12, fOut = 0.88;
      if (idx === 0) {
        // Scene 1: fade in immediately, fade out near end
        opacity = localP > 0.80 ? 1 - (localP - 0.80) / 0.20 : 1;
      } else if (idx === CHAPTERS.length - 1) {
        // Last scene: fade in and hold
        opacity = localP < fIn ? localP / fIn : 1;
      } else {
        if (localP < fIn)        { opacity = localP / fIn; }
        else if (localP > fOut)  { opacity = 1 - (localP - fOut) / (1 - fOut); }
        else                     { opacity = 1; }
      }
    }

    const clamped = Math.max(0, Math.min(1, opacity));

    // Horizontal slide ONLY — all text cards enter from the sides (never from top or bottom)
    const isLeft  = el.classList.contains('left-text');
    const isRight = el.classList.contains('right-text');

    let xPx = 0;
    if (clamped < 1) {
      const dist = 75 * (1 - clamped);
      if (isLeft) {
        xPx = isRtl ? dist : -dist;
      } else if (isRight) {
        xPx = isRtl ? -dist : dist;
      } else {
        // Center text (Scene 1, Scene R, Scene 7) — enters smoothly from side
        const dir = (idx % 2 === 0) ? -1 : 1;
        xPx = dir * dist * (isRtl ? -1 : 1);
      }
    }

    el.style.setProperty('--x', xPx.toFixed(1) + 'px');
    el.style.removeProperty('--y');
    el.style.opacity       = clamped.toFixed(3);
    el.style.pointerEvents = clamped > 0.5 ? 'auto' : 'none';
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

  // Interactive Launch button in Scene 7
  const btnLaunch = document.getElementById('btn-replay-launch');
  if (btnLaunch) {
    btnLaunch.addEventListener('click', (e) => {
      e.preventDefault();
      playLaunchAnimation(true);
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
