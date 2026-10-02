/**
 * main.js
 * BMW M4 Fan Concept — The Art of Power
 * Orchestrator: Lenis smooth scroll, GSAP ScrollTrigger, Canvas image-sequence rendering,
 * Web Audio synchronization, i18n, and progressive preloading.
 */

import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { detectRealFrameCounts, ProgressiveLoader } from './frameLoader.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { AudioManager } from './audioManager.js';
import { I18n } from './i18n.js';

gsap.registerPlugin(ScrollTrigger);

/* ─────────────────────────────────────────────
   CONSTANTS & TIMELINE CONFIG
───────────────────────────────────────────── */
const MOBILE_BREAKPOINT = 768;
const CROSSFADE_FRAMES = 6;

// 8 Timeline chapters across one continuous 900vh scroll
const CHAPTERS = [
  { id: 'scene-1', seq: 1, name: 's1', start: 0.000, end: 0.125, isReverse: false },
  { id: 'scene-2', seq: 2, name: 's2', start: 0.125, end: 0.250, isReverse: false },
  { id: 'scene-3', seq: 3, name: 's3', start: 0.250, end: 0.375, isReverse: false },
  { id: 'scene-r', seq: 'r', name: 'reverse', start: 0.375, end: 0.520, isReverse: true },
  { id: 'scene-4', seq: 4, name: 's4', start: 0.520, end: 0.640, isReverse: false },
  { id: 'scene-5', seq: 5, name: 's5', start: 0.640, end: 0.760, isReverse: false },
  { id: 'scene-6', seq: 6, name: 's6', start: 0.760, end: 0.880, isReverse: false },
  { id: 'scene-7', seq: 7, name: 's7', start: 0.880, end: 1.000, isReverse: false },
];

/* ─────────────────────────────────────────────
   GLOBAL STATE
───────────────────────────────────────────── */
let isMobile = window.innerWidth < MOBILE_BREAKPOINT;
let frameCounts = { 1: 192, 2: 192, 3: 192, 4: 240, 5: 240, 6: 240, 7: 192 };
let progressiveLoader;
let renderer;
let audio;
let i18n;
let lenis;
let statsAnimated = false;
let experienceActive = false;

/* ─────────────────────────────────────────────
   DOM REFERENCES
───────────────────────────────────────────── */
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');
const loaderPct = document.getElementById('loader-pct');
const loaderLabel = document.getElementById('loader-label');
const entryScreen = document.getElementById('entry-screen');
const experience = document.getElementById('experience');
const canvas = document.getElementById('main-canvas');
const progressLine = document.getElementById('progress-line');
const btnSound = document.getElementById('btn-sound');
const btnNoSound = document.getElementById('btn-no-sound');
const btnLang = document.getElementById('btn-lang');
const btnMute = document.getElementById('btn-mute');
const langLabel = document.getElementById('lang-label');
const scrollContainer = document.getElementById('scroll-container');

/* ─────────────────────────────────────────────
   INITIALIZATION
───────────────────────────────────────────── */
async function init() {
  isMobile = window.innerWidth < MOBILE_BREAKPOINT;

  // 1. Probe & cache actual frame counts automatically
  loaderLabel.textContent = 'Analyzing assets…';
  frameCounts = await detectRealFrameCounts(isMobile);

  // 2. Initialize subsystems
  progressiveLoader = new ProgressiveLoader(frameCounts, isMobile);
  renderer = new CanvasRenderer(canvas);
  audio = new AudioManager();
  i18n = new I18n();

  // 3. Preload section 1 for seamless entrance
  loaderLabel.textContent = 'Loading experience…';
  let loadedFrames = 0;
  const s1Count = frameCounts[1];

  await progressiveLoader.loadSection(1, () => {
    loadedFrames++;
    const pct = Math.min(100, Math.round((loadedFrames / s1Count) * 100));
    loaderFill.style.width = `${pct}%`;
    loaderPct.textContent = `${pct}%`;
  });

  // Render initial frame immediately
  const firstFrame = progressiveLoader.getFrame(1, 1);
  if (firstFrame) {
    renderer.setFrame(firstFrame);
  }

  // 4. Background preloading of sequences 2..7
  preloadRemainingSequences();

  // 5. Reveal entry screen
  loaderEl.classList.add('fade-out');
  setTimeout(() => loaderEl.classList.add('hidden'), 650);

  // 6. Hook up entry buttons
  btnSound.addEventListener('click', () => enterExperience(true));
  btnNoSound.addEventListener('click', () => enterExperience(false));
}

async function preloadRemainingSequences() {
  const seqs = [2, 3, 4, 5, 6, 7];
  for (const seq of seqs) {
    await progressiveLoader.loadSection(seq, null, 6);
    // Yield to main thread
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

/* ─────────────────────────────────────────────
   ENTER EXPERIENCE
───────────────────────────────────────────── */
async function enterExperience(withSound) {
  if (experienceActive) return;
  experienceActive = true;

  // Initialize audio post user click
  await audio.init(withSound);
  if (withSound) {
    await Promise.all([
      audio.loadTrack('teardown', '/audio/teardown.mp3'),
      audio.loadTrack('engine', '/audio/engine_dive.mp3'),
      audio.loadTrack('launch', '/audio/launch.mp3'),
    ]);
  }

  // Transition UI
  entryScreen.classList.add('fade-out');
  setTimeout(() => entryScreen.classList.add('hidden'), 800);
  experience.classList.remove('hidden');

  // Allow scrolling
  document.body.style.overflow = '';

  // Setup height (900vh total)
  scrollContainer.style.height = '900vh';

  // Setup smooth scroll & ScrollTrigger
  setupLenis();
  setupTimelineScrubber();
  setupControls(withSound);

  // Trigger initial frame
  updateTimeline(0);
}

/* ─────────────────────────────────────────────
   LENIS SMOOTH SCROLL
───────────────────────────────────────────── */
function setupLenis() {
  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 0.9,
    touchMultiplier: 1.4,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ─────────────────────────────────────────────
   MASTER TIMELINE SCRUBBER
───────────────────────────────────────────── */
function setupTimelineScrubber() {
  ScrollTrigger.create({
    trigger: '#scroll-container',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      updateTimeline(self.progress);
    },
  });
}

function updateTimeline(progress) {
  const p = Math.max(0, Math.min(1, progress));

  // Update vertical amber progress line
  if (progressLine) {
    progressLine.style.height = `${p * 100}%`;
  }

  // 1. Identify active chapter
  let activeChapter = CHAPTERS[0];
  let activeIndex = 0;

  for (let i = 0; i < CHAPTERS.length; i++) {
    if (p >= CHAPTERS[i].start && p <= CHAPTERS[i].end) {
      activeChapter = CHAPTERS[i];
      activeIndex = i;
      break;
    }
  }
  if (p > CHAPTERS[CHAPTERS.length - 1].end) {
    activeChapter = CHAPTERS[CHAPTERS.length - 1];
    activeIndex = CHAPTERS.length - 1;
  }

  const duration = activeChapter.end - activeChapter.start;
  const localP = duration > 0 ? Math.max(0, Math.min(1, (p - activeChapter.start) / duration)) : 0;

  // 2. Render Canvas Frames with Cross-fade Logic
  renderChapterFrame(activeChapter, activeIndex, localP);

  // 3. Audio Synchronization
  syncAudio(activeChapter, localP);

  // 4. Text Card Transitions
  updateTextOverlays(activeChapter, activeIndex, localP);

  // 5. Stat Counter Triggering
  if (activeChapter.id === 'scene-3') {
    if (localP >= 0.1 && !statsAnimated) {
      statsAnimated = true;
      animateStatCounters();
    }
  } else if (p < 0.2) {
    // Reset counter if user scrolls back near top
    statsAnimated = false;
  }
}

/* ─────────────────────────────────────────────
   CANVAS FRAME RENDERING WITH CROSS-FADE
───────────────────────────────────────────── */
function renderChapterFrame(chapter, chapterIndex, localP) {
  let currentBmp = null;
  let nextBmp = null;
  let crossAlpha = 0;

  if (chapter.seq === 'r') {
    // REASSEMBLY: s3 reverse then s2 reverse
    const s3Count = frameCounts[3] || 192;
    const s2Count = frameCounts[2] || 192;

    if (localP < 0.5) {
      // First half: s3 in reverse (s3Count down to 1)
      const subP = localP / 0.5;
      const fNum = Math.max(1, Math.min(s3Count, Math.round((1 - subP) * (s3Count - 1)) + 1));
      currentBmp = progressiveLoader.getFrame(3, fNum);

      // Cross-fade to s2 reverse near midpoint
      if (subP > 0.9) {
        crossAlpha = (subP - 0.9) / 0.1;
        nextBmp = progressiveLoader.getFrame(2, s2Count);
      }
    } else {
      // Second half: s2 in reverse (s2Count down to 1)
      const subP = (localP - 0.5) / 0.5;
      const fNum = Math.max(1, Math.min(s2Count, Math.round((1 - subP) * (s2Count - 1)) + 1));
      currentBmp = progressiveLoader.getFrame(2, fNum);

      // Cross-fade to s4 at end
      if (subP > 0.9) {
        crossAlpha = (subP - 0.9) / 0.1;
        nextBmp = progressiveLoader.getFrame(4, 1);
      }
    }
  } else {
    // STANDARD SEQUENCE (s1, s2, s3, s4, s5, s6, s7)
    const seq = chapter.seq;
    const count = frameCounts[seq] || 192;
    const frameIdx = Math.max(1, Math.min(count, Math.round(localP * (count - 1)) + 1));
    currentBmp = progressiveLoader.getFrame(seq, frameIdx);

    // Cross-fade 6 frames before chapter boundary
    const fadeStart = 1 - CROSSFADE_FRAMES / count;
    if (localP > fadeStart && chapterIndex < CHAPTERS.length - 1) {
      crossAlpha = (localP - fadeStart) / (CROSSFADE_FRAMES / count);
      const nextChapter = CHAPTERS[chapterIndex + 1];

      if (nextChapter.seq === 'r') {
        // Reassembly begins with s3's final frame
        nextBmp = progressiveLoader.getFrame(3, frameCounts[3] || 192);
      } else {
        nextBmp = progressiveLoader.getFrame(nextChapter.seq, 1);
      }
    }
  }

  renderer.setFrame(currentBmp, nextBmp, crossAlpha);
}

/* ─────────────────────────────────────────────
   AUDIO SYNCHRONIZATION
───────────────────────────────────────────── */
function syncAudio(chapter, localP) {
  switch (chapter.id) {
    case 'scene-2':
      // s2: teardown.mp3 synced to scroll
      audio.playTrack('teardown', { loop: true, volume: 0.25 + 0.75 * localP });
      audio.stopTrack('engine', 0.2);
      audio.stopTrack('launch', 0.2);
      break;

    case 'scene-3':
      // s3: engine_dive.mp3 synced to scroll
      audio.playTrack('engine', { loop: true, volume: 0.3 + 0.7 * localP });
      audio.stopTrack('teardown', 0.2);
      audio.stopTrack('launch', 0.2);
      break;

    case 'scene-r':
      // Reassembly: audio muted or very low
      audio.setVolume('teardown', 0.05);
      audio.setVolume('engine', 0.05);
      audio.stopTrack('launch', 0.2);
      break;

    case 'scene-7':
      // s7: launch.mp3 with volume and playbackRate rising with scroll
      audio.playTrack('launch', { loop: false, volume: Math.min(1.0, 0.2 + localP * 0.8) });
      audio.setVolume('launch', Math.min(1.0, 0.2 + localP * 0.8));
      audio.setPlaybackRate('launch', 0.8 + localP * 0.6);
      audio.stopTrack('teardown', 0.2);
      audio.stopTrack('engine', 0.2);
      break;

    default:
      // s1, s4, s5, s6: fade out ambient engine/teardown/launch
      audio.stopTrack('teardown', 0.4);
      audio.stopTrack('engine', 0.4);
      audio.stopTrack('launch', 0.4);
      break;
  }
}

/* ─────────────────────────────────────────────
   TEXT OVERLAY OPACITY & TRANSFORMS
───────────────────────────────────────────── */
function updateTextOverlays(activeChapter, activeIndex, localP) {
  CHAPTERS.forEach((ch, idx) => {
    const el = document.querySelector(`#${ch.id} .scene-text`);
    if (!el) return;

    if (ch.id === activeChapter.id) {
      let opacity = 1;
      let y = 0;

      if (idx === 0) {
        // First scene starts fully visible, fades out near end
        if (localP > 0.75) {
          opacity = 1 - (localP - 0.75) / 0.25;
          y = -24 * (1 - opacity);
        }
      } else if (idx === CHAPTERS.length - 1) {
        // Last scene fades in, stays visible for CTA
        if (localP < 0.2) {
          opacity = localP / 0.2;
          y = 24 * (1 - opacity);
        }
      } else {
        // Intermediate scenes fade in and fade out
        if (localP < 0.15) {
          opacity = localP / 0.15;
          y = 24 * (1 - opacity);
        } else if (localP > 0.85) {
          opacity = 1 - (localP - 0.85) / 0.15;
          y = -24 * (1 - opacity);
        }
      }

      const clampedOp = Math.max(0, Math.min(1, opacity));
      el.style.opacity = clampedOp.toFixed(3);
      el.style.setProperty('--y', `${y.toFixed(1)}px`);
      el.style.pointerEvents = clampedOp > 0.6 ? 'auto' : 'none';
    } else {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    }
  });
}

/* ─────────────────────────────────────────────
   STAT COUNTERS ANIMATION
───────────────────────────────────────────── */
function animateStatCounters() {
  const statEls = document.querySelectorAll('.stat-num[data-target]');
  statEls.forEach((el) => {
    const target = parseFloat(el.dataset.target);
    const suffix = el.dataset.suffix || '';
    const isDecimal = !!el.dataset.decimal;

    gsap.to(
      { val: 0 },
      {
        val: target,
        duration: 1.6,
        ease: 'power2.out',
        onUpdate() {
          const v = this.targets()[0].val;
          el.textContent = isDecimal
            ? (v / 10).toFixed(1) + suffix
            : Math.round(v) + suffix;
        },
      }
    );
  });
}

/* ─────────────────────────────────────────────
   HEADER CONTROLS (I18N & SOUND)
───────────────────────────────────────────── */
function setupControls(withSound) {
  // Language toggle
  if (btnLang) {
    btnLang.addEventListener('click', () => {
      const newLang = i18n.toggle();
      if (langLabel) {
        langLabel.textContent = newLang === 'en' ? 'AR' : 'EN';
      }
    });
  }

  // Sound toggle button
  if (btnMute) {
    if (!withSound) {
      btnMute.style.opacity = '0.35';
    }

    btnMute.addEventListener('click', () => {
      const isMuted = audio.toggleMute();
      const waves = document.getElementById('sound-waves');
      if (waves) {
        waves.style.opacity = isMuted ? '0.2' : '1.0';
      }
      btnMute.style.opacity = isMuted ? '0.45' : '1.0';
    });
  }
}

/* ─────────────────────────────────────────────
   BOOTSTRAP & EVENT LISTENERS
───────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  document.body.style.overflow = 'hidden';
  init().catch(console.error);
});

// Handle viewport resize: switch between mobile and desktop assets if threshold crossed
window.addEventListener('resize', () => {
  const nowMobile = window.innerWidth < MOBILE_BREAKPOINT;
  if (nowMobile !== isMobile) {
    isMobile = nowMobile;
    if (progressiveLoader) {
      progressiveLoader.mobile = isMobile;
      progressiveLoader.cache = {}; // Invalidate old bitmaps
      progressiveLoader.loadSection(1).catch(() => {});
    }
  }
});
