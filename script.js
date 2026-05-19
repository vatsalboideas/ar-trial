/**
 * AR Lens — Snapchat-style camera + Lottie overlay + on-screen controls
 * Vanilla JS | lottie-web | MediaPipe Hands (peace sign ✌️)
 */

// ---------------------------------------------------------------------------
// Configuration — replace Lottie path with your own animation JSON
// ---------------------------------------------------------------------------
const CONFIG = {
  /** Placeholder — swap with your LottieFiles export */
  lottiePath: 'assets/lottie/cat-walking.json',
  lottieLoop: true,
  lottieAutoplay: false,

  /** Countdown shown before the cat starts walking (seconds) */
  countdownSeconds: 5,

  /** Horizontal walk: left edge → right edge (seconds) */
  walkDurationSeconds: 10,
  /** Flip cat to face walking direction (toggle if it looks backwards) */
  catFaceRight: false,

  /** Peace sign (✌️) starts one walk cycle; runs until finished */
  enablePeaceGesture: true,

  /** Min gap between index & middle tips (normalized) for a V shape */
  peaceMinFingerSpread: 0.05,

  /** Gesture smoothing — consecutive frames required to flip state */
  peaceOnFrames: 3,
  peaceOffFrames: 4,

  /** MediaPipe — process every Nth frame on mobile for FPS */
  handProcessInterval: 2,

  /** Swipe detection (bonus) */
  swipeMinDistance: 72,
  swipeMaxDuration: 450,

  /** Camera constraints — front camera, mobile-friendly resolution */
  videoConstraints: {
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
  },
};

// MediaPipe finger chains (tip / pip / mcp landmark indices)
const FINGERS = {
  index: { tip: 8, pip: 6, mcp: 5 },
  middle: { tip: 12, pip: 10, mcp: 9 },
  ring: { tip: 16, pip: 14, mcp: 13 },
  pinky: { tip: 20, pip: 18, mcp: 17 },
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const els = {
  video: $('#camera-feed'),
  lottieDock: $('#lottie-dock'),
  lottieWalker: $('#lottie-walker'),
  lottieContainer: $('#lottie-container'),
  playbackControls: $('#playback-controls'),
  btnPlay: $('#btn-play'),
  btnPause: $('#btn-pause'),
  handsCanvas: $('#hands-canvas'),
  loadingScreen: $('#loading-screen'),
  loadingMessage: $('#loading-message'),
  loadingBar: $('#loading-bar'),
  tapStart: $('#tap-start'),
  errorScreen: $('#error-screen'),
  errorMessage: $('#error-message'),
  errorRetry: $('#error-retry'),
  gestureHint: $('#gesture-hint'),
  statusPill: $('#status-pill'),
  countdown: $('#countdown'),
  countdownNumber: $('#countdown-number'),
};

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  cameraReady: false,
  mediapipeReady: false,
  lottieReady: false,
  experienceStarted: false,
  isPeaceSign: false,
  isAnimationPlaying: false,
  peaceOnCount: 0,
  peaceOffCount: 0,
  frameCount: 0,
  hands: null,
  lottieAnim: null,
  walkCompleted: false,
  cycleInProgress: false,
  countdownActive: false,
  countdownTimerId: null,
  cameraStream: null,
  rafId: null,
  lastSwipe: { x: 0, y: 0, t: 0 },
  currentEffectIndex: 0,
};

/** Optional effect list for swipe — add more Lottie paths here */
const EFFECT_PATHS = [CONFIG.lottiePath];

// ---------------------------------------------------------------------------
// Loading progress tracker
// ---------------------------------------------------------------------------
const loadingSteps = {
  camera: false,
  mediapipe: false,
  lottie: false,
};

function updateLoadingUI(message) {
  if (message) els.loadingMessage.textContent = message;
  const done = Object.values(loadingSteps).filter(Boolean).length;
  const total = Object.keys(loadingSteps).length;
  els.loadingBar.style.width = `${(done / total) * 100}%`;
}

function checkAllLoaded() {
  const needsHands = CONFIG.enablePeaceGesture;
  if (!loadingSteps.camera || !loadingSteps.lottie) return;
  if (needsHands && !loadingSteps.mediapipe) return;

  updateLoadingUI('Ready');
  els.loadingScreen.classList.add('is-hidden');
  els.lottieDock.classList.add('is-ready');
  els.lottieWalker?.classList.add('is-ready');
  els.lottieContainer.classList.add('is-ready');
  if (CONFIG.catFaceRight) els.lottieContainer.classList.add('is-facing-right');
  showPlaybackControls();

  if (needsTapToStart()) {
    els.tapStart.hidden = false;
  } else {
    startExperience();
  }
}

function needsTapToStart() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
function showError(message) {
  els.loadingScreen.classList.add('is-hidden');
  els.tapStart.hidden = true;
  els.errorMessage.textContent = message;
  els.errorScreen.hidden = false;
}

function hideError() {
  els.errorScreen.hidden = true;
}

// ---------------------------------------------------------------------------
// Camera initialization
// ---------------------------------------------------------------------------
async function initCamera() {
  updateLoadingUI('Initializing camera…');

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera API is not supported on this device. Try Chrome or Safari on a phone with HTTPS.'
    );
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(CONFIG.videoConstraints);
    state.cameraStream = stream;
    els.video.srcObject = stream;

    await new Promise((resolve, reject) => {
      els.video.onloadedmetadata = () => {
        els.video.play().then(resolve).catch(reject);
      };
      els.video.onerror = () => reject(new Error('Video playback failed.'));
    });

    // Size hidden canvas for MediaPipe (lower res = better FPS)
    const scale = Math.min(1, 480 / Math.max(els.video.videoWidth, els.video.videoHeight));
    els.handsCanvas.width = Math.round(els.video.videoWidth * scale);
    els.handsCanvas.height = Math.round(els.video.videoHeight * scale);

    state.cameraReady = true;
    loadingSteps.camera = true;
    updateLoadingUI('Camera ready');
    checkAllLoaded();
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error(
        'Camera permission was denied. Allow camera access in your browser settings and reload.'
      );
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No front camera found on this device.');
    }
    if (err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
      throw new Error('Camera is in use by another app or not available right now.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lottie overlay — autoplay off, loop on, transparent background
// ---------------------------------------------------------------------------
function loadLottie(path = CONFIG.lottiePath, { initial = false } = {}) {
  return new Promise((resolve, reject) => {
    if (initial) updateLoadingUI('Loading animation…');

    if (state.lottieAnim) {
      state.lottieAnim.destroy();
      state.lottieAnim = null;
    }

    state.lottieAnim = lottie.loadAnimation({
      container: els.lottieContainer,
      renderer: 'svg',
      loop: CONFIG.lottieLoop,
      autoplay: CONFIG.lottieAutoplay,
      path,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: true,
        hideOnTransparent: true,
      },
    });

    state.lottieAnim.addEventListener('DOMLoaded', () => {
      if (initial) {
        loadingSteps.lottie = true;
        state.lottieReady = true;
        updateLoadingUI('Animation loaded');
        checkAllLoaded();
      }
      resolve();
    });

    state.lottieAnim.addEventListener('data_failed', () => {
      reject(new Error(`Failed to load Lottie file: ${path}`));
    });
  });
}

function setStatusPill(text, { playing = false } = {}) {
  if (!els.statusPill) return;
  els.statusPill.textContent = text;
  els.statusPill.hidden = false;
  els.statusPill.classList.add('is-visible');
  els.statusPill.classList.toggle('is-playing', playing);
}

function hideStatusPill() {
  if (!els.statusPill) return;
  els.statusPill.classList.remove('is-visible', 'is-playing');
  els.statusPill.hidden = true;
}

function applyWalkDuration() {
  els.lottieContainer.style.setProperty('--walk-duration', `${CONFIG.walkDurationSeconds}s`);
}

function resetWalkPosition() {
  const cat = els.lottieContainer;
  cat.classList.remove('is-walking', 'is-playing');
  cat.style.animationPlayState = '';
  cat.style.left = '';
  state.walkCompleted = false;
}

function startWalk() {
  const cat = els.lottieContainer;
  resetWalkPosition();
  applyWalkDuration();
  void cat.offsetWidth;
  cat.classList.add('is-walking', 'is-playing');
}

function onWalkAnimationEnd() {
  state.walkCompleted = true;
  state.cycleInProgress = false;
  els.lottieContainer.classList.remove('is-walking');
  pauseLottie({ keepPosition: true });
  setStatusPill('Show ✌️ to walk again');
}

function showCountdown(n) {
  if (!els.countdown || !els.countdownNumber) return;
  els.countdown.hidden = false;
  els.countdownNumber.textContent = String(n);
  els.countdownNumber.style.animation = 'none';
  void els.countdownNumber.offsetWidth;
  els.countdownNumber.style.animation = '';
}

function hideCountdown() {
  if (!els.countdown) return;
  els.countdown.hidden = true;
}

function cancelCountdown() {
  if (state.countdownTimerId) {
    clearInterval(state.countdownTimerId);
    state.countdownTimerId = null;
  }
  state.countdownActive = false;
  hideCountdown();
}

function startCountdownThenWalk() {
  if (state.cycleInProgress || state.countdownActive) return;

  state.cycleInProgress = true;
  state.countdownActive = true;

  if (state.walkCompleted) resetWalkPosition();

  let remaining = CONFIG.countdownSeconds;
  showCountdown(remaining);
  setStatusPill('Starting in…', { playing: true });
  updatePlaybackButtons();

  state.countdownTimerId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      showCountdown(remaining);
    } else {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
      state.countdownActive = false;
      hideCountdown();
      beginWalk();
    }
  }, 1000);
}

function beginWalk() {
  startWalk();
  if (state.lottieAnim) state.lottieAnim.play();
  state.isAnimationPlaying = true;
  setStatusPill('Walking…', { playing: true });
  updatePlaybackButtons();
}

function playLottie() {
  if (!state.lottieAnim || state.cycleInProgress) return;
  startCountdownThenWalk();
}

function pauseLottie({ keepPosition = false, force = false } = {}) {
  if (!state.lottieAnim) return;
  if (state.cycleInProgress && !force) return;
  if (!state.isAnimationPlaying && !keepPosition && !state.countdownActive) return;

  cancelCountdown();
  state.lottieAnim.pause();
  state.isAnimationPlaying = false;
  state.cycleInProgress = false;
  els.lottieContainer.style.animationPlayState = 'paused';
  els.lottieContainer.classList.remove('is-playing');

  if (!keepPosition && CONFIG.enablePeaceGesture && state.experienceStarted) {
    setStatusPill('Show ✌️ to play');
  } else if (!keepPosition) {
    hideStatusPill();
  }
  updatePlaybackButtons();
}

function showPlaybackControls() {
  els.playbackControls.hidden = false;
  updatePlaybackButtons();
}

function updatePlaybackButtons() {
  els.btnPlay.disabled = state.cycleInProgress;
  els.btnPause.disabled = !state.cycleInProgress;
}

function bindPlaybackControls() {
  els.btnPlay.addEventListener('click', () => playLottie());
  els.btnPause.addEventListener('click', () => pauseLottie({ force: true }));
}

function bindWalkAnimation() {
  els.lottieContainer.addEventListener('animationend', (e) => {
    if (e.animationName === 'cat-walk-across') onWalkAnimationEnd();
  });
}

// ---------------------------------------------------------------------------
// MediaPipe Hands — peace sign (✌️) detection
// ---------------------------------------------------------------------------
function initMediaPipe() {
  return new Promise((resolve, reject) => {
    updateLoadingUI('Loading hand tracking…');

    if (typeof Hands === 'undefined') {
      reject(new Error('MediaPipe Hands failed to load. Check your network connection.'));
      return;
    }

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onHandResults);

    const onReady = () => {
      state.hands = hands;
      loadingSteps.mediapipe = true;
      state.mediapipeReady = true;
      updateLoadingUI('Hand tracking ready');
      checkAllLoaded();
      resolve();
    };

    if (typeof hands.initialize === 'function') {
      hands.initialize().then(onReady).catch(reject);
    } else {
      onReady();
    }
  });
}

/** Euclidean distance between two normalized landmarks */
function landmarkDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Finger extended when tip is above PIP and PIP above MCP (y grows downward). */
function isFingerExtended(landmarks, { tip, pip, mcp }) {
  const tipLm = landmarks[tip];
  const pipLm = landmarks[pip];
  const mcpLm = landmarks[mcp];
  const margin = 0.015;
  return tipLm.y < pipLm.y - margin && pipLm.y < mcpLm.y - margin;
}

/** Peace sign: index + middle up, ring + pinky down, fingers spread in a V. */
function detectPeaceSign(landmarks) {
  const indexUp = isFingerExtended(landmarks, FINGERS.index);
  const middleUp = isFingerExtended(landmarks, FINGERS.middle);
  const ringDown = !isFingerExtended(landmarks, FINGERS.ring);
  const pinkyDown = !isFingerExtended(landmarks, FINGERS.pinky);
  const spread = landmarkDistance(landmarks[FINGERS.index.tip], landmarks[FINGERS.middle.tip]);
  const spreadOk = spread >= CONFIG.peaceMinFingerSpread;

  return indexUp && middleUp && ringDown && pinkyDown && spreadOk;
}

/** Debounced peace-sign — starts one cycle; lowering hand does not stop it */
function updatePeaceState(rawPeace) {
  if (rawPeace) {
    state.peaceOnCount++;
    state.peaceOffCount = 0;
    if (!state.isPeaceSign && state.peaceOnCount >= CONFIG.peaceOnFrames) {
      state.isPeaceSign = true;
      if (!state.cycleInProgress && !state.countdownActive) {
        playLottie();
      }
    }
  } else {
    state.peaceOffCount++;
    state.peaceOnCount = 0;
    if (state.isPeaceSign && state.peaceOffCount >= CONFIG.peaceOffFrames) {
      state.isPeaceSign = false;
    }
  }
}

function onHandResults(results) {
  if (!CONFIG.enablePeaceGesture || !state.experienceStarted) return;

  const landmarks = results.multiHandLandmarks?.[0];
  if (!landmarks) {
    updatePeaceState(false);
    return;
  }

  updatePeaceState(detectPeaceSign(landmarks));
}

/** Send video frames to MediaPipe (throttled for mobile FPS) */
async function processHandFrame() {
  if (!CONFIG.enablePeaceGesture || !state.experienceStarted || !state.hands || !state.cameraReady) return;

  state.frameCount++;
  if (state.frameCount % CONFIG.handProcessInterval !== 0) return;

  const ctx = els.handsCanvas.getContext('2d', { alpha: false });
  ctx.drawImage(els.video, 0, 0, els.handsCanvas.width, els.handsCanvas.height);

  try {
    await state.hands.send({ image: els.handsCanvas });
  } catch {
    /* skip frame on transient errors */
  }
}

function startHandLoop() {
  const loop = async () => {
    await processHandFrame();
    state.rafId = requestAnimationFrame(loop);
  };
  state.rafId = requestAnimationFrame(loop);
}

function stopHandLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

// ---------------------------------------------------------------------------
// Experience lifecycle
// ---------------------------------------------------------------------------
function startExperience() {
  if (state.experienceStarted) return;
  state.experienceStarted = true;
  els.tapStart.hidden = true;
  showPlaybackControls();

  if (CONFIG.enablePeaceGesture) {
    setStatusPill('Show ✌️ to play');
    if (els.gestureHint) {
      els.gestureHint.hidden = false;
      setTimeout(() => {
        els.gestureHint.hidden = true;
      }, 5000);
    }
    startHandLoop();
  }
}

// ---------------------------------------------------------------------------
// Bonus: swipe gesture to cycle effects (optional)
// ---------------------------------------------------------------------------
function initSwipeGestures() {
  let startX = 0;
  let startY = 0;
  let startTime = 0;

  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
  };

  const onTouchEnd = (e) => {
    if (!state.experienceStarted || EFFECT_PATHS.length < 2) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startTime;

    if (dt > CONFIG.swipeMaxDuration) return;
    if (Math.abs(dx) < CONFIG.swipeMinDistance) return;
    if (Math.abs(dx) < Math.abs(dy)) return; // horizontal swipe only

    if (dx > 0) {
      cycleEffect(1);
    } else {
      cycleEffect(-1);
    }
  };

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
}

async function cycleEffect(direction) {
  state.currentEffectIndex =
    (state.currentEffectIndex + direction + EFFECT_PATHS.length) % EFFECT_PATHS.length;

  const wasPlaying = state.isAnimationPlaying;
  pauseLottie();
  resetWalkPosition();
  state.cycleInProgress = false;
  state.isPeaceSign = false;
  state.peaceOnCount = 0;
  state.peaceOffCount = 0;

  try {
    await loadLottie(EFFECT_PATHS[state.currentEffectIndex], { initial: false });
    els.lottieWalker?.classList.add('is-ready');
    els.lottieContainer.classList.add('is-ready');
    if (wasPlaying) playLottie();
  } catch {
    console.warn('[AR Lens] Effect swap failed');
  }
}

// ---------------------------------------------------------------------------
// Tap-to-start (iOS / autoplay policy fallback)
// ---------------------------------------------------------------------------
function bindTapToStart() {
  els.tapStart.addEventListener('click', async () => {
    try {
      await els.video.play();
    } catch {
      /* already playing or blocked */
    }
    startExperience();
  });
}

// ---------------------------------------------------------------------------
// Cleanup on page hide / retry
// ---------------------------------------------------------------------------
function teardown() {
  stopHandLoop();
  cancelCountdown();
  state.cycleInProgress = false;
  resetWalkPosition();
  if (state.lottieAnim) {
    state.lottieAnim.destroy();
    state.lottieAnim = null;
  }
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  state.experienceStarted = false;
  Object.keys(loadingSteps).forEach((k) => {
    loadingSteps[k] = false;
  });
}

async function boot() {
  hideError();
  els.loadingScreen.classList.remove('is-hidden');
  els.loadingBar.style.width = '0%';

  try {
    const loaders = [initCamera(), loadLottie(CONFIG.lottiePath, { initial: true })];
    if (CONFIG.enablePeaceGesture) {
      loaders.push(initMediaPipe());
    } else {
      loadingSteps.mediapipe = true;
    }
    await Promise.all(loaders);
  } catch (err) {
    console.error('[AR Lens]', err);
    showError(err.message || 'Something went wrong. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Visibility / battery — pause processing when tab hidden
// ---------------------------------------------------------------------------
function initVisibilityHandling() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHandLoop();
      pauseLottie({ force: true });
    } else if (state.experienceStarted && CONFIG.enablePeaceGesture) {
      startHandLoop();
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function init() {
  applyWalkDuration();
  bindWalkAnimation();
  bindTapToStart();
  bindPlaybackControls();
  initSwipeGestures();
  initVisibilityHandling();

  els.errorRetry.addEventListener('click', () => {
    teardown();
    boot();
  });

  resetWalkPosition();
  if (state.lottieAnim) state.lottieAnim.pause();

  boot();
}

init();
