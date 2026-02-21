// public/client.js - Sharebooth: layouts, decorations, live GIF, challenges

const socket = io();

// ===== State =====
let sessionCode = null;
let participants = [];
let layers = [];
const imageCache = new Map();
let isHost = false;

// Canvas
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const decoCanvas = document.getElementById('decoCanvas');
const decoCtx = decoCanvas.getContext('2d');
let devicePixelRatioVal = Math.max(1, window.devicePixelRatio || 1);

// Camera
const video = document.getElementById('video');
let localStream = null;
let cameraRunning = false;

// Background removal
let bgRemovalEnabled = false;
let selectedBgColor = '#FFF6EB';

// Virtual background (MediaPipe Selfie Segmentation for real-time)
let virtualBgEnabled = false;
let virtualBgImage = null;       // Image element or null
let virtualBgColor = '#FFF6EB';  // fallback color when no image
let selfieSegmentation = null;   // MediaPipe SelfieSegmentation instance
let mediapipeLoaded = false;
let livePreviewRAF = null;
const livePreviewEl = document.getElementById('livePreview');
const livePreviewCtx = livePreviewEl.getContext('2d');
let latestSegmentationMask = null; // latest mask from MediaPipe

// Frame background
let frameBgType = 'color';       // 'color' | 'image'
let frameBgColor = '#FFF6EB';    // default cream
let frameBgImage = null;         // Image element

// Frame shape (defaults — applied to new photos, or overridden per-photo)
let frameShapeDefault = 'rect';  // default for new photos
let frameBorderWidth = 6;
let frameBorderRadius = 4;
let frameBorderColor = '#ffffff'; // default border color
let selectedPhotoIndex = -1;     // which photo is selected for per-photo shape editing

// Photo drag-to-move
let isDraggingPhoto = false;
let dragPhotoIndex = -1;
let dragPhotoOffset = { x: 0, y: 0 };

// Crop mode (double-click to pan/zoom image within frame)
let cropModeIndex = -1;
let isCropPanning = false;
let cropPanStart = { x: 0, y: 0 };
let cropPanStartOffset = { x: 0, y: 0 };
let isCropZooming = false;
let cropZoomStartDist = 0;
let cropZoomStartScale = 1;

// Double-tap detection for mobile
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

// Decorations (replaces old reaction layer)
let decorations = [];
let selectedDecoId = null;
let currentDecoTool = 'none'; // 'none' | 'sticker' | 'text'
let currentStickerEmoji = '\u2764\uFE0F';
let isDragging = false;
let dragDeco = null;
let dragOffset = { x: 0, y: 0 };

// Layout
let currentLayout = 'freeform';

// Prompts
let selectedCategory = 'mix';
let countdownInterval = null;

// GIF frame buffer
const GIF_FPS = 10;
const GIF_BUFFER_SECONDS = 2;
const GIF_BUFFER_SIZE = GIF_FPS * GIF_BUFFER_SECONDS; // 20 frames
const MAX_GIF_PHOTOS = 8;
let frameBuffer = [];
let frameBufferIdx = 0;
let frameBufferTimer = null;
const gifCaptureCanvas = document.createElement('canvas');
gifCaptureCanvas.width = 320;
gifCaptureCanvas.height = 240;
const gifCaptureCtx = gifCaptureCanvas.getContext('2d');

// ===== Layout Definitions =====
const LAYOUTS = {
  '2x2': {
    aspectRatio: 1,
    slots: [
      { x: 0.02, y: 0.02, w: 0.47, h: 0.47 },
      { x: 0.51, y: 0.02, w: 0.47, h: 0.47 },
      { x: 0.02, y: 0.51, w: 0.47, h: 0.47 },
      { x: 0.51, y: 0.51, w: 0.47, h: 0.47 },
    ]
  },
  '3x3': {
    aspectRatio: 1,
    slots: (() => {
      const s = [];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          s.push({ x: 0.02 + c * 0.33, y: 0.02 + r * 0.33, w: 0.30, h: 0.30 });
      return s;
    })()
  },
  '4x4': {
    aspectRatio: 1,
    slots: (() => {
      const s = [];
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
          s.push({ x: 0.015 + c * 0.248, y: 0.015 + r * 0.248, w: 0.23, h: 0.23 });
      return s;
    })()
  },
  '1big3': {
    aspectRatio: 4 / 3,
    slots: [
      { x: 0.02, y: 0.02, w: 0.58, h: 0.96 },
      { x: 0.62, y: 0.02, w: 0.36, h: 0.30 },
      { x: 0.62, y: 0.35, w: 0.36, h: 0.30 },
      { x: 0.62, y: 0.68, w: 0.36, h: 0.30 },
    ]
  },
  'strip': {
    aspectRatio: 0.4,
    slots: [
      { x: 0.05, y: 0.01, w: 0.90, h: 0.235 },
      { x: 0.05, y: 0.255, w: 0.90, h: 0.235 },
      { x: 0.05, y: 0.50, w: 0.90, h: 0.235 },
      { x: 0.05, y: 0.745, w: 0.90, h: 0.235 },
    ]
  },
  'freeform': {
    aspectRatio: 1,
    slots: null
  }
};

// ===== Utilities =====
function now() { return Date.now(); }
function generateId() { return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9); }
function getMyName() { return document.getElementById('name').value || 'You'; }

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    if (imageCache.has(src)) return resolve(imageCache.get(src));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageCache.set(src, img); resolve(img); };
    img.onerror = () => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      const cx = c.getContext('2d'); cx.fillStyle = '#ddd'; cx.fillRect(0, 0, 200, 150);
      imageCache.set(src, c); resolve(c);
    };
    img.src = src;
  });
}

// ===== Canvas Sizing =====
function resizeCanvasImmediate() {
  const preview = document.getElementById('preview');
  const layoutDef = LAYOUTS[currentLayout] || LAYOUTS.freeform;
  preview.style.aspectRatio = String(layoutDef.aspectRatio);

  const w = preview.clientWidth;
  const h = preview.clientHeight;
  if (w === 0 || h === 0) return;
  devicePixelRatioVal = Math.max(1, window.devicePixelRatio || 1);

  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * devicePixelRatioVal);
  canvas.height = Math.round(h * devicePixelRatioVal);

  decoCanvas.width = canvas.width;
  decoCanvas.height = canvas.height;

  render();
  renderDecorations();
}
window.addEventListener('resize', () => resizeCanvasImmediate());

// ===== Layer Management =====
function findLayerByImageUrl(url) { return layers.find(l => l.imageUrl === url); }
function findLayerByTempId(tid) { return layers.find(l => l.tempId && l.tempId === tid); }

function addLocalLayer(obj) {
  if (!obj || !obj.imageUrl) return null;
  const existing = findLayerByImageUrl(obj.imageUrl);
  if (existing) {
    if (existing.state === 'pending' && obj.state === 'confirmed') {
      existing.state = 'confirmed';
      if (obj.id) existing.id = obj.id;
    }
    return existing;
  }
  const layer = {
    id: obj.id || null,
    tempId: obj.tempId || null,
    imageUrl: obj.imageUrl,
    owner: obj.owner || 'Anon',
    ts: obj.ts || now(),
    state: obj.state || 'pending',
    dropProgress: 0,
    dropStartTs: null,
    gifFrames: obj.gifFrames || null,
    scale: obj.scale || 1,
    shape: obj.shape || frameShapeDefault,
    borderColor: obj.borderColor || null,
    offsetX: obj.offsetX || 0,
    offsetY: obj.offsetY || 0,
    cropX: obj.cropX || 0,
    cropY: obj.cropY || 0,
    cropScale: obj.cropScale || 1,
  };
  layers.push(layer);
  renderThumbs();
  renderVbgPhotos();
  render();
  return layer;
}

function confirmLayerFromServer(serverLayer) {
  if (!serverLayer || !serverLayer.imageUrl) return;
  const existing = findLayerByImageUrl(serverLayer.imageUrl);
  if (existing) {
    existing.id = serverLayer.id || existing.id;
    existing.owner = serverLayer.owner || existing.owner;
    existing.ts = serverLayer.timestamp || existing.ts;
    existing.state = 'confirmed';
    if (existing.dropProgress === 0) existing.dropProgress = 1;
  } else {
    addLocalLayer({
      id: serverLayer.id, imageUrl: serverLayer.imageUrl,
      owner: serverLayer.owner, ts: serverLayer.timestamp, state: 'confirmed'
    });
    return; // addLocalLayer already calls renderVbgPhotos
  }
  renderThumbs();
  renderVbgPhotos();
  render();
}

// ===== Thumbnails =====
function renderThumbs() {
  const thumbs = document.getElementById('thumbs');
  thumbs.innerHTML = '';
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb-wrapper' + (l.state === 'pending' ? ' thumb-pending' : '');

    const img = document.createElement('img');
    img.src = l.imageUrl;
    img.className = 'thumb-img';
    img.title = l.owner || '';
    wrapper.appendChild(img);

    if (l.gifFrames && l.gifFrames.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'gif-badge';
      badge.textContent = 'GIF';
      badge.onclick = ((idx) => (e) => { e.stopPropagation(); exportPhotoGif(idx); })(i);
      wrapper.appendChild(badge);
    }

    thumbs.appendChild(wrapper);
  }
}

// ===== Camera & Upload =====
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = localStream;
    cameraRunning = true;
    startFrameBuffer();
    updateCameraButtonUI();
    // Restart live preview if virtual BG was active
    if (virtualBgEnabled) startLivePreview();
  } catch (e) {
    console.warn('camera error', e);
  }
}

function stopCamera() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  video.srcObject = null;
  cameraRunning = false;
  stopLivePreview();
  if (frameBufferTimer) { clearInterval(frameBufferTimer); frameBufferTimer = null; }
  updateCameraButtonUI();
}

function updateCameraButtonUI() {
  const btn = document.getElementById('btnStopCamera');
  const snapBtn = document.getElementById('snap');
  if (cameraRunning) {
    btn.innerHTML = '&#9724;'; // stop square
    btn.title = 'Stop camera';
    btn.classList.remove('camera-off');
    snapBtn.disabled = false;
    snapBtn.style.opacity = '1';
  } else {
    btn.innerHTML = '&#9654;'; // play triangle
    btn.title = 'Start camera';
    btn.classList.add('camera-off');
    snapBtn.disabled = true;
    snapBtn.style.opacity = '0.4';
  }
}

async function uploadBlob(blob) {
  const fd = new FormData();
  fd.append('photo', blob, 'snap.png');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  return res.json();
}

let isProcessingSnap = false;

function setSnapProcessing(processing) {
  isProcessingSnap = processing;
  const snapBtn = document.getElementById('snap');
  const stopBtn = document.getElementById('btnStopCamera');
  if (processing) {
    snapBtn.disabled = true;
    snapBtn.style.opacity = '0.4';
    stopBtn.disabled = true;
    // Pause live preview to free up resources during heavy BG removal
    if (segmentationLoop) { cancelAnimationFrame(segmentationLoop); segmentationLoop = null; }
  } else {
    snapBtn.disabled = !cameraRunning;
    snapBtn.style.opacity = cameraRunning ? '1' : '0.4';
    stopBtn.disabled = false;
    // Resume live preview if it was active
    if (virtualBgEnabled && cameraRunning) startLivePreview();
  }
}

async function doSnap() {
  if (isProcessingSnap) return;

  // Freeze GIF frame buffer
  const frozenFrames = freezeFrameBuffer();

  let tmpCanvas;
  if (video && video.readyState >= 2) {
    const targetW = 800;
    const targetH = Math.round(targetW * (video.videoHeight / video.videoWidth || 3 / 4));
    tmpCanvas = document.createElement('canvas'); tmpCanvas.width = targetW; tmpCanvas.height = targetH;
    tmpCanvas.getContext('2d').drawImage(video, 0, 0, targetW, targetH);
  } else {
    tmpCanvas = document.createElement('canvas'); tmpCanvas.width = 640; tmpCanvas.height = 480;
    const tc = tmpCanvas.getContext('2d'); tc.fillStyle = '#ccc'; tc.fillRect(0, 0, 640, 480);
  }

  // BG removal (locks UI during processing)
  if (virtualBgEnabled || bgRemovalEnabled) {
    setSnapProcessing(true);
    try {
      tmpCanvas = await removeBackground(tmpCanvas);
    } finally {
      setSnapProcessing(false);
    }
  }

  await uploadAndEmit(tmpCanvas, frozenFrames);
}

async function uploadAndEmit(processedCanvas, gifFrames) {
  return new Promise((resolve, reject) => {
    processedCanvas.toBlob(async (blob) => {
      try {
        const tempId = generateId();
        const localUrl = URL.createObjectURL(blob);
        addLocalLayer({ imageUrl: localUrl, owner: getMyName(), tempId, state: 'pending', gifFrames });

        const j = await uploadBlob(blob);
        const imageUrl = j.url;
        const localLayer = findLayerByTempId(tempId);
        if (localLayer) {
          localLayer.imageUrl = imageUrl;
          localLayer.tempId = null;
        } else {
          addLocalLayer({ imageUrl, owner: getMyName(), state: 'pending', gifFrames });
        }

        socket.emit('snapped', { code: sessionCode, imageUrl, name: getMyName() });

        // Auto-confirm after 800ms if server doesn't respond
        setTimeout(() => {
          const l = findLayerByImageUrl(imageUrl);
          if (l && l.state !== 'confirmed') {
            l.state = 'confirmed'; l.dropProgress = 1;
            renderThumbs(); render();
          }
        }, 800);

        // Enforce GIF memory limit
        enforceGifMemoryLimit();
        resolve();
      } catch (err) {
        console.error('upload error', err);
        reject(err);
      }
    }, 'image/png', 0.9);
  });
}

function enforceGifMemoryLimit() {
  const withGif = layers.filter(l => l.gifFrames && l.gifFrames.length > 0);
  while (withGif.length > MAX_GIF_PHOTOS) {
    const oldest = withGif.shift();
    oldest.gifFrames = null;
  }
}

// ===== Background Removal (dynamic import — ES module) =====
let bgRemovalModule = null;
async function loadBgRemovalModule() {
  if (bgRemovalModule) return bgRemovalModule;
  try {
    bgRemovalModule = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
    return bgRemovalModule;
  } catch (err) {
    console.error('Failed to load BG removal module:', err);
    return null;
  }
}

async function removeBackground(srcCanvas, showOverlay = true) {
  const blob = await new Promise(r => srcCanvas.toBlob(r, 'image/png'));
  if (showOverlay) document.getElementById('bgProcessing').style.display = 'flex';
  try {
    const mod = await loadBgRemovalModule();
    if (!mod || !mod.removeBackground) throw new Error('BG removal module not available');
    const resultBlob = await mod.removeBackground(blob);
    const img = await createImageBitmap(resultBlob);
    const out = document.createElement('canvas');
    out.width = srcCanvas.width; out.height = srcCanvas.height;
    const oc = out.getContext('2d');
    // Use virtual BG image if available, otherwise solid color
    if (virtualBgEnabled && virtualBgImage) {
      drawImageCover(oc, virtualBgImage, 0, 0, out.width, out.height);
    } else if (virtualBgEnabled && virtualBgColor) {
      oc.fillStyle = virtualBgColor;
      oc.fillRect(0, 0, out.width, out.height);
    } else if (selectedBgColor) {
      oc.fillStyle = selectedBgColor;
      oc.fillRect(0, 0, out.width, out.height);
    }
    oc.drawImage(img, 0, 0, out.width, out.height);
    return out;
  } catch (err) {
    console.error('BG removal failed:', err);
    return srcCanvas;
  } finally {
    if (showOverlay) document.getElementById('bgProcessing').style.display = 'none';
  }
}

// ===== MediaPipe Selfie Segmentation (real-time ~30fps) =====
async function loadMediaPipe() {
  if (mediapipeLoaded) return true;
  try {
    // Load MediaPipe Selfie Segmentation from CDN
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    mediapipeLoaded = true;
    return true;
  } catch (err) {
    console.error('Failed to load MediaPipe:', err);
    return false;
  }
}

async function initSelfieSegmentation() {
  if (selfieSegmentation) return selfieSegmentation;
  const loaded = await loadMediaPipe();
  if (!loaded) return null;

  selfieSegmentation = new SelfieSegmentation({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });
  selfieSegmentation.setOptions({ modelSelection: 1 }); // landscape model (faster)
  selfieSegmentation.onResults(onSegmentationResults);
  return selfieSegmentation;
}

function onSegmentationResults(results) {
  // Store the latest segmentation mask for the render loop
  latestSegmentationMask = results.segmentationMask;

  // Render composited frame immediately
  const cw = livePreviewEl.width, ch = livePreviewEl.height;
  if (cw === 0 || ch === 0) return;

  livePreviewCtx.save();
  livePreviewCtx.clearRect(0, 0, cw, ch);

  // 1. Draw the chosen background (image or color)
  if (virtualBgImage) {
    drawImageCover(livePreviewCtx, virtualBgImage, 0, 0, cw, ch);
  } else {
    livePreviewCtx.fillStyle = virtualBgColor || '#FFF6EB';
    livePreviewCtx.fillRect(0, 0, cw, ch);
  }

  // 2. Draw the segmentation mask
  livePreviewCtx.globalCompositeOperation = 'destination-out';
  livePreviewCtx.drawImage(results.segmentationMask, 0, 0, cw, ch);

  // 3. Now the background has a hole where the person is.
  //    Draw it all behind the person using destination-over
  livePreviewCtx.globalCompositeOperation = 'destination-over';
  livePreviewCtx.drawImage(results.image, 0, 0, cw, ch);

  livePreviewCtx.restore();
}

// ===== Live Virtual Background Preview =====
let segmentationLoop = null;

async function startLivePreview() {
  if (!cameraRunning || !virtualBgEnabled) return;
  stopLivePreview();

  // Show preview canvas
  livePreviewEl.style.display = 'block';

  // Size the preview canvas to match the camera wrapper
  const wrapper = document.querySelector('.camera-wrapper');
  const w = wrapper.clientWidth;
  const h = wrapper.clientHeight;
  livePreviewEl.width = w;
  livePreviewEl.height = h;

  // Initialize MediaPipe
  const seg = await initSelfieSegmentation();
  if (!seg) {
    console.error('Could not init selfie segmentation');
    livePreviewEl.style.display = 'none';
    return;
  }

  // Show loading indicator while model loads
  livePreviewCtx.fillStyle = 'rgba(0,0,0,0.5)';
  livePreviewCtx.fillRect(0, 0, w, h);
  livePreviewCtx.fillStyle = '#fff';
  livePreviewCtx.font = '14px Inter, sans-serif';
  livePreviewCtx.textAlign = 'center';
  livePreviewCtx.fillText('Loading virtual background...', w / 2, h / 2);

  // Start sending video frames to MediaPipe
  async function sendFrame() {
    if (!virtualBgEnabled || !cameraRunning || !video || video.readyState < 2) {
      segmentationLoop = requestAnimationFrame(sendFrame);
      return;
    }
    try {
      await selfieSegmentation.send({ image: video });
    } catch (e) {
      // Ignore frame send errors (can happen during camera switch)
    }
    segmentationLoop = requestAnimationFrame(sendFrame);
  }
  sendFrame();
}

function stopLivePreview() {
  livePreviewEl.style.display = 'none';
  if (segmentationLoop) { cancelAnimationFrame(segmentationLoop); segmentationLoop = null; }
  if (livePreviewRAF) { cancelAnimationFrame(livePreviewRAF); livePreviewRAF = null; }
  latestSegmentationMask = null;
}

// ===== GIF Frame Buffer =====
function startFrameBuffer() {
  if (frameBufferTimer) clearInterval(frameBufferTimer);
  frameBuffer = [];
  frameBufferIdx = 0;
  frameBufferTimer = setInterval(() => {
    if (!video || video.readyState < 2) return;
    gifCaptureCtx.drawImage(video, 0, 0, 320, 240);
    const frameData = gifCaptureCtx.getImageData(0, 0, 320, 240);
    if (frameBuffer.length < GIF_BUFFER_SIZE) {
      frameBuffer.push(frameData);
    } else {
      frameBuffer[frameBufferIdx % GIF_BUFFER_SIZE] = frameData;
    }
    frameBufferIdx++;
  }, 1000 / GIF_FPS);
}

function freezeFrameBuffer() {
  if (frameBuffer.length === 0) return null;
  const ordered = [];
  const total = Math.min(frameBuffer.length, GIF_BUFFER_SIZE);
  const startIdx = frameBuffer.length >= GIF_BUFFER_SIZE ? (frameBufferIdx % GIF_BUFFER_SIZE) : 0;
  for (let i = 0; i < total; i++) {
    ordered.push(frameBuffer[(startIdx + i) % GIF_BUFFER_SIZE]);
  }
  return ordered;
}

// ===== Layout Engine =====
function getLayoutSlots(cw, ch, photoCount) {
  const def = LAYOUTS[currentLayout];
  if (!def || !def.slots) return computeFreeformSlots(cw, ch, photoCount);
  return def.slots.map(s => ({
    x: Math.round(s.x * cw),
    y: Math.round(s.y * ch),
    w: Math.round(s.w * cw),
    h: Math.round(s.h * ch)
  }));
}

function computeFreeformSlots(cw, ch, count) {
  const gap = 20 * devicePixelRatioVal;
  const cols = Math.min(3, Math.max(1, Math.floor((cw - gap) / (240 * devicePixelRatioVal))));
  const thumbW = Math.min(300 * devicePixelRatioVal, Math.floor((cw - gap * (cols + 1)) / cols));
  const thumbH = Math.round(thumbW * 0.75);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      x: gap + (i % cols) * (thumbW + gap),
      y: 60 * devicePixelRatioVal + Math.floor(i / cols) * (thumbH + gap),
      w: thumbW,
      h: thumbH
    });
  }
  return slots;
}

function drawImageCover(targetCtx, img, x, y, w, h) {
  const iw = img.videoWidth || img.width || img.naturalWidth || 200;
  const ih = img.videoHeight || img.height || img.naturalHeight || 150;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  targetCtx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawImageCoverCropped(targetCtx, img, x, y, w, h, layer) {
  const iw = img.videoWidth || img.width || img.naturalWidth || 200;
  const ih = img.videoHeight || img.height || img.naturalHeight || 150;
  // Scale image to cover the frame, then apply crop zoom
  const baseScale = Math.max(w / iw, h / ih);
  const finalScale = baseScale * (layer.cropScale || 1);
  const drawW = iw * finalScale;
  const drawH = ih * finalScale;
  // Center the image within the frame, then apply crop pan offset
  const drawX = x + (w - drawW) / 2 + (layer.cropX || 0);
  const drawY = y + (h - drawH) / 2 + (layer.cropY || 0);
  // The clip path from drawPolaroid handles the frame shape clipping
  targetCtx.drawImage(img, drawX, drawY, drawW, drawH);
}

// ===== Canvas Rendering =====
async function render(time = 0) {
  const cw = canvas.width, ch = canvas.height;
  if (cw === 0 || ch === 0) return;
  ctx.clearRect(0, 0, cw, ch);
  // Frame background (customizable)
  if (frameBgType === 'image' && frameBgImage) {
    drawImageCover(ctx, frameBgImage, 0, 0, cw, ch);
  } else {
    ctx.fillStyle = frameBgColor;
    ctx.fillRect(0, 0, cw, ch);
  }

  if (layers.length === 0) {
    // Empty state hint
    ctx.fillStyle = 'rgba(139,107,74,0.25)';
    ctx.font = `${16 * devicePixelRatioVal}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Snap a photo to get started!', cw / 2, ch / 2);
    ctx.textAlign = 'left';
    return;
  }

  const slots = getLayoutSlots(cw, ch, layers.length);

  const t = typeof time === 'number' ? time : performance.now();

  for (let i = 0; i < layers.length && i < slots.length; i++) {
    const l = layers[i];
    const slot = slots[i];

    // Drop animation
    if (!l.dropStartTs) l.dropStartTs = now();
    if (l.dropProgress < 1) l.dropProgress = Math.min(1, (now() - l.dropStartTs) / 450);
    const dropOffset = (1 - l.dropProgress) * 30 * devicePixelRatioVal;

    const img = await loadImage(l.imageUrl);
    const rot = ((i % 2) === 0) ? -0.04 : 0.03;

    // Apply per-photo scale and offset
    const s = l.scale || 1;
    const sw = slot.w * s, sh = slot.h * s;
    const sx = slot.x + (slot.w - sw) / 2 + (l.offsetX || 0);
    const sy = slot.y + (slot.h - sh) / 2 + dropOffset + (l.offsetY || 0);
    drawPolaroid(img, sx, sy, sw, sh, rot, l, t, i);

    // Crop mode highlight (blue)
    if (i === cropModeIndex) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.85)';
      ctx.lineWidth = 3 * devicePixelRatioVal;
      ctx.setLineDash([4 * devicePixelRatioVal, 4 * devicePixelRatioVal]);
      ctx.strokeRect(sx - 2, sy - 2, sw + 4, sh + 4);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0, 150, 255, 0.85)';
      ctx.font = `600 ${11 * devicePixelRatioVal}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('CROP', sx + 4, sy - 6);
      ctx.restore();
    }
    // Selected photo highlight (pink)
    else if (i === selectedPhotoIndex) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 107, 129, 0.85)';
      ctx.lineWidth = 3 * devicePixelRatioVal;
      ctx.setLineDash([8 * devicePixelRatioVal, 5 * devicePixelRatioVal]);
      ctx.strokeRect(sx - 2, sy - 2, sw + 4, sh + 4);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw corner resize handles
    const hs = 8 * devicePixelRatioVal;
    const isCrop = (i === cropModeIndex);
    const isSelected = (i === selectedPhotoIndex);
    ctx.fillStyle = isCrop ? 'rgba(0,150,255,0.85)' : isSelected ? 'rgba(255,107,129,0.9)' : 'rgba(255,107,129,0.5)';
    const corners = [[sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh]];
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }
}

function drawPolaroid(img, x, y, w, h, rotation, layer, time, index) {
  const d = devicePixelRatioVal;
  const bw = frameBorderWidth * d;
  const br = frameBorderRadius * d;
  const borderBottom = Math.max(bw, 22 * d);
  const shape = layer.shape || frameShapeDefault;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.12)';
  ctx.shadowBlur = 12 * d;
  ctx.shadowOffsetY = 3 * d;

  // Draw frame border (shape-aware)
  const borderCol = layer.borderColor || frameBorderColor;
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2 + bw;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'heart') {
    drawHeartPath(ctx, 0, 0, Math.min(w, h) / 2 + bw);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'star') {
    drawStarPath(ctx, 0, 0, Math.min(w, h) / 2 + bw, 5);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else {
    const frameX = -w / 2 - bw;
    const frameY = -h / 2 - bw;
    const frameW = w + bw * 2;
    const frameH = h + bw + borderBottom;
    roundRect(ctx, frameX, frameY, frameW, frameH, br);
    ctx.fillStyle = borderCol;
    ctx.fill();
  }

  ctx.shadowColor = 'transparent';

  // Clip & draw image (shape-aware, with crop support)
  const hasCrop = layer.cropX || layer.cropY || (layer.cropScale && layer.cropScale !== 1);
  const drawImg = (img) => hasCrop ? drawImageCoverCropped(ctx, img, -w / 2, -h / 2, w, h, layer) : drawImageCover(ctx, img, -w / 2, -h / 2, w, h);
  ctx.save();
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  } else if (shape === 'heart') {
    drawHeartPath(ctx, 0, 0, Math.min(w, h) / 2);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  } else if (shape === 'star') {
    drawStarPath(ctx, 0, 0, Math.min(w, h) / 2, 5);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  } else {
    roundRect(ctx, -w / 2, -h / 2, w, h, Math.max(1, br - 2));
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  }
  ctx.restore();

  // Owner name
  if (layer.owner) {
    const isSpecial = shape === 'circle' || shape === 'heart' || shape === 'star';
    const nameY = isSpecial ? Math.min(w, h) / 2 + bw + 10 * d : h / 2 + borderBottom / 2;
    ctx.fillStyle = '#8B6B4A';
    ctx.font = `${Math.max(10, Math.min(14, h * 0.06))}px 'Baloo 2', cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(layer.owner, 0, nameY);
  }

  // Critter bounce
  const isSpecial = shape === 'circle' || shape === 'heart' || shape === 'star';
  const critOff = isSpecial ? Math.min(w, h) / 2 + bw + 10 * d : h / 2 + borderBottom / 2;
  const critX = w / 2 - 20 * d;
  const bounce = Math.sin((time / 300) + ((layer.ts || 0) % 1000) / 1000) * 4 * d;
  ctx.beginPath();
  ctx.fillStyle = '#A0D8FF';
  ctx.arc(critX, critOff - bounce, 8 * d, 0, Math.PI * 2);
  ctx.fill();

  if (layer.state === 'confirmed') {
    ctx.fillStyle = '#FF6B81';
    ctx.font = `${12 * d}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2764', critX, critOff - bounce);
  }

  ctx.restore();
}

// Shape path helpers
function drawHeartPath(c, cx, cy, size) {
  c.beginPath();
  const s = size * 0.9;
  c.moveTo(cx, cy + s * 0.6);
  c.bezierCurveTo(cx - s * 1.2, cy - s * 0.2, cx - s * 0.6, cy - s * 1.0, cx, cy - s * 0.4);
  c.bezierCurveTo(cx + s * 0.6, cy - s * 1.0, cx + s * 1.2, cy - s * 0.2, cx, cy + s * 0.6);
  c.closePath();
}

function drawStarPath(c, cx, cy, size, points) {
  c.beginPath();
  const outer = size;
  const inner = size * 0.4;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Animation loop
let animating = false;
function startAnimationLoop() {
  if (animating) return;
  animating = true;
  (function loop() {
    render(performance.now());
    if (animating) setTimeout(loop, 33);
  })();
}
startAnimationLoop();

// ===== Decoration System =====
function getDecoSize(d) {
  const base = d.type === 'sticker' ? 0.08 : 0.12;
  return { w: base * (d.scale || 1), h: base * (d.scale || 1) };
}

function hitTestDeco(nx, ny) {
  for (let i = decorations.length - 1; i >= 0; i--) {
    const d = decorations[i];
    const s = getDecoSize(d);
    if (nx >= d.x - s.w / 2 && nx <= d.x + s.w / 2 &&
        ny >= d.y - s.h / 2 && ny <= d.y + s.h / 2) {
      return d;
    }
  }
  return null;
}

function renderDecorations() {
  decoCtx.clearRect(0, 0, decoCanvas.width, decoCanvas.height);
  const cw = decoCanvas.width, ch = decoCanvas.height;
  if (cw === 0 || ch === 0) return;

  for (const d of decorations) {
    const px = d.x * cw, py = d.y * ch;

    if (d.type === 'sticker') {
      const size = 32 * (d.scale || 1) * devicePixelRatioVal;
      decoCtx.font = `${size}px serif`;
      decoCtx.textAlign = 'center';
      decoCtx.textBaseline = 'middle';
      decoCtx.fillText(d.content, px, py);
    } else if (d.type === 'text') {
      const size = (d.fontSize || 18) * (d.scale || 1) * devicePixelRatioVal;
      decoCtx.font = `600 ${size}px 'Baloo 2', cursive`;
      decoCtx.fillStyle = d.color || '#8B6B4A';
      decoCtx.textAlign = 'center';
      decoCtx.textBaseline = 'middle';
      decoCtx.fillText(d.content, px, py);
    }

    // Selection highlight with resize hint
    if (d.id === selectedDecoId) {
      const s = getDecoSize(d);
      const hw = (s.w / 2) * cw, hh = (s.h / 2) * ch;
      decoCtx.strokeStyle = 'rgba(255, 107, 129, 0.8)';
      decoCtx.lineWidth = 2 * devicePixelRatioVal;
      decoCtx.setLineDash([6, 4]);
      decoCtx.strokeRect(px - hw, py - hh, hw * 2, hh * 2);
      decoCtx.setLineDash([]);

      // Corner resize handles
      const handleSize = 6 * devicePixelRatioVal;
      decoCtx.fillStyle = 'rgba(255, 107, 129, 0.9)';
      const corners = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]];
      for (const [cx, cy] of corners) {
        decoCtx.fillRect(px + cx - handleSize / 2, py + cy - handleSize / 2, handleSize, handleSize);
      }
    }
  }
}

function getDecoCoords(e) {
  const rect = decoCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

// Throttled move emit
let moveThrottle = null;
function throttledEmitMove(id, x, y) {
  if (moveThrottle) return;
  moveThrottle = setTimeout(() => {
    if (sessionCode) socket.emit('decoration-move', { code: sessionCode, id, x, y });
    moveThrottle = null;
  }, 50);
}

// Hit test for corner resize handles (returns true if near a corner of the selected deco)
const HANDLE_RADIUS = 0.015; // normalized distance threshold
let isResizingDeco = false;
let resizeDeco = null;
let resizeStartDist = 0;
let resizeStartScale = 1;

function hitTestDecoHandle(nx, ny) {
  if (!selectedDecoId) return false;
  const d = decorations.find(dec => dec.id === selectedDecoId);
  if (!d) return false;
  const s = getDecoSize(d);
  const hw = s.w / 2, hh = s.h / 2;
  const corners = [
    { x: d.x - hw, y: d.y - hh },
    { x: d.x + hw, y: d.y - hh },
    { x: d.x - hw, y: d.y + hh },
    { x: d.x + hw, y: d.y + hh },
  ];
  for (const c of corners) {
    if (Math.abs(nx - c.x) < HANDLE_RADIUS && Math.abs(ny - c.y) < HANDLE_RADIUS) {
      return d;
    }
  }
  return null;
}

// Pointer events on decoration canvas
decoCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const coords = getDecoCoords(e);
  const canvasCoords = getCanvasCoords(e);

  // --- Double-tap detection for mobile crop mode ---
  if (e.pointerType === 'touch') {
    const tapNow = Date.now();
    const dx = Math.abs(e.clientX - lastTapX);
    const dy = Math.abs(e.clientY - lastTapY);
    if (tapNow - lastTapTime < 300 && dx < 30 && dy < 30) {
      const bodyIdx = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
      if (bodyIdx >= 0) {
        cropModeIndex = (cropModeIndex === bodyIdx) ? -1 : bodyIdx;
        if (cropModeIndex >= 0) selectedPhotoIndex = bodyIdx;
        render();
        lastTapTime = 0;
        return;
      }
    }
    lastTapTime = tapNow;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
  }

  // --- Crop mode intercept (when a photo is in crop mode) ---
  if (cropModeIndex >= 0) {
    const handleIdx = hitTestPhotoHandle(canvasCoords.px, canvasCoords.py);
    if (handleIdx === cropModeIndex) {
      // Crop zoom via corner drag
      isCropZooming = true;
      cropZoomStartDist = computeDistFromCenter(canvasCoords, cropModeIndex);
      cropZoomStartScale = layers[cropModeIndex].cropScale || 1;
      return;
    }
    const bodyIdx = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
    if (bodyIdx === cropModeIndex) {
      // Crop pan via body drag
      isCropPanning = true;
      cropPanStart = { x: canvasCoords.px, y: canvasCoords.py };
      const l = layers[cropModeIndex];
      cropPanStartOffset = { x: l.cropX || 0, y: l.cropY || 0 };
      return;
    }
    // Clicked outside the cropped photo — exit crop mode
    cropModeIndex = -1;
    render();
    // Fall through to normal handling
  }

  // --- Decoration resize handle ---
  const handleHit = hitTestDecoHandle(coords.x, coords.y);
  if (handleHit) {
    isResizingDeco = true;
    resizeDeco = handleHit;
    resizeStartDist = Math.hypot(coords.x - handleHit.x, coords.y - handleHit.y);
    resizeStartScale = handleHit.scale || 1;
    return;
  }

  // --- Decoration body hit (select/drag) ---
  const hit = hitTestDeco(coords.x, coords.y);
  if (hit) {
    selectedDecoId = hit.id;
    isDragging = true;
    dragDeco = hit;
    dragOffset = { x: coords.x - hit.x, y: coords.y - hit.y };
    selectedPhotoIndex = -1;
    renderDecorations();
    render();
    return;
  }

  // --- Place new decoration if tool is active ---
  if (currentDecoTool === 'sticker') {
    const deco = {
      id: generateId(), type: 'sticker', content: currentStickerEmoji,
      x: coords.x, y: coords.y, scale: 1, owner: getMyName()
    };
    decorations.push(deco);
    selectedDecoId = deco.id;
    renderDecorations();
    if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
  } else if (currentDecoTool === 'text') {
    const text = prompt('Enter text:');
    if (text) {
      const deco = {
        id: generateId(), type: 'text', content: text,
        x: coords.x, y: coords.y, scale: 1, owner: getMyName(),
        color: '#8B6B4A', fontSize: 18
      };
      decorations.push(deco);
      selectedDecoId = deco.id;
      renderDecorations();
      if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
    }
  } else {
    // --- Photo corner handle (resize) ---
    const photoIdx = hitTestPhotoHandle(canvasCoords.px, canvasCoords.py);
    if (photoIdx >= 0) {
      isResizingPhoto = true;
      resizePhotoIndex = photoIdx;
      selectedPhotoIndex = photoIdx;
      photoResizeStartDist = computeDistFromCenter(canvasCoords, photoIdx);
      photoResizeStartScale = layers[photoIdx].scale || 1;
      updateShapeUIForPhoto(photoIdx);
      render();
    } else {
      // --- Photo body (select + drag) ---
      const bodyIdx = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
      if (bodyIdx >= 0) {
        selectedPhotoIndex = bodyIdx;
        isDraggingPhoto = true;
        dragPhotoIndex = bodyIdx;
        const r = getPhotoRect(bodyIdx);
        dragPhotoOffset = { x: canvasCoords.px - r.sx, y: canvasCoords.py - r.sy };
        updateShapeUIForPhoto(bodyIdx);
        selectedDecoId = null;
        renderDecorations();
        render();
      } else {
        // Deselect all
        selectedPhotoIndex = -1;
        updateShapeUIForPhoto(-1);
        selectedDecoId = null;
        renderDecorations();
        render();
      }
    }
  }
});

decoCanvas.addEventListener('pointermove', (e) => {
  const coords = getDecoCoords(e);
  const canvasCoords = getCanvasCoords(e);

  // --- Crop pan (direct pixel offset) ---
  if (isCropPanning && cropModeIndex >= 0) {
    e.preventDefault();
    const l = layers[cropModeIndex];
    l.cropX = cropPanStartOffset.x + (canvasCoords.px - cropPanStart.x);
    l.cropY = cropPanStartOffset.y + (canvasCoords.py - cropPanStart.y);
    render();
    return;
  }

  // --- Crop zoom ---
  if (isCropZooming && cropModeIndex >= 0) {
    e.preventDefault();
    const dist = computeDistFromCenter(canvasCoords, cropModeIndex);
    if (cropZoomStartDist > 1) {
      layers[cropModeIndex].cropScale = Math.max(0.5, Math.min(5, cropZoomStartScale * (dist / cropZoomStartDist)));
    }
    render();
    return;
  }

  // --- Decoration resize ---
  if (isResizingDeco && resizeDeco) {
    e.preventDefault();
    const dist = Math.hypot(coords.x - resizeDeco.x, coords.y - resizeDeco.y);
    if (resizeStartDist > 0.001) {
      resizeDeco.scale = Math.max(0.3, Math.min(5, resizeStartScale * (dist / resizeStartDist)));
    }
    renderDecorations();
    return;
  }

  // --- Decoration drag ---
  if (isDragging && dragDeco) {
    e.preventDefault();
    dragDeco.x = coords.x - dragOffset.x;
    dragDeco.y = coords.y - dragOffset.y;
    renderDecorations();
    throttledEmitMove(dragDeco.id, dragDeco.x, dragDeco.y);
    return;
  }

  // --- Photo resize ---
  if (isResizingPhoto && resizePhotoIndex >= 0 && resizePhotoIndex < layers.length) {
    e.preventDefault();
    const dist = computeDistFromCenter(canvasCoords, resizePhotoIndex);
    if (photoResizeStartDist > 1) {
      layers[resizePhotoIndex].scale = Math.max(0.3, Math.min(3, photoResizeStartScale * (dist / photoResizeStartDist)));
      render();
    }
    return;
  }

  // --- Photo drag ---
  if (isDraggingPhoto && dragPhotoIndex >= 0 && dragPhotoIndex < layers.length) {
    e.preventDefault();
    const l = layers[dragPhotoIndex];
    const slots = getLayoutSlots(canvas.width, canvas.height, layers.length);
    const slot = slots[dragPhotoIndex];
    const sc = l.scale || 1;
    const sw = slot.w * sc, sh = slot.h * sc;
    const baseSx = slot.x + (slot.w - sw) / 2;
    const baseSy = slot.y + (slot.h - sh) / 2;
    l.offsetX = (canvasCoords.px - dragPhotoOffset.x) - baseSx;
    l.offsetY = (canvasCoords.py - dragPhotoOffset.y) - baseSy;
    render();
    return;
  }

  // --- Cursor updates ---
  if (cropModeIndex >= 0) {
    const bodyIdx = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
    const handleIdx = hitTestPhotoHandle(canvasCoords.px, canvasCoords.py);
    if (handleIdx === cropModeIndex) decoCanvas.style.cursor = 'nwse-resize';
    else if (bodyIdx === cropModeIndex) decoCanvas.style.cursor = 'move';
    else decoCanvas.style.cursor = 'default';
    return;
  }

  const handleHover = hitTestDecoHandle(coords.x, coords.y);
  if (handleHover) {
    decoCanvas.style.cursor = 'nwse-resize';
  } else {
    const photoHandle = hitTestPhotoHandle(canvasCoords.px, canvasCoords.py);
    if (photoHandle >= 0) {
      decoCanvas.style.cursor = 'nwse-resize';
    } else {
      const photoBody = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
      if (photoBody >= 0 && currentDecoTool === 'none') {
        decoCanvas.style.cursor = isDraggingPhoto ? 'grabbing' : 'grab';
      } else {
        decoCanvas.style.cursor = (currentDecoTool === 'sticker' || currentDecoTool === 'text') ? 'crosshair' : 'default';
      }
    }
  }
});

decoCanvas.addEventListener('pointerup', () => {
  if (isResizingDeco && resizeDeco) {
    if (sessionCode) socket.emit('decoration-scale', { code: sessionCode, id: resizeDeco.id, scale: resizeDeco.scale });
    isResizingDeco = false;
    resizeDeco = null;
  }
  if (isDragging && dragDeco) {
    if (sessionCode) socket.emit('decoration-move', { code: sessionCode, id: dragDeco.id, x: dragDeco.x, y: dragDeco.y });
  }
  isDragging = false;
  dragDeco = null;
  isResizingPhoto = false;
  resizePhotoIndex = -1;
  isDraggingPhoto = false;
  dragPhotoIndex = -1;
  isCropPanning = false;
  isCropZooming = false;
});

decoCanvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
decoCanvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ===== Resize captured photos by dragging corners on main canvas =====
let isResizingPhoto = false;
let resizePhotoIndex = -1;
let photoResizeStartDist = 0;
let photoResizeStartScale = 1;

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    px: ((clientX - rect.left) / rect.width) * canvas.width,
    py: ((clientY - rect.top) / rect.height) * canvas.height
  };
}

const PHOTO_HANDLE_PX = 18 * devicePixelRatioVal; // pixel radius for handle hit

function getPhotoRect(i) {
  const slots = getLayoutSlots(canvas.width, canvas.height, layers.length);
  if (i < 0 || i >= layers.length || i >= slots.length) return null;
  const slot = slots[i];
  const l = layers[i];
  const sc = l.scale || 1;
  const sw = slot.w * sc, sh = slot.h * sc;
  const sx = slot.x + (slot.w - sw) / 2 + (l.offsetX || 0);
  const sy = slot.y + (slot.h - sh) / 2 + (l.offsetY || 0);
  return { sx, sy, sw, sh, centerX: slot.x + slot.w / 2 + (l.offsetX || 0), centerY: slot.y + slot.h / 2 + (l.offsetY || 0) };
}

function hitTestPhotoHandle(px, py) {
  if (layers.length === 0) return -1;
  for (let i = 0; i < layers.length; i++) {
    const r = getPhotoRect(i);
    if (!r) continue;
    const corners = [
      [r.sx, r.sy], [r.sx + r.sw, r.sy], [r.sx, r.sy + r.sh], [r.sx + r.sw, r.sy + r.sh]
    ];
    for (const [cx, cy] of corners) {
      if (Math.abs(px - cx) < PHOTO_HANDLE_PX && Math.abs(py - cy) < PHOTO_HANDLE_PX) {
        return i;
      }
    }
  }
  return -1;
}

function hitTestPhotoBody(px, py) {
  if (layers.length === 0) return -1;
  const slots = getLayoutSlots(canvas.width, canvas.height, layers.length);
  for (let i = Math.min(layers.length, slots.length) - 1; i >= 0; i--) {
    const r = getPhotoRect(i);
    if (!r) continue;
    if (px >= r.sx && px <= r.sx + r.sw && py >= r.sy && py <= r.sy + r.sh) {
      return i;
    }
  }
  return -1;
}

function computeDistFromCenter(canvasCoords, photoIdx) {
  const r = getPhotoRect(photoIdx);
  if (!r) return 0;
  return Math.hypot(canvasCoords.px - r.centerX, canvasCoords.py - r.centerY);
}


function deleteSelectedDeco() {
  if (!selectedDecoId) return;
  decorations = decorations.filter(d => d.id !== selectedDecoId);
  if (sessionCode) socket.emit('decoration-remove', { code: sessionCode, id: selectedDecoId });
  selectedDecoId = null;
  renderDecorations();
}

// ===== Export PNG =====
function exportCanvasPNG() {
  (async () => {
    await render(performance.now());
    // Composite decorations
    ctx.drawImage(decoCanvas, 0, 0);

    const cw = canvas.width, ch = canvas.height;
    // Badge
    ctx.save();
    const pad = 12 * devicePixelRatioVal;
    const bw = 220 * devicePixelRatioVal, bh = 56 * devicePixelRatioVal;
    const bx = cw - bw - pad, by = pad;
    roundRect(ctx, bx, by, bw, bh, 10 * devicePixelRatioVal);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.fillStyle = '#8B6B4A';
    ctx.font = `600 ${14 * devicePixelRatioVal}px Inter, sans-serif`;
    ctx.fillText('Sharebooth \u2022 ' + new Date().toLocaleDateString(), bx + pad, by + 24 * devicePixelRatioVal);
    const names = layers.map(l => l.owner).filter(Boolean).slice(0, 3).join(', ');
    ctx.font = `${12 * devicePixelRatioVal}px Inter, sans-serif`;
    ctx.fillText(names, bx + pad, by + 42 * devicePixelRatioVal);
    ctx.restore();

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'sharebooth.png';
      document.body.appendChild(a); a.click(); a.remove();

      const shareArea = document.getElementById('shareArea');
      shareArea.innerHTML = '<a href="' + url + '" target="_blank">Download PNG</a>';
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      setTimeout(() => render(performance.now()), 100);
    }, 'image/png');
  })();
}

// ===== GIF.js Loader (avoids CORS worker issues) =====
let gifJsLoaded = false;
let gifWorkerBlobUrl = null;

async function ensureGifJs() {
  if (gifJsLoaded) return;
  // Load gif.js main script
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  // Fetch worker as blob to avoid CORS
  const workerResp = await fetch('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js');
  const workerBlob = new Blob([await workerResp.text()], { type: 'application/javascript' });
  gifWorkerBlobUrl = URL.createObjectURL(workerBlob);
  gifJsLoaded = true;
}

function createGif(width, height) {
  return new GIF({
    workers: 2, quality: 10, width, height,
    workerScript: gifWorkerBlobUrl
  });
}

// ===== Export Per-Photo GIF =====
async function exportPhotoGif(layerIndex) {
  const layer = layers[layerIndex];
  if (!layer || !layer.gifFrames || layer.gifFrames.length === 0) {
    alert('No live frames for this photo.');
    return;
  }

  await ensureGifJs();
  const gw = 320, gh = 240;
  const gif = createGif(gw, gh);

  const tmp = document.createElement('canvas'); tmp.width = gw; tmp.height = gh;
  const tc = tmp.getContext('2d');

  // Live frames
  for (const frame of layer.gifFrames) {
    tc.putImageData(frame, 0, 0);
    gif.addFrame(tc, { copy: true, delay: 100 });
  }

  // Hold final snap image
  const snapImg = await loadImage(layer.imageUrl);
  if (snapImg) {
    tc.clearRect(0, 0, gw, gh);
    drawImageCover(tc, snapImg, 0, 0, gw, gh);
    gif.addFrame(tc, { copy: true, delay: 1500 });
  }

  gif.on('finished', blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sharebooth-live-${layerIndex + 1}.gif`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  gif.render();
}

// ===== Export Session GIF =====
async function exportSessionGif() {
  if (layers.length === 0) { alert('No photos!'); return; }

  await ensureGifJs();
  const progressEl = document.getElementById('gifProgress');
  progressEl.style.display = 'inline';
  progressEl.textContent = 'Preparing...';

  const gifWidth = Math.min(canvas.width, 500);
  const scale = gifWidth / canvas.width;
  const gifHeight = Math.round(canvas.height * scale);

  const off = document.createElement('canvas'); off.width = gifWidth; off.height = gifHeight;
  const oc = off.getContext('2d');

  const gif = createGif(gifWidth, gifHeight);

  // Pre-load images
  for (const l of layers) await loadImage(l.imageUrl);

  // Find max gif frames across all layers
  const maxFrames = Math.max(...layers.map(l => (l.gifFrames ? l.gifFrames.length : 0)), 1);
  const slots = getLayoutSlots(gifWidth, gifHeight, layers.length);

  // Render frames showing live video in each slot
  for (let f = 0; f < maxFrames; f++) {
    oc.clearRect(0, 0, gifWidth, gifHeight);
    if (frameBgType === 'image' && frameBgImage) {
      drawImageCover(oc, frameBgImage, 0, 0, gifWidth, gifHeight);
    } else {
      oc.fillStyle = frameBgColor;
      oc.fillRect(0, 0, gifWidth, gifHeight);
    }

    for (let i = 0; i < layers.length && i < slots.length; i++) {
      const slot = slots[i];
      const l = layers[i];

      if (l.gifFrames && l.gifFrames.length > 0) {
        const fi = Math.min(f, l.gifFrames.length - 1);
        const tc = document.createElement('canvas'); tc.width = 320; tc.height = 240;
        tc.getContext('2d').putImageData(l.gifFrames[fi], 0, 0);
        drawImageCover(oc, tc, slot.x, slot.y, slot.w, slot.h);
      } else {
        const img = imageCache.get(l.imageUrl);
        if (img) drawImageCover(oc, img, slot.x, slot.y, slot.w, slot.h);
      }
    }

    // Decorations
    if (decoCanvas.width > 0) oc.drawImage(decoCanvas, 0, 0, gifWidth, gifHeight);
    gif.addFrame(oc, { copy: true, delay: 100 });
    progressEl.textContent = `Creating... ${Math.round((f / maxFrames) * 70)}%`;
  }

  // Hold final with actual snap images
  oc.clearRect(0, 0, gifWidth, gifHeight);
  if (frameBgType === 'image' && frameBgImage) {
    drawImageCover(oc, frameBgImage, 0, 0, gifWidth, gifHeight);
  } else {
    oc.fillStyle = frameBgColor;
    oc.fillRect(0, 0, gifWidth, gifHeight);
  }
  for (let i = 0; i < layers.length && i < slots.length; i++) {
    const slot = slots[i];
    const img = await loadImage(layers[i].imageUrl);
    if (img) drawImageCover(oc, img, slot.x, slot.y, slot.w, slot.h);
  }
  if (decoCanvas.width > 0) oc.drawImage(decoCanvas, 0, 0, gifWidth, gifHeight);
  for (let i = 0; i < 15; i++) gif.addFrame(oc, { copy: true, delay: 100 });

  progressEl.textContent = 'Encoding...';
  gif.on('progress', p => { progressEl.textContent = `Encoding... ${Math.round(70 + p * 30)}%`; });
  gif.on('finished', blob => {
    progressEl.textContent = 'Done!';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sharebooth-live.gif';
    document.body.appendChild(a); a.click(); a.remove();
    const shareArea = document.getElementById('shareArea');
    shareArea.innerHTML += ' <a href="' + url + '" target="_blank">Download GIF</a>';
    setTimeout(() => { URL.revokeObjectURL(url); progressEl.style.display = 'none'; }, 30000);
  });
  gif.render();
}

// ===== Pose Prompts =====
function showPrompt(text) {
  const display = document.getElementById('promptDisplay');
  display.textContent = text;
  display.classList.remove('animate');
  void display.offsetHeight;
  display.classList.add('animate');
  startPromptCountdown();
}

function startPromptCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  const el = document.getElementById('promptCountdown');
  el.style.display = 'block';
  let count = 5;
  el.textContent = count;
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      el.textContent = count;
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
      el.style.display = 'none';
      doSnap().catch(e => console.error('auto-snap failed', e));
    }
  }, 1000);
}

// ===== Socket Events =====
socket.on('connect', () => console.log('connected', socket.id));

socket.on('user-joined', ({ participant, participants: ps }) => {
  participants = ps || [];
  document.getElementById('participantCount').textContent = participants.length;
  render();
});

socket.on('snapped', ({ layer: sl }) => confirmLayerFromServer(sl));

socket.on('finish', ({ layers: finalLayers }) => {
  if (Array.isArray(finalLayers) && finalLayers.length > 0) {
    layers = finalLayers.map(l => ({
      id: l.id, imageUrl: l.imageUrl, owner: l.owner || 'Anon',
      ts: l.timestamp || now(), state: 'confirmed', dropProgress: 1, gifFrames: null
    }));
    renderThumbs(); render();
  }
  exportCanvasPNG();
});

socket.on('layers-sync', ({ layers: sl }) => { for (const l of sl) confirmLayerFromServer(l); });

socket.on('prompt', ({ text }) => showPrompt(text));

socket.on('decoration-add', ({ decoration }) => { decorations.push(decoration); renderDecorations(); });
socket.on('decoration-move', ({ id, x, y }) => {
  const d = decorations.find(dec => dec.id === id);
  if (d) { d.x = x; d.y = y; renderDecorations(); }
});
socket.on('decoration-scale', ({ id, scale }) => {
  const d = decorations.find(dec => dec.id === id);
  if (d) { d.scale = scale; renderDecorations(); }
});
socket.on('decoration-remove', ({ id }) => {
  decorations = decorations.filter(d => d.id !== id);
  if (selectedDecoId === id) selectedDecoId = null;
  renderDecorations();
});
socket.on('decorations-sync', ({ decorations: sd }) => { decorations = sd || []; renderDecorations(); });

socket.on('layout-change', ({ layout }) => {
  currentLayout = layout;
  updateLayoutUI();
  resizeCanvasImmediate();
});
socket.on('layout-sync', ({ layout }) => {
  currentLayout = layout;
  updateLayoutUI();
  resizeCanvasImmediate();
});

// ===== UI Wiring =====

// Screen transitions
function showSession() {
  document.getElementById('screenLanding').style.display = 'none';
  document.getElementById('screenSession').style.display = 'flex';
  setTimeout(() => resizeCanvasImmediate(), 100);
}

// Create session
document.getElementById('btnCreate').onclick = async () => {
  const res = await fetch('/api/create', { method: 'POST' });
  const j = await res.json();
  sessionCode = j.code;
  isHost = true;
  document.getElementById('sessionCodeDisplay').textContent = sessionCode;
  document.getElementById('participantCount').textContent = '0';
  showSession();
  await startCamera();
  socket.emit('join', { code: sessionCode, name: getMyName() || 'Host' });
};

// Join session
document.getElementById('btnJoin').onclick = async () => {
  const code = document.getElementById('joinCode').value.trim();
  if (!code || code.length !== 4) { alert('Enter a 4-digit code'); return; }
  sessionCode = code;
  isHost = false;
  document.getElementById('sessionCodeDisplay').textContent = sessionCode;
  document.getElementById('participantCount').textContent = '0';
  showSession();
  await startCamera();
  socket.emit('join', { code: sessionCode, name: getMyName() || 'Guest' });
};

// Copy code
document.getElementById('btnCopyCode').onclick = () => {
  if (sessionCode) {
    navigator.clipboard.writeText(sessionCode).then(() => {
      const btn = document.getElementById('btnCopyCode');
      btn.textContent = '\u2705';
      setTimeout(() => btn.textContent = '\uD83D\uDCCB', 1500);
    });
  }
};

// Snap
document.getElementById('snap').onclick = async () => {
  try { await doSnap(); } catch (e) {
    console.error('snap failed', e);
    alert('Snap failed: ' + (e.message || e));
  }
};

// Export / Finish
document.getElementById('exportPng').onclick = () => exportCanvasPNG();
document.getElementById('exportGif').onclick = () => exportSessionGif().catch(e => {
  console.error('GIF export failed', e);
  alert('GIF export failed: ' + (e.message || e));
});
document.getElementById('finish').onclick = () => {
  if (!sessionCode) return alert('No session');
  socket.emit('finish', { code: sessionCode });
  exportCanvasPNG();
};

// Prompt category selection
document.querySelectorAll('.prompt-cat').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.prompt-cat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = btn.dataset.cat;
  });
});

document.getElementById('btnRandomPrompt').addEventListener('click', () => {
  const text = getRandomPrompt(selectedCategory);
  showPrompt(text);
  if (sessionCode) socket.emit('prompt', { code: sessionCode, text });
});

// Stop camera toggle
document.getElementById('btnStopCamera').addEventListener('click', () => {
  if (cameraRunning) {
    stopCamera();
  } else {
    startCamera();
  }
});

// Background removal
document.getElementById('bgRemoveToggle').addEventListener('change', e => {
  bgRemovalEnabled = e.target.checked;
  document.getElementById('bgPresets').style.display = bgRemovalEnabled ? 'flex' : 'none';
  document.getElementById('virtualBgSection').style.display = bgRemovalEnabled ? 'flex' : 'none';
  if (!bgRemovalEnabled) {
    virtualBgEnabled = false;
    stopLivePreview();
  }
});

document.querySelectorAll('.bg-dot').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-dot').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const bg = btn.dataset.bg;
    selectedBgColor = bg === 'transparent' ? null : bg;
  });
});

// Layout picker
function updateLayoutUI() {
  document.querySelectorAll('.layout-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === currentLayout);
  });
}

document.querySelectorAll('.layout-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    currentLayout = btn.dataset.layout;
    updateLayoutUI();
    resizeCanvasImmediate();
    if (sessionCode) socket.emit('layout-change', { code: sessionCode, layout: currentLayout });
  });
});

// Decoration tools
document.querySelectorAll('.deco-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (tool === 'delete') { deleteSelectedDeco(); return; }

    document.querySelectorAll('.deco-tool').forEach(b => {
      if (b.dataset.tool !== 'delete') b.classList.remove('active');
    });
    btn.classList.add('active');
    currentDecoTool = tool;
    document.getElementById('emojiPicker').style.display = tool === 'sticker' ? 'flex' : 'none';

    // Change cursor
    decoCanvas.style.cursor = (tool === 'sticker' || tool === 'text') ? 'crosshair' : 'default';
  });
});

// Emoji picker
document.querySelectorAll('.emoji-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    currentStickerEmoji = opt.textContent;
  });
});

// Virtual background presets
document.querySelectorAll('.vbg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.vbg;
    if (!val) return;

    document.querySelectorAll('.vbg-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (val === 'none') {
      virtualBgEnabled = false;
      virtualBgImage = null;
      stopLivePreview();
    } else if (val.startsWith('color:')) {
      virtualBgEnabled = true;
      virtualBgColor = val.replace('color:', '');
      virtualBgImage = null;
      startLivePreview();
    }
  });
});

// Render session photos as virtual BG options
function renderVbgPhotos() {
  const container = document.getElementById('vbgPhotos');
  container.innerHTML = '';
  for (const l of layers) {
    if (!l.imageUrl) continue;
    const img = document.createElement('img');
    img.src = l.imageUrl;
    img.className = 'vbg-photo-thumb';
    img.title = (l.owner || 'Photo') + ' - use as background';
    img.addEventListener('click', () => {
      // Deselect preset buttons
      document.querySelectorAll('.vbg-opt').forEach(b => b.classList.remove('active'));
      // Deselect other photo thumbs
      container.querySelectorAll('.vbg-photo-thumb').forEach(t => t.classList.remove('active'));
      img.classList.add('active');

      // Load full image and set as virtual BG
      const bgImg = new Image();
      bgImg.crossOrigin = 'anonymous';
      bgImg.onload = () => {
        virtualBgImage = bgImg;
        virtualBgEnabled = true;
        startLivePreview();
      };
      bgImg.src = l.imageUrl;
    });
    container.appendChild(img);
  }
}

// Virtual BG image upload
document.querySelector('.vbg-upload-btn').addEventListener('click', () => {
  document.getElementById('vbgUpload').click();
});
document.getElementById('vbgUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      virtualBgImage = img;
      virtualBgEnabled = true;
      // Mark upload button as active
      document.querySelectorAll('.vbg-opt').forEach(b => b.classList.remove('active'));
      document.querySelector('.vbg-upload-btn').classList.add('active');
      startLivePreview();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Update shape UI to reflect the selected photo's shape (or default)
function updateShapeUIForPhoto(idx) {
  const shape = (idx >= 0 && idx < layers.length) ? (layers[idx].shape || frameShapeDefault) : frameShapeDefault;
  document.querySelectorAll('.fshape-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.shape === shape);
  });
  const color = (idx >= 0 && idx < layers.length && layers[idx].borderColor) ? layers[idx].borderColor : frameBorderColor;
  const picker = document.getElementById('frameBorderColorPicker');
  if (picker) picker.value = color;
}

// Frame shape controls
document.querySelectorAll('.fshape-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fshape-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const shape = btn.dataset.shape;
    if (selectedPhotoIndex >= 0 && selectedPhotoIndex < layers.length) {
      // Apply to selected photo
      layers[selectedPhotoIndex].shape = shape;
    } else {
      // Apply as default for new photos
      frameShapeDefault = shape;
    }
    render();
  });
});

document.getElementById('frameBorderWidth').addEventListener('input', e => {
  frameBorderWidth = parseInt(e.target.value, 10);
  render();
});

document.getElementById('frameBorderRadius').addEventListener('input', e => {
  frameBorderRadius = parseInt(e.target.value, 10);
  render();
});

// Frame border color
document.getElementById('frameBorderColorPicker').addEventListener('input', e => {
  if (selectedPhotoIndex >= 0 && selectedPhotoIndex < layers.length) {
    layers[selectedPhotoIndex].borderColor = e.target.value;
  } else {
    frameBorderColor = e.target.value;
  }
  render();
});

// Frame background presets
document.querySelectorAll('.fbg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.fbg;
    if (!val) return;

    document.querySelectorAll('.fbg-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (val.startsWith('color:')) {
      frameBgType = 'color';
      frameBgColor = val.replace('color:', '');
      frameBgImage = null;
      render();
      if (sessionCode) socket.emit('frame-bg-change', { code: sessionCode, bgType: 'color', bgColor: frameBgColor });
    }
  });
});

// Frame BG custom color picker
document.getElementById('fbgColorPicker').addEventListener('input', e => {
  frameBgType = 'color';
  frameBgColor = e.target.value;
  frameBgImage = null;
  document.querySelectorAll('.fbg-opt').forEach(b => b.classList.remove('active'));
  render();
  if (sessionCode) socket.emit('frame-bg-change', { code: sessionCode, bgType: 'color', bgColor: frameBgColor });
});

// Frame BG image upload
document.querySelector('.fbg-upload-btn').addEventListener('click', () => {
  document.getElementById('fbgImageUpload').click();
});
document.getElementById('fbgImageUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      frameBgImage = img;
      frameBgType = 'image';
      document.querySelectorAll('.fbg-opt').forEach(b => b.classList.remove('active'));
      document.querySelector('.fbg-upload-btn').classList.add('active');
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Frame BG socket events
socket.on('frame-bg-change', ({ bgType, bgColor }) => {
  if (bgType === 'color' && bgColor) {
    frameBgType = 'color';
    frameBgColor = bgColor;
    frameBgImage = null;
    // Update UI
    document.querySelectorAll('.fbg-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.fbg === 'color:' + bgColor);
    });
    render();
  }
});
socket.on('frame-bg-sync', ({ bgType, bgColor }) => {
  if (bgType === 'color' && bgColor) {
    frameBgType = 'color';
    frameBgColor = bgColor;
    frameBgImage = null;
    document.querySelectorAll('.fbg-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.fbg === 'color:' + bgColor);
    });
    render();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'Escape' && cropModeIndex >= 0) {
    cropModeIndex = -1;
    render();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDecoId) {
    e.preventDefault();
    deleteSelectedDeco();
  }
});

// Double-click for desktop crop mode
decoCanvas.addEventListener('dblclick', (e) => {
  const canvasCoords = getCanvasCoords(e);
  const bodyIdx = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
  if (bodyIdx >= 0) {
    cropModeIndex = (cropModeIndex === bodyIdx) ? -1 : bodyIdx;
    if (cropModeIndex >= 0) selectedPhotoIndex = bodyIdx;
    render();
  }
});
