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
    webm: 'assets/videos/Foreground_Cats_with_Supers.webm',
    hevc: 'assets/videos/Foreground_Cats_with_Supers_hevc.mov',
  },

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

function waitForVideoReady(video, { label = 'video' } = {}) {
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

    const tryPlay = () => {
      // Autoplay may be blocked until tap — that must not block the loading screen.
      video.play().catch(() => {}).finally(() => finish());
    };

    const onUsable = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      tryPlay();
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
        tryPlay();
        return;
      }
      finish(
        new Error(
          `${label} timed out. Check your network or re-export the overlay (WebM / HEVC).`
        )
      );
    }, 30000);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      tryPlay();
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
  els.overlayVideo.load();
  await waitForVideoReady(els.overlayVideo, { label: 'overlay' });
  loadingSteps.overlayVideo = true;
  updateLoadingUI('Overlay ready');
  checkAllLoaded();
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
}

function bindTapToStart() {
  els.tapStart.addEventListener('click', async () => {
    await Promise.all(
      [els.video, els.overlayVideo].map((v) =>
        v.play().catch(() => {
          /* already playing or blocked */
        })
      )
    );
    startExperience();
  });
}

function teardown() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  state.experienceStarted = false;
  state.facingMode = CONFIG.defaultFacingMode;
  state.isSwitchingCamera = false;
  if (els.cameraToggle) {
    els.cameraToggle.hidden = true;
    els.cameraToggle.disabled = false;
    els.cameraToggle.classList.remove('is-switching');
  }
  els.video.classList.remove('is-mirrored');
  if (els.overlayVideo) {
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
      els.overlayVideo?.pause();
    } else if (state.experienceStarted || !needsTapToStart()) {
      els.overlayVideo?.play().catch(() => {});
      els.video?.play().catch(() => {});
    }
  });
}

function init() {
  bindTapToStart();
  bindCameraToggle();
  initVisibilityHandling();

  els.errorRetry.addEventListener('click', () => {
    teardown();
    boot();
  });

  boot();
}

init();
