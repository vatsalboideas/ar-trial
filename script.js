/**
 * AR Lens — camera behind alpha overlay video
 */

const CONFIG = {
  overlayVideos: {
    webm: '/assets/videos/Foreground_Cats_with_Supers1.webm',
    mp4Hevc: '/assets/videos/Foreground_Cats_with_Supers_hevc1.mp4',
    movHevc: '/assets/videos/Foreground_Cats_with_Supers_hevc1.mov',
  },
  imageKit: {
    publicKey: 'public_zDPUKTrbaVb4wztH1nh1OOotP6M=',
    urlEndpoint: 'https://ik.imagekit.io/aazbrhbeib',
    authEndpoint: '/api/imagekit/auth',
    scheduleDeleteEndpoint: '/api/imagekit/schedule-delete',
    qrVisibleSeconds: 40,
  },
  countdownSeconds: 3,
  defaultFacingMode: 'environment',
  defaultResolutionPreset: '4k',
};

const RESOLUTION_PRESETS = {
  hd: { label: 'HD', width: 1280, height: 720 },
  fullhd: { label: 'Full HD', width: 1920, height: 1080 },
  '2k': { label: '2K', width: 2560, height: 1440 },
  '4k': { label: '4K', width: 3840, height: 2160 },
};

const $ = (sel) => document.querySelector(sel);

const els = {
  video: $('#camera-feed'),
  overlayVideo: $('#overlay-video'),
  renderCanvas: $('#render-canvas'),
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
  loadingStart: $('#loading-start'),
  statusPill: $('#status-pill'),
  controlsPanel: $('.controls-panel'),
  controlsContent: $('#controls-content'),
  controlsToggle: $('#controls-toggle'),
  controlsOpen: $('#controls-open'),
  cameraSelectWrap: $('#camera-select-wrap'),
  cameraSelect: $('#camera-select'),
  cameraResolution: $('#camera-resolution'),
  mirrorToggle: $('#mirror-toggle'),
  capturePreview: $('#capture-preview'),
  capturePreviewImg: $('#capture-preview-img'),
  capturePreviewHint: $('#capture-preview-hint'),
  capturePreviewClose: $('#capture-preview-close'),
  uploadQr: $('#upload-qr'),
  uploadQrCode: $('#upload-qr-code'),
  uploadQrLink: $('#upload-qr-link'),
  uploadQrTimer: $('#upload-qr-timer'),
};

const state = {
  cameraReady: false,
  overlayReady: false,
  experienceStarted: false,
  isPlaying: false,
  countdownActive: false,
  countdownTimerId: null,
  cameraStream: null,
  availableCameras: [],
  selectedDeviceId: '',
  cameraResolutionPreset: CONFIG.defaultResolutionPreset,
  mirrorEnabled: false,
  bootStarted: false,
  overlayHasNativeAlpha: false,
  renderLoopId: 0,
  isSwitchingCamera: false,
  controlsCollapsed: false,
  handGestureEnabled: false,
  handGestureBusy: false,
  handGestureLoopId: 0,
  handGestureLastTriggerAt: 0,
  handGestureDetector: null,
  handWavePoints: [],
  handWaveLastDirection: 0,
  qrCountdownIntervalId: null,
  qrHideTimeoutId: null,
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

/** Safari / iOS WebKit need a user tap before camera + programmatic video play. */
function needsGestureStart() {
  return isSafariLike();
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

function canPlayMimeType(mime) {
  const probe = document.createElement('video');
  const support = probe.canPlayType(mime);
  return support === 'probably' || support === 'maybe';
}

function getOverlayCandidates() {
  const { webm, mp4Hevc, movHevc } = CONFIG.overlayVideos;
  const candidates = [];

  const pushUnique = (url) => {
    if (!url || candidates.includes(url)) return;
    candidates.push(url);
  };

  // iOS Safari does not support WebM alpha decoding.
  if (isSafariLike()) {
    pushUnique(movHevc);
    pushUnique(mp4Hevc);
    pushUnique(webm);
    return candidates;
  }

  if (canPlayMimeType('video/webm')) pushUnique(webm);
  if (canPlayMimeType('video/mp4; codecs="hvc1"')) pushUnique(mp4Hevc);
  if (canPlayMimeType('video/quicktime')) pushUnique(movHevc);

  // Last-resort fallback chain even if canPlayType is conservative.
  pushUnique(webm);
  pushUnique(mp4Hevc);
  pushUnique(movHevc);
  return candidates;
}

function getSelectedResolution() {
  const preset = RESOLUTION_PRESETS[state.cameraResolutionPreset];
  return preset || RESOLUTION_PRESETS[CONFIG.defaultResolutionPreset];
}

function buildResolutionConstraints() {
  const { width, height } = getSelectedResolution();
  return {
    width: { ideal: width, max: width },
    height: { ideal: height, max: height },
    frameRate: { ideal: 60, min: 24 },
  };
}

function formatStreamResolution(track) {
  const settings = track?.getSettings?.();
  const w = settings?.width;
  const h = settings?.height;
  if (w && h) return `${w}×${h}`;
  return getSelectedResolution().label;
}

function buildVideoConstraints(facingMode) {
  const resolution = buildResolutionConstraints();
  const videoConstraints = {
    resizeMode: 'crop-and-scale',
    ...resolution,
  };

  if (state.selectedDeviceId) {
    videoConstraints.deviceId = { exact: state.selectedDeviceId };
    return { audio: false, video: videoConstraints };
  }

  videoConstraints.facingMode = { ideal: facingMode };
  return {
    audio: false,
    video: videoConstraints,
  };
}

async function getCameraStream(facingMode) {
  const resolution = buildResolutionConstraints();
  const attempts = [];
  if (state.selectedDeviceId) {
    attempts.push({
      audio: false,
      video: {
        deviceId: { exact: state.selectedDeviceId },
        resizeMode: 'crop-and-scale',
        ...resolution,
      },
    });
  }
  attempts.push(buildVideoConstraints(facingMode));
  attempts.push({
    audio: false,
    video: { facingMode: { ideal: facingMode }, resizeMode: 'crop-and-scale', ...resolution },
  });
  attempts.push({ audio: false, video: { facingMode } });
  attempts.push({ audio: false, video: true });

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

function resetWaveTracking() {
  state.handWavePoints = [];
  state.handWaveLastDirection = 0;
}

function isPlayWaveGesture(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 1) {
    resetWaveTracking();
    return false;
  }

  const wrist = landmarks[0];
  if (!wrist || !Number.isFinite(wrist.x)) {
    resetWaveTracking();
    return false;
  }

  const now = Date.now();
  state.handWavePoints.push({ x: wrist.x, t: now });
  const windowMs = 900;
  state.handWavePoints = state.handWavePoints.filter((p) => now - p.t <= windowMs);
  if (state.handWavePoints.length < 6) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  let directionChanges = 0;
  const directionDeltaThreshold = 0.012;

  for (let i = 0; i < state.handWavePoints.length; i += 1) {
    const point = state.handWavePoints[i];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (i === 0) continue;

    const dx = point.x - state.handWavePoints[i - 1].x;
    if (Math.abs(dx) < directionDeltaThreshold) continue;
    const direction = dx > 0 ? 1 : -1;
    if (state.handWaveLastDirection && direction !== state.handWaveLastDirection) {
      directionChanges += 1;
    }
    state.handWaveLastDirection = direction;
  }

  const horizontalSpan = maxX - minX;
  const hasStrongWave = horizontalSpan > 0.2 && directionChanges >= 2;
  if (hasStrongWave) {
    resetWaveTracking();
    return true;
  }
  return false;
}

function stopHandGestureLoop() {
  if (state.handGestureLoopId) {
    cancelAnimationFrame(state.handGestureLoopId);
    state.handGestureLoopId = 0;
  }
}

function onHandGestureResults(results) {
  if (!state.handGestureEnabled) return;
  if (!state.experienceStarted || state.countdownActive || state.isPlaying) return;
  if (Date.now() - state.handGestureLastTriggerAt < 2200) return;

  const hand = results?.multiHandLandmarks?.[0];
  if (!hand) {
    resetWaveTracking();
    return;
  }
  if (!isPlayWaveGesture(hand)) return;

  state.handGestureLastTriggerAt = Date.now();
  showStatus('Gesture detected · starting', { playing: true });
  onPlayPressed();
}

function startHandGestureLoop() {
  if (!state.handGestureEnabled || !state.handGestureDetector) return;
  stopHandGestureLoop();

  const tick = async () => {
    if (!state.handGestureEnabled || !state.handGestureDetector) {
      state.handGestureLoopId = 0;
      return;
    }

    if (!state.handGestureBusy && state.cameraReady && els.video?.videoWidth > 0) {
      state.handGestureBusy = true;
      try {
        await state.handGestureDetector.send({ image: els.video });
      } catch {
        /* ignore transient detector errors */
      } finally {
        state.handGestureBusy = false;
      }
    }

    state.handGestureLoopId = requestAnimationFrame(tick);
  };

  state.handGestureLoopId = requestAnimationFrame(tick);
}

function initHandGesturePlay() {
  if (typeof Hands !== 'function') return;
  try {
    const detector = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    detector.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    detector.onResults(onHandGestureResults);
    state.handGestureDetector = detector;
    state.handGestureEnabled = true;
    showStatus('Wave hand to play');
    setTimeout(hideStatus, 1600);
  } catch {
    state.handGestureEnabled = false;
  }
}

function resizeCaptureCanvas() {
  if (!els.captureCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.captureCanvas.width = Math.round(window.innerWidth * dpr);
  els.captureCanvas.height = Math.round(window.innerHeight * dpr);
}

function resizeRenderCanvas() {
  if (!els.renderCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.renderCanvas.width = Math.round(window.innerWidth * dpr);
  els.renderCanvas.height = Math.round(window.innerHeight * dpr);
}

function useCanvasOverlayRendering() {
  return !state.overlayHasNativeAlpha && isSafariLike();
}

function clearRenderCanvas() {
  if (!els.renderCanvas) return;
  const ctx = els.renderCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, els.renderCanvas.width, els.renderCanvas.height);
}

function stopRenderLoop() {
  if (state.renderLoopId) {
    cancelAnimationFrame(state.renderLoopId);
    state.renderLoopId = 0;
  }
}

function drawKeyedOverlayFrame() {
  if (!useCanvasOverlayRendering() || !els.renderCanvas || !els.overlayVideo.videoWidth) {
    return;
  }

  // During preroll countdown, keep overlay hidden.
  if (els.overlayVideo.classList.contains('is-preroll')) {
    clearRenderCanvas();
    return;
  }

  const ctx = els.renderCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const w = els.renderCanvas.width;
  const h = els.renderCanvas.height;
  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);
  drawCover(ctx, els.overlayVideo, w, h);

  // Remove near-black background to emulate transparency on HEVC fallback.
  const frame = ctx.getImageData(0, 0, w, h);
  const data = frame.data;
  const blackCutoff = 16;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] <= blackCutoff && data[i + 1] <= blackCutoff && data[i + 2] <= blackCutoff) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

function startRenderLoop() {
  if (!useCanvasOverlayRendering()) return;
  stopRenderLoop();
  const tick = () => {
    drawKeyedOverlayFrame();
    if (!els.overlayVideo.paused && !els.overlayVideo.ended) {
      state.renderLoopId = requestAnimationFrame(tick);
    } else {
      state.renderLoopId = 0;
    }
  };
  state.renderLoopId = requestAnimationFrame(tick);
}

function isMediaReady(video) {
  return video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0;
}

function waitForMedia(video, label) {
  return new Promise((resolve, reject) => {
    if (isMediaReady(video)) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (isMediaReady(video)) resolve();
      else reject(new Error(`${label} load timed out`));
    }, 30000);

    const done = () => {
      if (!isMediaReady(video)) return;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      cleanup();
      const code = video.error?.code;
      const msg = video.error?.message || 'unknown error';
      reject(new Error(`${label} failed (${code ?? '?'}): ${msg}`));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('canplay', done);
      video.removeEventListener('canplaythrough', done);
      video.removeEventListener('error', fail);
    };

    video.addEventListener('loadedmetadata', done);
    video.addEventListener('loadeddata', done);
    video.addEventListener('canplay', done);
    video.addEventListener('canplaythrough', done);
    video.addEventListener('error', fail, { once: true });
  });
}

function setOverlaySrc(url) {
  els.overlayVideo.replaceChildren();
  els.overlayVideo.removeAttribute('src');
  els.overlayVideo.src = url;
  els.overlayVideo.load();
}

async function initOverlayVideo() {
  updateLoadingUI('Loading overlay…');
  applyVideoAttrs(els.overlayVideo);
  els.overlayVideo.loop = false;
  els.overlayVideo.preload = 'auto';

  const candidates = getOverlayCandidates();
  let loaded = false;
  let lastErr = null;
  let selectedSrc = '';

  for (const src of candidates) {
    try {
      setOverlaySrc(src);
      await waitForMedia(els.overlayVideo, 'Overlay video');
      selectedSrc = src;
      loaded = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!loaded) {
    throw (
      lastErr ||
      new Error('Unable to load any compatible overlay video format for this browser.')
    );
  }

  state.overlayHasNativeAlpha = /\.webm($|\?)/i.test(selectedSrc);
  const useCanvas = useCanvasOverlayRendering();
  els.overlayVideo.classList.toggle('is-canvas-rendered', useCanvas);
  if (els.renderCanvas) {
    els.renderCanvas.hidden = !useCanvas;
    if (useCanvas) {
      resizeRenderCanvas();
      clearRenderCanvas();
    }
  }

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

async function waitForCameraPreview(video) {
  applyVideoAttrs(video);

  try {
    await video.play();
  } catch {
    /* iOS may reject until a later gesture */
  }

  if (video.videoWidth > 0) return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
        return;
      }
      cleanup();
      reject(new Error('Camera preview timed out — check camera permission.'));
    }, 15000);

    const tryResolve = () => {
      if (video.videoWidth > 0) {
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };
    const onErr = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Camera preview failed'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', tryResolve);
      video.removeEventListener('loadeddata', tryResolve);
      video.removeEventListener('canplay', tryResolve);
      video.removeEventListener('resize', tryResolve);
      video.removeEventListener('error', onErr);
    };

    video.addEventListener('loadedmetadata', tryResolve);
    video.addEventListener('loadeddata', tryResolve);
    video.addEventListener('canplay', tryResolve);
    video.addEventListener('resize', tryResolve);
    video.addEventListener('error', onErr);
    tryResolve();
  });

  try {
    await video.play();
  } catch {
    /* ignore */
  }
}

async function attachCameraStream(stream) {
  state.cameraStream = stream;
  els.video.srcObject = stream;
  await optimizeCameraTrack(stream);
  applyMirrorMode();
  await waitForCameraPreview(els.video);
}

async function optimizeCameraTrack(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;

  try {
    const capabilities = track.getCapabilities();
    const advanced = [];

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (
      Array.isArray(capabilities.whiteBalanceMode) &&
      capabilities.whiteBalanceMode.includes('continuous')
    ) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }
    if (
      Array.isArray(capabilities.exposureMode) &&
      capabilities.exposureMode.includes('continuous')
    ) {
      advanced.push({ exposureMode: 'continuous' });
    }

    if (advanced.length) {
      await track.applyConstraints({ advanced });
    }
  } catch {
    /* Ignore capability failures on unsupported browsers/devices. */
  }
}

async function initCamera() {
  updateLoadingUI('Starting camera…');

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera needs HTTPS (use ngrok) and a modern browser.');
  }

  const stream = await getCameraStream(CONFIG.defaultFacingMode);
  await attachCameraStream(stream);
  await refreshCameraDevices();

  state.cameraReady = true;
  updateLoadingUI('Camera ready');
  const track = stream.getVideoTracks()[0];
  const preset = getSelectedResolution();
  showStatus(`${preset.label} · ${formatStreamResolution(track)}`);
  setTimeout(hideStatus, 1500);
  startHandGestureLoop();
  tryFinishLoading();
}

function getCameraLabel(device, index) {
  const raw = (device?.label || '').trim();
  if (raw) return raw;
  return `Camera ${index + 1}`;
}

function updateCameraSelectUI() {
  if (!els.cameraSelect) return;
  const select = els.cameraSelect;
  const currentValue = select.value;
  select.replaceChildren();

  state.availableCameras.forEach((cam, index) => {
    const option = document.createElement('option');
    option.value = cam.deviceId;
    option.textContent = getCameraLabel(cam, index);
    select.append(option);
  });

  if (!state.availableCameras.length) return;

  const byIdExists = state.availableCameras.some((cam) => cam.deviceId === state.selectedDeviceId);
  const fallbackDeviceId = state.availableCameras[0].deviceId;
  const valueToApply = byIdExists ? state.selectedDeviceId : currentValue || fallbackDeviceId;
  state.selectedDeviceId = valueToApply;
  select.value = valueToApply;
}

function updateCameraControlsVisibility() {
  if (!els.cameraSelectWrap) return;
  els.cameraSelectWrap.hidden = state.availableCameras.length <= 1;
}

async function refreshCameraDevices() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput'
    );
    state.availableCameras = cams;
    if (!state.selectedDeviceId) {
      const activeTrack = state.cameraStream?.getVideoTracks?.()[0];
      const activeId = activeTrack?.getSettings?.().deviceId;
      state.selectedDeviceId = activeId || cams[0]?.deviceId || '';
    }
  } catch {
    state.availableCameras = [];
  }

  updateCameraSelectUI();
  updateCameraControlsVisibility();
}

function applyMirrorMode() {
  els.video.classList.toggle('is-mirrored', state.mirrorEnabled);
  if (els.mirrorToggle) {
    els.mirrorToggle.textContent = state.mirrorEnabled ? 'Mirror On' : 'Mirror Off';
    els.mirrorToggle.setAttribute('aria-pressed', String(state.mirrorEnabled));
  }
}

function applyControlsPanelState() {
  if (!els.controlsPanel || !els.controlsToggle || !els.controlsContent || !els.controlsOpen) return;
  const expanded = !state.controlsCollapsed;
  els.controlsPanel.hidden = !expanded;
  els.controlsContent.hidden = !expanded;
  els.controlsToggle.textContent = 'Hide';
  els.controlsToggle.setAttribute('aria-expanded', String(expanded));
  els.controlsToggle.setAttribute('aria-label', 'Collapse top options');
  els.controlsOpen.hidden = expanded;
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
  els.countdown.removeAttribute('hidden');
  els.countdown.hidden = false;
  els.countdown.classList.add('is-visible');
  els.countdownNumber.textContent = String(n);
  els.countdownNumber.style.animation = 'none';
  void els.countdownNumber.offsetWidth;
  els.countdownNumber.style.animation = '';
}

function hideCountdown() {
  els.countdown.classList.remove('is-visible');
  els.countdown.hidden = true;
  els.countdown.setAttribute('hidden', '');
}

function stopCountdownTimer() {
  if (state.countdownTimerId) {
    clearInterval(state.countdownTimerId);
    state.countdownTimerId = null;
  }
}

function cancelCountdown() {
  stopCountdownTimer();
  state.countdownActive = false;
  hideCountdown();
  updatePlaybackButtons();
}

/** Safari: play() must run in the same user gesture — do not pause/reset overlay here. */
function unlockMediaOnUserGesture() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);
  void els.video.play().catch(() => {});
}

async function playCamera() {
  applyVideoAttrs(els.video);
  try {
    await els.video.play();
  } catch (err) {
    console.warn('[AR Lens] camera play:', err);
  }
}

async function playOverlay() {
  applyVideoAttrs(els.overlayVideo);

  if (!isMediaReady(els.overlayVideo)) {
    await waitForMedia(els.overlayVideo, 'Overlay');
  }

  if (
    isSafariLike() &&
    !els.overlayVideo.paused &&
    !els.overlayVideo.ended &&
    els.overlayVideo.currentTime < 0.5
  ) {
    return;
  }

  els.overlayVideo.pause();
  try {
    els.overlayVideo.currentTime = 0;
  } catch {
    /* ignore */
  }
  await els.overlayVideo.play();
  if (useCanvasOverlayRendering()) startRenderLoop();
}

async function playBothVideos() {
  await playCamera();
  await playOverlay();
}

/** Safari: call play() synchronously in the tap — never block countdown on the promise. */
function primeSafariPlaybackInGesture() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);
  void els.video.play().catch(() => {});
  void els.overlayVideo.play().catch(() => {});
}

function finishCountdownAndPlay() {
  stopCountdownTimer();
  state.countdownActive = false;
  hideCountdown();
  els.overlayVideo.classList.remove('is-preroll');

  const safariAlreadyPlaying =
    isSafariLike() && !els.overlayVideo.paused && !els.overlayVideo.ended;

  if (safariAlreadyPlaying) {
    state.isPlaying = true;
    updatePlaybackButtons();
    void els.video.play().catch(() => {});
    if (useCanvasOverlayRendering()) startRenderLoop();
    showStatus('Playing…', { playing: true });
    return;
  }

  void playBothVideos()
    .then(() => {
      state.isPlaying = true;
      updatePlaybackButtons();
      showStatus('Playing…', { playing: true });
    })
    .catch((err) => {
      console.error('[AR Lens]', err);
      state.isPlaying = false;
      updatePlaybackButtons();
      showStatus(err.message || 'Play failed — tap Play again.');
      setTimeout(hideStatus, 4000);
    });
}

function startCountdownThenPlay() {
  if (state.countdownActive || state.isPlaying) return;

  state.countdownActive = true;
  updatePlaybackButtons();

  let n = CONFIG.countdownSeconds;
  showCountdown(n);
  showStatus('Starting in…', { playing: true });

  if (isSafariLike()) {
    els.overlayVideo.classList.add('is-preroll');
    primeSafariPlaybackInGesture();
  }

  state.countdownTimerId = setInterval(() => {
    n -= 1;
    if (n > 0) {
      showCountdown(n);
      return;
    }
    finishCountdownAndPlay();
  }, 1000);
}

function pausePlayback() {
  cancelCountdown();
  els.overlayVideo.classList.remove('is-preroll');
  els.overlayVideo.pause();
  stopRenderLoop();
  clearRenderCanvas();
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
    drawCover(ctx, els.video, w, h, state.mirrorEnabled);
  }
  if (useCanvasOverlayRendering() && els.renderCanvas?.width) {
    ctx.drawImage(els.renderCanvas, 0, 0, w, h);
  } else if (els.overlayVideo.videoWidth) {
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

function clearQrTimers() {
  if (state.qrCountdownIntervalId) {
    clearInterval(state.qrCountdownIntervalId);
    state.qrCountdownIntervalId = null;
  }
  if (state.qrHideTimeoutId) {
    clearTimeout(state.qrHideTimeoutId);
    state.qrHideTimeoutId = null;
  }
}

function hideUploadQr() {
  clearQrTimers();
  if (!els.uploadQr) return;
  els.uploadQr.hidden = true;
  if (els.uploadQrCode) {
    els.uploadQrCode.replaceChildren();
  }
  if (els.uploadQrTimer) {
    els.uploadQrTimer.textContent = '';
  }
}

function addAttachmentParam(url) {
  try {
    const next = new URL(url);
    next.searchParams.set('ik-attachment', 'true');
    return next.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}ik-attachment=true`;
  }
}

async function getImageKitAuthParams() {
  const response = await fetch(CONFIG.imageKit.authEndpoint);
  if (!response.ok) {
    throw new Error('Could not fetch upload auth from server.');
  }
  return response.json();
}

async function scheduleImageDeletion(fileId) {
  await fetch(CONFIG.imageKit.scheduleDeleteEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId }),
  });
}

async function uploadGeneratedImage(blob) {
  const auth = await getImageKitAuthParams();
  const fileName = `ar-lens-${Date.now()}.png`;

  const uploadFn = window.imagekit?.upload;
  if (typeof uploadFn === 'function') {
    return uploadFn({
      file: blob,
      fileName,
      publicKey: auth.publicKey || CONFIG.imageKit.publicKey,
      signature: auth.signature,
      token: auth.token,
      expire: auth.expire,
    });
  }

  const formData = new FormData();
  formData.append('file', blob);
  formData.append('fileName', fileName);
  formData.append('publicKey', auth.publicKey || CONFIG.imageKit.publicKey);
  formData.append('signature', auth.signature);
  formData.append('token', auth.token);
  formData.append('expire', String(auth.expire));

  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Image upload failed.');
  }
  return response.json();
}

function showUploadQr(url) {
  if (!els.uploadQr || !els.uploadQrCode || !els.uploadQrLink || !els.uploadQrTimer) return;
  clearQrTimers();

  const downloadUrl = addAttachmentParam(url);
  els.uploadQrCode.replaceChildren();
  if (typeof window.QRCode === 'function') {
    new window.QRCode(els.uploadQrCode, {
      text: downloadUrl,
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }

  els.uploadQrLink.href = downloadUrl;
  els.uploadQr.hidden = false;

  let secondsLeft = CONFIG.imageKit.qrVisibleSeconds;
  els.uploadQrTimer.textContent = `Visible for ${secondsLeft}s`;
  state.qrCountdownIntervalId = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      hideUploadQr();
      return;
    }
    els.uploadQrTimer.textContent = `Visible for ${secondsLeft}s`;
  }, 1000);
  state.qrHideTimeoutId = setTimeout(hideUploadQr, CONFIG.imageKit.qrVisibleSeconds * 1000);
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
  stopRenderLoop();
  updatePlaybackButtons();

  resizeCaptureCanvas();
  drawComposite();
  const blob = await canvasToPngBlob(els.captureCanvas);
  if (blob) {
    await savePhoto(blob);
    try {
      showStatus('Uploading image…');
      const uploadResult = await uploadGeneratedImage(blob);
      if (uploadResult?.fileId) {
        await scheduleImageDeletion(uploadResult.fileId);
      }
      if (uploadResult?.url) {
        showUploadQr(uploadResult.url);
      }
      showStatus('Uploaded · QR ready');
      setTimeout(hideStatus, 2000);
    } catch (err) {
      console.error('[AR Lens] upload failed', err);
      showStatus('Photo saved locally · upload failed');
      setTimeout(hideStatus, 4500);
    }
  }
}

function resetOverlayToStart() {
  if (els.overlayVideo.ended || els.overlayVideo.currentTime > 0.1) {
    try {
      els.overlayVideo.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  clearRenderCanvas();
}

function onPlayPressed() {
  if (state.countdownActive || state.isPlaying) return;

  resetOverlayToStart();
  unlockMediaOnUserGesture();
  if (isSafariLike()) {
    primeSafariPlaybackInGesture();
  }
  startCountdownThenPlay();
}

function bindPlaybackControls() {
  let playLock = false;

  const onPlay = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (playLock) return;
    playLock = true;
    setTimeout(() => {
      playLock = false;
    }, 500);
    onPlayPressed();
  };

  els.btnPlay.addEventListener('touchend', onPlay, { passive: false });
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

async function switchCameraResolution(presetId) {
  if (!presetId || !RESOLUTION_PRESETS[presetId]) return;
  if (presetId === state.cameraResolutionPreset) return;

  const prevPreset = state.cameraResolutionPreset;
  state.cameraResolutionPreset = presetId;
  if (!state.cameraReady) return;

  state.isSwitchingCamera = true;
  if (els.cameraSelect) els.cameraSelect.disabled = true;
  if (els.cameraResolution) els.cameraResolution.disabled = true;
  if (els.mirrorToggle) els.mirrorToggle.disabled = true;

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }

  try {
    const stream = await getCameraStream(CONFIG.defaultFacingMode);
    await attachCameraStream(stream);
    const track = stream.getVideoTracks()[0];
    const preset = getSelectedResolution();
    showStatus(`${preset.label} · ${formatStreamResolution(track)}`);
    setTimeout(hideStatus, 1600);
  } catch (err) {
    console.warn('[AR Lens] resolution switch failed', err);
    state.cameraResolutionPreset = prevPreset;
    if (els.cameraResolution) els.cameraResolution.value = prevPreset;
    try {
      const stream = await getCameraStream(CONFIG.defaultFacingMode);
      await attachCameraStream(stream);
    } catch {
      /* empty */
    }
  } finally {
    state.isSwitchingCamera = false;
    if (els.cameraSelect) els.cameraSelect.disabled = false;
    if (els.cameraResolution) els.cameraResolution.disabled = false;
    if (els.mirrorToggle) els.mirrorToggle.disabled = false;
  }
}

async function switchCameraToDevice(deviceId) {
  if (!deviceId || deviceId === state.selectedDeviceId) return;
  if (!state.cameraReady || state.isSwitchingCamera) return;

  const prevDeviceId = state.selectedDeviceId;
  state.selectedDeviceId = deviceId;
  state.isSwitchingCamera = true;
  if (els.cameraSelect) els.cameraSelect.disabled = true;
  if (els.cameraResolution) els.cameraResolution.disabled = true;
  if (els.mirrorToggle) els.mirrorToggle.disabled = true;

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
  }

  try {
    const stream = await getCameraStream(CONFIG.defaultFacingMode);
    await attachCameraStream(stream);
    await refreshCameraDevices();
    const chosenIndex = state.availableCameras.findIndex((cam) => cam.deviceId === state.selectedDeviceId);
    const chosen = chosenIndex >= 0 ? state.availableCameras[chosenIndex] : null;
    if (chosen) {
      showStatus(getCameraLabel(chosen, chosenIndex));
      setTimeout(hideStatus, 1200);
    }
  } catch (err) {
    console.warn('[AR Lens] camera switch failed', err);
    state.selectedDeviceId = prevDeviceId;
    try {
      const stream = await getCameraStream(CONFIG.defaultFacingMode);
      await attachCameraStream(stream);
      await refreshCameraDevices();
    } catch {
      /* empty */
    }
  } finally {
    state.isSwitchingCamera = false;
    if (els.cameraSelect) els.cameraSelect.disabled = false;
    if (els.cameraResolution) els.cameraResolution.disabled = false;
    if (els.mirrorToggle) els.mirrorToggle.disabled = false;
  }
}


function showGestureStartUI() {
  els.loadingMessage.textContent = 'Tap to allow camera & start';
  els.loadingBar.style.width = '0%';
  if (els.loadingStart) {
    els.loadingStart.hidden = false;
  }
}

function hideGestureStartUI() {
  if (els.loadingStart) {
    els.loadingStart.hidden = true;
  }
}

async function boot() {
  if (state.bootStarted) return;
  state.bootStarted = true;
  hideGestureStartUI();
  hideError();
  state.cameraReady = false;
  state.overlayReady = false;
  state.experienceStarted = false;
  cancelCountdown();
  hideUploadQr();
  state.isPlaying = false;
  els.overlayVideo.classList.remove('is-preroll');
  stopRenderLoop();
  stopHandGestureLoop();
  resetWaveTracking();
  clearRenderCanvas();

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
    state.bootStarted = false;
    showError(err.message || 'Something went wrong.');
  }
}

function requestBootFromGesture() {
  if (state.bootStarted) return;
  void boot();
}

function init() {
  applyVideoAttrs(els.video);
  applyVideoAttrs(els.overlayVideo);
  els.overlayVideo.addEventListener('ended', onOverlayEnded);

  bindPlaybackControls();
  els.capturePreviewClose?.addEventListener('click', hideCapturePreview);
  els.cameraSelect?.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    void switchCameraToDevice(target.value);
  });
  els.cameraResolution?.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    void switchCameraResolution(target.value);
  });
  els.mirrorToggle?.addEventListener('click', () => {
    state.mirrorEnabled = !state.mirrorEnabled;
    applyMirrorMode();
  });
  els.controlsToggle?.addEventListener('click', () => {
    state.controlsCollapsed = true;
    applyControlsPanelState();
  });
  els.controlsOpen?.addEventListener('click', () => {
    state.controlsCollapsed = false;
    applyControlsPanelState();
  });
  els.errorRetry?.addEventListener('click', () => {
    state.bootStarted = false;
    boot();
  });
  const onStartTap = (e) => {
    e.preventDefault();
    requestBootFromGesture();
  };
  els.loadingStart?.addEventListener('touchend', onStartTap, { passive: false });
  els.loadingStart?.addEventListener('click', onStartTap);
  window.addEventListener('resize', resizeCaptureCanvas);
  window.addEventListener('resize', resizeRenderCanvas);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.cameraStream) {
      els.video.play().catch(() => {});
    }
  });
  window.addEventListener('beforeunload', hideUploadQr);
  resizeCaptureCanvas();
  resizeRenderCanvas();
  if (els.cameraResolution) {
    els.cameraResolution.value = state.cameraResolutionPreset;
  }
  applyMirrorMode();
  applyControlsPanelState();
  initHandGesturePlay();

  if (needsGestureStart()) {
    showGestureStartUI();
  } else {
    void boot();
  }
}

init();
