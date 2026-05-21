/**
 * AR Lens — camera behind alpha overlay video
 */

const CONFIG = {
  overlayVideos: {
    webm: 'assets/videos/Foreground_Cats_with_Supers1.webm',
    hevc: 'assets/videos/Foreground_Cats_with_Supers_hevc1.mov',
  },
  countdownSeconds: 3,
  defaultFacingMode: 'user',
};

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
  errorScreen: $('#error-screen'),
  errorMessage: $('#error-message'),
  errorRetry: $('#error-retry'),
  statusPill: $('#status-pill'),
  cameraToggle: $('#camera-toggle'),
  cameraToggleLabel: $('#camera-toggle-label'),
  capturePreview: $('#capture-preview'),
  capturePreviewImg: $('#capture-preview-img'),
  capturePreviewHint: $('#capture-preview-hint'),
  capturePreviewClose: $('#capture-preview-close'),
};

const state = {
  cameraReady: false,
  overlayReady: false,
  experienceStarted: false,
  isPlaying: false,
  countdownActive: false,
  countdownTimerId: null,
  cameraStream: null,
  facingMode: CONFIG.defaultFacingMode,
  isSwitchingCamera: false,
};

function isIOS() {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isSafariLike() {
  return isIOS() || /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

function applyVideoAttrs(video) {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
}

function buildVideoConstraints(facingMode) {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

async function getCameraStream(facingMode) {
  const attempts = [
    buildVideoConstraints(facingMode),
    { audio: false, video: { facingMode } },
    { audio: false, video: true },
  ];

  let lastErr;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function updateLoadingUI(message) {
  if (message) els.loadingMessage.textContent = message;
  const done = (state.cameraReady ? 1 : 0) + (state.overlayReady ? 1 : 0);
  els.loadingBar.style.width = `${(done / 2) * 100}%`;
}

function tryFinishLoading() {
  if (!state.cameraReady || !state.overlayReady) return;
  updateLoadingUI('Ready');
  startExperience();
}

function showError(message) {
  els.loadingScreen.classList.add('is-hidden');
  els.errorMessage.textContent = message;
  els.errorScreen.hidden = false;
}

function hideError() {
  els.errorScreen.hidden = true;
}

function showStatus(text, { playing = false } = {}) {
  if (!els.statusPill) return;
  els.statusPill.textContent = text;
  els.statusPill.hidden = false;
  els.statusPill.classList.add('is-visible');
  els.statusPill.classList.toggle('is-playing', playing);
}

function hideStatus() {
  if (!els.statusPill) return;
  els.statusPill.classList.remove('is-visible', 'is-playing');
  els.statusPill.hidden = true;
}

function drawCover(ctx, source, cw, ch, mirror = false) {
  const iw = source.videoWidth || 0;
  const ih = source.videoHeight || 0;
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

function waitForMedia(video, label) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
      else reject(new Error(`${label} load timed out`));
    }, 30000);

    const done = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      cleanup();
      const msg = video.error?.message || 'unknown error';
      reject(new Error(`${label} failed: ${msg}`));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('canplay', done);
      video.removeEventListener('error', fail);
    };

    video.addEventListener('loadedmetadata', done, { once: true });
    video.addEventListener('canplay', done, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

function setupOverlayElement() {
  const { webm, hevc } = CONFIG.overlayVideos;
  applyVideoAttrs(els.overlayVideo);
  els.overlayVideo.loop = false;
  els.overlayVideo.preload = 'auto';

  els.overlayVideo.replaceChildren();
  els.overlayVideo.removeAttribute('src');

  if (isSafariLike()) {
    els.overlayVideo.src = hevc;
    els.overlayVideo.setAttribute('type', 'video/mp4; codecs="hvc1"');
  } else {
    const w = document.createElement('source');
    w.src = webm;
    w.type = 'video/webm; codecs="vp9"';
    const h = document.createElement('source');
    h.src = hevc;
    h.type = 'video/mp4; codecs="hvc1"';
    els.overlayVideo.append(w, h);
  }

  els.overlayVideo.load();
}

async function initOverlayVideo() {
  updateLoadingUI('Loading overlay…');
  setupOverlayElement();
  await waitForMedia(els.overlayVideo, 'Overlay video');
  els.overlayVideo.pause();
  try {
    els.overlayVideo.currentTime = 0;
  } catch {
    /* ignore */
  }
  state.overlayReady = true;
  updateLoadingUI('Overlay ready');
  tryFinishLoading();
}

async function attachCameraStream(stream) {
  state.cameraStream = stream;
  els.video.srcObject = stream;
  applyVideoAttrs(els.video);
  applyMirrorForFacing();

  await new Promise((resolve, reject) => {
    const onReady = () => {
      els.video.removeEventListener('loadedmetadata', onReady);
      els.video.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      els.video.removeEventListener('loadedmetadata', onReady);
      els.video.removeEventListener('error', onErr);
      reject(new Error('Camera preview failed'));
    };
    if (els.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    els.video.addEventListener('loadedmetadata', onReady);
    els.video.addEventListener('error', onErr);
  });

  try {
    await els.video.play();
  } catch {
    /* may need Play tap on iOS */
  }
}

async function initCamera() {
  updateLoadingUI('Starting camera…');

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera needs HTTPS (use ngrok) and a modern browser.');
  }

  const stream = await getCameraStream(state.facingMode);
  await attachCameraStream(stream);

  state.cameraReady = true;
  updateLoadingUI('Camera ready');
  updateCameraToggleUI();
  checkMultiCameraSupport();
  tryFinishLoading();
}

function applyMirrorForFacing() {
  els.video.classList.toggle('is-mirrored', state.facingMode === 'user');
}

function updateCameraToggleUI() {
  if (!els.cameraToggle) return;
  const front = state.facingMode === 'user';
  els.cameraToggleLabel.textContent = front ? 'Front' : 'Back';
  els.cameraToggle.setAttribute('aria-label', front ? 'Switch to back camera' : 'Switch to front camera');
}

async function checkMultiCameraSupport() {
  if (!els.cameraToggle) return;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput'
    );
    els.cameraToggle.hidden = cams.length < 2;
  } catch {
    els.cameraToggle.hidden = false;
  }
}

function showPlaybackControls() {
  els.playbackControls.hidden = false;
  updatePlaybackButtons();
}

function updatePlaybackButtons() {
  els.btnPlay.disabled = state.countdownActive || state.isPlaying;
  els.btnPause.disabled = !state.isPlaying;
}

function showCountdown(n) {
  els.countdown.hidden = false;
  els.countdownNumber.textContent = String(n);
  els.countdownNumber.style.animation = 'none';
  void els.countdownNumber.offsetWidth;
  els.countdownNumber.style.animation = '';
}

function hideCountdown() {
  els.countdown.hidden = true;
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

/**
 * iOS/Safari only allow play() inside the same user gesture. Call this synchronously
 * when Play is tapped, before the countdown timer fires.
 */
function unlockMediaOnUserGesture() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);

  void els.video.play().catch(() => {});

  void els.overlayVideo
    .play()
    .then(() => {
      els.overlayVideo.pause();
      try {
        els.overlayVideo.currentTime = 0;
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
}

async function playBothVideos() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);

  if (els.overlayVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForMedia(els.overlayVideo, 'Overlay');
  }

  els.overlayVideo.pause();
  try {
    els.overlayVideo.currentTime = 0;
  } catch {
    /* ignore */
  }

  const results = await Promise.allSettled([els.video.play(), els.overlayVideo.play()]);

  if (results[0].status === 'rejected') {
    console.warn('[AR Lens] camera play:', results[0].reason);
  }
  if (results[1].status === 'rejected') {
    throw new Error('Overlay would not play — tap Play again.');
  }
}

function startCountdownThenPlay() {
  if (state.countdownActive || state.isPlaying) return;

  state.countdownActive = true;
  updatePlaybackButtons();

  let n = CONFIG.countdownSeconds;
  showCountdown(n);
  showStatus('Starting in…', { playing: true });

  state.countdownTimerId = setInterval(() => {
    n -= 1;
    if (n > 0) {
      showCountdown(n);
    } else {
      cancelCountdown();
      void runPlayback();
    }
  }, 1000);
}

async function runPlayback() {
  try {
    await playBothVideos();
    state.isPlaying = true;
    updatePlaybackButtons();
    showStatus('Playing…', { playing: true });
  } catch (err) {
    console.error('[AR Lens]', err);
    showStatus(err.message || 'Play failed');
    setTimeout(hideStatus, 3000);
  }
}

function pausePlayback() {
  cancelCountdown();
  els.overlayVideo.pause();
  state.isPlaying = false;
  updatePlaybackButtons();
  showStatus('Paused');
  setTimeout(hideStatus, 1200);
}

function drawComposite() {
  const ctx = els.captureCanvas.getContext('2d');
  const w = els.captureCanvas.width;
  const h = els.captureCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (els.video.videoWidth) {
    drawCover(ctx, els.video, w, h, state.facingMode === 'user');
  }
  if (els.overlayVideo.videoWidth) {
    drawCover(ctx, els.overlayVideo, w, h);
  }
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      try {
        fetch(canvas.toDataURL('image/png'))
          .then((r) => r.blob())
          .then(resolve)
          .catch(() => resolve(null));
      } catch {
        resolve(null);
      }
    }, 'image/png');
  });
}

function hideCapturePreview() {
  els.capturePreview.hidden = true;
  if (els.capturePreviewImg?.src?.startsWith('blob:')) {
    URL.revokeObjectURL(els.capturePreviewImg.src);
    els.capturePreviewImg.removeAttribute('src');
  }
}

function showCapturePreview(blob) {
  const url = URL.createObjectURL(blob);
  els.capturePreviewImg.src = url;
  els.capturePreviewHint.textContent = isIOS()
    ? 'Long-press the image → Save to Photos'
    : 'Right-click or long-press to save';
  els.capturePreview.hidden = false;
}

async function savePhoto(blob) {
  const file = new File([blob], `ar-lens-${Date.now()}.png`, { type: 'image/png' });

  if (navigator.share?.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  if (!isIOS()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  showCapturePreview(blob);
}

async function onOverlayEnded() {
  state.isPlaying = false;
  els.overlayVideo.pause();
  updatePlaybackButtons();

  resizeCaptureCanvas();
  drawComposite();
  const blob = await canvasToPngBlob(els.captureCanvas);
  if (blob) {
    await savePhoto(blob);
    showStatus('Photo saved — tap Play to replay');
    setTimeout(hideStatus, 4000);
  }
}

function onPlayPressed() {
  if (state.countdownActive || state.isPlaying) return;
  unlockMediaOnUserGesture();
  startCountdownThenPlay();
}

function bindPlaybackControls() {
  let playHandled = false;

  const onPlay = (e) => {
    e.preventDefault();
    if (playHandled) {
      playHandled = false;
      return;
    }
    onPlayPressed();
  };

  els.btnPlay.addEventListener(
    'touchend',
    (e) => {
      playHandled = true;
      onPlay(e);
    },
    { passive: false }
  );
  els.btnPlay.addEventListener('click', onPlay);
  els.btnPause.addEventListener('click', () => pausePlayback());
}

function startExperience() {
  if (state.experienceStarted) return;
  state.experienceStarted = true;
  els.loadingScreen.classList.add('is-hidden');
  showPlaybackControls();
  showStatus('Tap Play');
  setTimeout(hideStatus, 2000);
}

async function switchCamera() {
  if (state.isSwitchingCamera || !state.cameraReady) return;
  state.isSwitchingCamera = true;
  els.cameraToggle.disabled = true;

  const prev = state.facingMode;
  const next = prev === 'user' ? 'environment' : 'user';

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }

  try {
    const stream = await getCameraStream(next);
    state.facingMode = next;
    await attachCameraStream(stream);
    updateCameraToggleUI();
    showStatus(next === 'user' ? 'Front camera' : 'Back camera');
    setTimeout(hideStatus, 1200);
  } catch (err) {
    console.warn('[AR Lens] switch failed', err);
    try {
      const stream = await getCameraStream(prev);
      state.facingMode = prev;
      await attachCameraStream(stream);
    } catch {
      /* empty */
    }
  } finally {
    state.isSwitchingCamera = false;
    els.cameraToggle.disabled = false;
  }
}


async function boot() {
  hideError();
  state.cameraReady = false;
  state.overlayReady = false;
  state.experienceStarted = false;
  cancelCountdown();
  state.isPlaying = false;

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }

  els.loadingScreen.classList.remove('is-hidden');
  els.loadingBar.style.width = '0%';
  els.playbackControls.hidden = true;

  try {
    await Promise.all([initCamera(), initOverlayVideo()]);
  } catch (err) {
    console.error('[AR Lens]', err);
    showError(err.message || 'Something went wrong.');
  }
}

function init() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);
  els.overlayVideo.addEventListener('ended', onOverlayEnded);

  bindPlaybackControls();
  els.capturePreviewClose?.addEventListener('click', hideCapturePreview);
  els.cameraToggle?.addEventListener('click', () => switchCamera());
  els.errorRetry?.addEventListener('click', () => boot());
  window.addEventListener('resize', resizeCaptureCanvas);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.cameraStream) {
      els.video.play().catch(() => {});
    }
  });
  resizeCaptureCanvas();
  boot();
}

init();
