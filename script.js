/**
 * AR Lens — live camera behind a transparent (alpha) overlay video
 * Vanilla JS
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  /** Alpha overlay — converted exports (not the huge ProRes .mov) */
  overlayVideos: {
    webm: 'assets/videos/Foreground_Cats_with_Supers1.webm',
    hevc: 'assets/videos/Foreground_Cats_with_Supers_hevc1.mov',
  },

  /** Countdown seconds before overlay plays */
  countdownSeconds: 3,

  /** Default facing mode — 'user' (front) or 'environment' (back) */
  defaultFacingMode: 'user',

  videoBase: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};

function buildVideoConstraints(facingMode) {
  return {
    audio: false,
    video: {
      ...CONFIG.videoBase,
      facingMode: { ideal: facingMode },
    },
  };
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const els = {
  video: $('#camera-feed'),
  overlayVideo: $('#overlay-video'),
  captureCanvas: $('#capture-canvas'),
  playbackControls: $('#playback-controls'),
  btnPlay: $('#btn-play'),
  btnPause: $('#btn-pause'),
  countdown: $('#countdown'),
  countdownNumber: $('#countdown-number'),
  loadingScreen: $('#loading-screen'),
  loadingMessage: $('#loading-message'),
  loadingBar: $('#loading-bar'),
  tapStart: $('#tap-start'),
  errorScreen: $('#error-screen'),
  errorMessage: $('#error-message'),
  errorRetry: $('#error-retry'),
  statusPill: $('#status-pill'),
  cameraToggle: $('#camera-toggle'),
  cameraToggleLabel: $('#camera-toggle-label'),
};

const state = {
  cameraReady: false,
  experienceStarted: false,
  isPlaying: false,
  countdownActive: false,
  countdownTimerId: null,
  cameraStream: null,
  facingMode: CONFIG.defaultFacingMode,
  isSwitchingCamera: false,
};

const loadingSteps = {
  camera: false,
  overlayVideo: false,
};

function updateLoadingUI(message) {
  if (message) els.loadingMessage.textContent = message;
  const done = Object.values(loadingSteps).filter(Boolean).length;
  const total = Object.keys(loadingSteps).length;
  els.loadingBar.style.width = `${(done / total) * 100}%`;
}

function checkAllLoaded() {
  if (!loadingSteps.camera || !loadingSteps.overlayVideo) return;

  updateLoadingUI('Ready');
  els.loadingScreen.classList.add('is-hidden');
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

/** Safari / iOS prefers HEVC .mov; Chrome & others prefer WebM. */
function isSafariLike() {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua))
  );
}

function getOverlaySources() {
  const { webm, hevc } = CONFIG.overlayVideos;
  const webmSource = { src: webm, type: 'video/webm' };
  const hevcSource = { src: hevc, type: 'video/quicktime' };
  return isSafariLike() ? [hevcSource, webmSource] : [webmSource, hevcSource];
}

function showError(message) {
  els.loadingScreen.classList.add('is-hidden');
  els.tapStart.hidden = true;
  els.errorMessage.textContent = message;
  els.errorScreen.hidden = false;
}

function hideError() {
  els.errorScreen.hidden = true;
}

/** Draw image/video with object-fit: cover */
function drawCover(ctx, source, cw, ch, { mirror = false } = {}) {
  const iw = source.videoWidth || source.width || 0;
  const ih = source.videoHeight || source.height || 0;
  if (!iw || !ih) return;

  const scale = Math.max(cw / iw, ch / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  const dx = (cw - sw) / 2;
  const dy = (ch - sh) / 2;

  ctx.save();
  if (mirror) {
    ctx.translate(dx + sw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, sw, sh);
  } else {
    ctx.drawImage(source, dx, dy, sw, sh);
  }
  ctx.restore();
}

function resizeCaptureCanvas() {
  if (!els.captureCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.captureCanvas.width = Math.round(window.innerWidth * dpr);
  els.captureCanvas.height = Math.round(window.innerHeight * dpr);
}

function waitForVideoReady(video, { label = 'video', autoplay = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    const tryFinish = () => {
      if (autoplay) {
        video.play().catch(() => {}).finally(() => finish());
      } else {
        finish();
      }
    };

    const onUsable = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      tryFinish();
    };

    const onError = () => {
      const code = video.error?.code;
      const detail = video.error?.message || `code ${code ?? 'unknown'}`;
      finish(
        new Error(
          `Failed to load ${label}: ${video.currentSrc || video.src} (${detail}). ` +
            'Safari supports HEVC/ProRes .mov; Chrome needs WebM with alpha.'
        )
      );
    };

    const cleanup = () => {
      video.removeEventListener('loadeddata', onUsable);
      video.removeEventListener('canplay', onUsable);
      video.removeEventListener('error', onError);
    };

    const timer = setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        tryFinish();
        return;
      }
      finish(
        new Error(
          `${label} timed out. Check your network or re-export the overlay (WebM / HEVC).`
        )
      );
    }, 30000);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      tryFinish();
      return;
    }

    video.addEventListener('loadeddata', onUsable);
    video.addEventListener('canplay', onUsable);
    video.addEventListener('error', onError);
  });
}

async function initOverlayVideo() {
  const sources = getOverlaySources();
  if (!sources.length || !sources[0]?.src) {
    throw new Error('Set CONFIG.overlayVideos.webm and .hevc paths.');
  }

  updateLoadingUI('Loading overlay…');
  els.overlayVideo.replaceChildren();
  for (const { src, type } of sources) {
    const source = document.createElement('source');
    source.src = src;
    source.type = type;
    els.overlayVideo.append(source);
  }
  els.overlayVideo.loop = false;
  els.overlayVideo.load();
  await waitForVideoReady(els.overlayVideo, { label: 'overlay', autoplay: false });
  els.overlayVideo.pause();
  els.overlayVideo.currentTime = 0;
  els.overlayVideo.addEventListener('ended', onOverlayEnded);
  loadingSteps.overlayVideo = true;
  updateLoadingUI('Overlay ready');
  checkAllLoaded();
}

// ---------------------------------------------------------------------------
// Playback — 3s countdown, play once, PNG capture at end
// ---------------------------------------------------------------------------
function showPlaybackControls() {
  if (els.playbackControls) els.playbackControls.hidden = false;
  updatePlaybackButtons();
}

function updatePlaybackButtons() {
  if (!els.btnPlay || !els.btnPause) return;
  els.btnPlay.disabled = state.countdownActive || state.isPlaying;
  els.btnPause.disabled = !state.isPlaying;
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
  if (els.countdown) els.countdown.hidden = true;
}

function cancelCountdown() {
  if (state.countdownTimerId) {
    clearInterval(state.countdownTimerId);
    state.countdownTimerId = null;
  }
  state.countdownActive = false;
  hideCountdown();
  updatePlaybackButtons();
}

function startCountdownThenPlay() {
  if (state.countdownActive || state.isPlaying) return;

  cancelCountdown();
  state.countdownActive = true;
  updatePlaybackButtons();

  let remaining = CONFIG.countdownSeconds;
  showCountdown(remaining);
  setStatusPill('Starting in…', { playing: true });

  state.countdownTimerId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      showCountdown(remaining);
    } else {
      cancelCountdown();
      beginPlayback();
    }
  }, 1000);
}

async function beginPlayback() {
  if (!els.overlayVideo) return;

  els.overlayVideo.pause();
  els.overlayVideo.currentTime = 0;

  try {
    await els.overlayVideo.play();
  } catch {
    setStatusPill('Tap Play to start');
    updatePlaybackButtons();
    return;
  }

  state.isPlaying = true;
  updatePlaybackButtons();
  setStatusPill('Playing…', { playing: true });
}

function pausePlayback() {
  cancelCountdown();
  els.overlayVideo?.pause();
  state.isPlaying = false;
  updatePlaybackButtons();
  setStatusPill('Paused');
  setTimeout(hideStatusPill, 1200);
}

function drawCompositeToCaptureCanvas() {
  if (!els.captureCanvas) return;
  const ctx = els.captureCanvas.getContext('2d');
  const w = els.captureCanvas.width;
  const h = els.captureCanvas.height;
  ctx.clearRect(0, 0, w, h);
  drawCover(ctx, els.video, w, h, { mirror: state.facingMode === 'user' });
  drawCover(ctx, els.overlayVideo, w, h);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function captureCompositeSnapshot() {
  resizeCaptureCanvas();
  drawCompositeToCaptureCanvas();

  const blob = await new Promise((resolve) => {
    els.captureCanvas.toBlob((b) => resolve(b), 'image/png');
  });

  if (blob) {
    downloadBlob(blob, `ar-lens-${Date.now()}.png`);
  }
}

async function onOverlayEnded() {
  state.isPlaying = false;
  drawCompositeToCaptureCanvas();
  await captureCompositeSnapshot();

  updatePlaybackButtons();
  setStatusPill('Photo saved — tap Play to replay');
  setTimeout(hideStatusPill, 4000);
}

function bindPlaybackControls() {
  els.btnPlay?.addEventListener('click', () => startCountdownThenPlay());
  els.btnPause?.addEventListener('click', () => pausePlayback());
}

function applyMirrorForFacing() {
  els.video.classList.toggle('is-mirrored', state.facingMode === 'user');
}

function updateCameraToggleUI() {
  if (!els.cameraToggle) return;
  const isFront = state.facingMode === 'user';
  if (els.cameraToggleLabel) {
    els.cameraToggleLabel.textContent = isFront ? 'Front' : 'Back';
  }
  els.cameraToggle.setAttribute(
    'aria-label',
    isFront ? 'Switch to back camera' : 'Switch to front camera'
  );
}

function attachStream(stream) {
  return new Promise((resolve, reject) => {
    state.cameraStream = stream;
    els.video.srcObject = stream;

    const cleanup = () => {
      els.video.removeEventListener('loadedmetadata', onMeta);
      els.video.removeEventListener('error', onError);
    };

    const onMeta = () => {
      els.video
        .play()
        .then(() => {
          applyMirrorForFacing();
          cleanup();
          resolve();
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    };

    const onError = () => {
      cleanup();
      reject(new Error('Video playback failed.'));
    };

    els.video.addEventListener('loadedmetadata', onMeta);
    els.video.addEventListener('error', onError);
  });
}

async function initCamera() {
  updateLoadingUI('Initializing camera…');

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera API is not supported on this device. Try Chrome or Safari on a phone with HTTPS.'
    );
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      buildVideoConstraints(state.facingMode)
    );
    await attachStream(stream);

    state.cameraReady = true;
    loadingSteps.camera = true;
    updateLoadingUI('Camera ready');
    updateCameraToggleUI();
    checkMultiCameraSupport();
    checkAllLoaded();
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error(
        'Camera permission was denied. Allow camera access in your browser settings and reload.'
      );
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No camera found on this device.');
    }
    if (err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
      throw new Error('Camera is in use by another app or not available right now.');
    }
    throw err;
  }
}

async function checkMultiCameraSupport() {
  if (!els.cameraToggle) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    if (cams.length > 1) {
      els.cameraToggle.hidden = false;
    }
  } catch {
    els.cameraToggle.hidden = false;
  }
}

async function switchCamera() {
  if (state.isSwitchingCamera || !state.cameraReady) return;
  state.isSwitchingCamera = true;

  if (els.cameraToggle) {
    els.cameraToggle.disabled = true;
    els.cameraToggle.classList.add('is-switching');
  }

  const previous = state.facingMode;
  const next = previous === 'user' ? 'environment' : 'user';

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildVideoConstraints(next));
    state.facingMode = next;
    await attachStream(stream);
    updateCameraToggleUI();
    setStatusPill(next === 'user' ? 'Front camera' : 'Back camera');
    setTimeout(hideStatusPill, 1200);
  } catch (err) {
    console.warn('[AR Lens] Camera switch failed:', err);
    setStatusPill('Camera switch unavailable');
    setTimeout(hideStatusPill, 1600);
    try {
      const restore = await navigator.mediaDevices.getUserMedia(
        buildVideoConstraints(previous)
      );
      state.facingMode = previous;
      await attachStream(restore);
      updateCameraToggleUI();
    } catch {
      /* leave video blank */
    }
  } finally {
    state.isSwitchingCamera = false;
    if (els.cameraToggle) {
      els.cameraToggle.disabled = false;
      els.cameraToggle.classList.remove('is-switching');
    }
  }
}

function bindCameraToggle() {
  if (!els.cameraToggle) return;
  els.cameraToggle.addEventListener('click', () => switchCamera());
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

function startExperience() {
  if (state.experienceStarted) return;
  state.experienceStarted = true;
  els.tapStart.hidden = true;
  showPlaybackControls();
  els.video.play().catch(() => {});
}

function bindTapToStart() {
  els.tapStart.addEventListener('click', async () => {
    await els.video.play().catch(() => {});
    startExperience();
  });
}

function teardown() {
  cancelCountdown();
  pausePlayback();
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  state.experienceStarted = false;
  state.isPlaying = false;
  state.facingMode = CONFIG.defaultFacingMode;
  state.isSwitchingCamera = false;
  if (els.cameraToggle) {
    els.cameraToggle.hidden = true;
    els.cameraToggle.disabled = false;
    els.cameraToggle.classList.remove('is-switching');
  }
  els.video.classList.remove('is-mirrored');
  if (els.overlayVideo) {
    els.overlayVideo.removeEventListener('ended', onOverlayEnded);
    els.overlayVideo.pause();
    els.overlayVideo.replaceChildren();
    els.overlayVideo.load();
  }
  Object.keys(loadingSteps).forEach((k) => {
    loadingSteps[k] = false;
  });
}

async function boot() {
  hideError();
  els.loadingScreen.classList.remove('is-hidden');
  els.loadingBar.style.width = '0%';

  try {
    // Camera first, then overlay — clearer progress and reliable checkAllLoaded.
    await initCamera();
    await initOverlayVideo();
  } catch (err) {
    console.error('[AR Lens]', err);
    showError(err.message || 'Something went wrong. Please try again.');
  }
}

function initVisibilityHandling() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.isPlaying) pausePlayback();
    } else {
      els.video?.play().catch(() => {});
    }
  });
}

function init() {
  bindTapToStart();
  bindPlaybackControls();
  bindCameraToggle();
  initVisibilityHandling();
  window.addEventListener('resize', resizeCaptureCanvas);

  els.errorRetry.addEventListener('click', () => {
    teardown();
    window.removeEventListener('resize', resizeCaptureCanvas);
    boot();
  });

  resizeCaptureCanvas();
  boot();
}

init();
