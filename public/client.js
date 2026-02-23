// public/client.js - Sharebooth: layouts, decorations, live GIF, challenges

const socket = io({ transports: ['websocket'], upgrade: false });

// No beforeunload disconnect — let Socket.IO handle it naturally
// with server-side grace period for reconnection

// ===== State =====
let sessionCode = null;
let participants = [];
let layers = [];       // sparse: layers[slotIndex] = photo object or null
let photoBank = [];    // unassigned photos (max MAX_PHOTOS total)
const MAX_PHOTOS = 8;
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
let frameBgColor = '#8070B6';    // default purple (matches heart/accent)
let frameBgImage = null;         // Image element
let frameBgScale = 0.25;         // tile size as fraction of canvas width (0.05–1.0)

// Frame shape (defaults — applied to new photos, or overridden per-photo)
let frameShapeDefault = 'rounded';  // default for new photos
let frameBorderWidth = 4;
let frameBorderRadius = 4;
let frameBorderColor = '#ffffff'; // default border color
let selectedPhotoIndex = -1;     // which photo is selected for per-photo shape editing

// Photo drag-to-move
let isDraggingPhoto = false;
let dragPhotoIndex = -1;
let dragPhotoOffset = { x: 0, y: 0 };
let dragPhotoInitialOffset = { x: 0, y: 0 };

// Crop mode (double-click to pan/zoom image within frame)
let cropModeIndex = -1;
let isCropPanning = false;
let cropPanStart = { x: 0, y: 0 };
let cropPanStartOffset = { x: 0, y: 0 };
let isCropZooming = false;
let cropZoomStartDist = 0;
let cropZoomStartScale = 1;

// Photo rotation
let isRotatingPhoto = false;
let rotatePhotoIndex = -1;
let rotateStartAngle = 0;
let rotateStartRotation = 0;

// Double-tap detection for mobile
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

// Decorations (replaces old reaction layer)
let decorations = [];
let selectedDecoId = null;
let currentDecoTool = 'none'; // 'none' | 'sticker' | 'text'
let currentStickerEmoji = '\u2764\uFE0F';
let currentStickerType = 'emoji'; // 'emoji' | 'image'
let currentStickerImageSrc = null;
const stickerImageCache = {}; // src -> Image
let isDragging = false;
let dragDeco = null;
let dragOffset = { x: 0, y: 0 };

// Layout
let currentLayout = 'strip';
let canvasRatioOverride = 3 / 8; // default to 4-Cut Strip

// Wizard state
let wizardStep = 1;
let wizardAspectRatio = '4cut';
let wizardLayout = 'strip';
let wizardPassword = '';

// URL routing: check if URL contains a room code
function getRoomCodeFromURL() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts.length === 1 && /^\d{4}$/.test(pathParts[0])) {
    return pathParts[0];
  }
  return null;
}
const urlRoomCode = getRoomCodeFromURL();

// Export state (hides editor UI during export)
let isExporting = false;

// (Date/names are now decoration elements — no overlay state needed)

// Logo
const logoDark = new Image();
logoDark.src = '/assets/logo/dark.png';
const logoLight = new Image();
logoLight.src = '/assets/logo/light.png';
// Decoration rotation
let isRotatingDeco = false;
let rotateDecoId = null;
let rotateDecoStartAngle = 0;
let rotateDecoStartRotation = 0;

const RATIO_MAP = {
  'auto': null,
  'ig-post': 4 / 5,
  'ig-story': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '2:3': 2 / 3,
  '4cut': 3 / 8,
};

// Prompts
let selectedCategory = 'mix';
let countdownInterval = null;

// ===== Layout Definitions =====
// All layouts use consistent spacing:
// edge padding = 0.04, gap between photos = 0.03, top reserved for branding = 0.07
// Max border width slider capped at 5 so borders never exceed half the gap.
const LAYOUTS = {
  '2cut': {
    aspectRatio: 2 / 3,
    slots: [
      { x: 0.04, y: 0.08, w: 0.92, h: 0.43 },
      { x: 0.04, y: 0.54, w: 0.92, h: 0.43 },
    ]
  },
  'strip3': {
    aspectRatio: 1 / 2.5,
    slots: [
      { x: 0.04, y: 0.07, w: 0.92, h: 0.28 },
      { x: 0.04, y: 0.38, w: 0.92, h: 0.28 },
      { x: 0.04, y: 0.69, w: 0.92, h: 0.28 },
    ]
  },
  'strip': {
    aspectRatio: 1 / 3,
    slots: [
      { x: 0.04, y: 0.06, w: 0.92, h: 0.20 },
      { x: 0.04, y: 0.29, w: 0.92, h: 0.20 },
      { x: 0.04, y: 0.52, w: 0.92, h: 0.20 },
      { x: 0.04, y: 0.75, w: 0.92, h: 0.20 },
    ]
  },
  '2x2': {
    aspectRatio: 3 / 4,
    slots: [
      { x: 0.04, y: 0.08, w: 0.45, h: 0.42 },
      { x: 0.52, y: 0.08, w: 0.45, h: 0.42 },
      { x: 0.04, y: 0.53, w: 0.45, h: 0.42 },
      { x: 0.52, y: 0.53, w: 0.45, h: 0.42 },
    ]
  },
  '6cut': {
    aspectRatio: 2 / 3,
    slots: [
      { x: 0.04, y: 0.07, w: 0.45, h: 0.28 },
      { x: 0.52, y: 0.07, w: 0.45, h: 0.28 },
      { x: 0.04, y: 0.38, w: 0.45, h: 0.28 },
      { x: 0.52, y: 0.38, w: 0.45, h: 0.28 },
      { x: 0.04, y: 0.69, w: 0.45, h: 0.28 },
      { x: 0.52, y: 0.69, w: 0.45, h: 0.28 },
    ]
  },
  '1big3': {
    aspectRatio: 4 / 3,
    slots: [
      { x: 0.04, y: 0.08, w: 0.56, h: 0.88 },
      { x: 0.63, y: 0.08, w: 0.34, h: 0.27 },
      { x: 0.63, y: 0.38, w: 0.34, h: 0.27 },
      { x: 0.63, y: 0.69, w: 0.34, h: 0.27 },
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
  const ratio = canvasRatioOverride !== null ? canvasRatioOverride : layoutDef.aspectRatio;

  // Compute the max available space from the parent container
  const parent = preview.parentElement;
  const parentRect = parent.getBoundingClientRect();
  // Available height: parent height minus toolbar and gaps (~60px for toolbar)
  const maxW = parentRect.width;
  const maxH = Math.max(200, parentRect.height - 60);

  // Compute actual canvas size that fits within maxW x maxH at the given aspect ratio
  let w, h;
  if (ratio >= 1) {
    // Landscape or square: width-limited
    w = Math.min(maxW, maxH * ratio);
    h = w / ratio;
  } else {
    // Portrait: height-limited
    h = Math.min(maxH, maxW / ratio);
    w = h * ratio;
  }
  // Ensure it doesn't exceed available width
  if (w > maxW) { w = maxW; h = w / ratio; }
  // Ensure it doesn't exceed available height
  if (h > maxH) { h = maxH; w = h * ratio; }

  w = Math.round(w);
  h = Math.round(h);

  preview.style.aspectRatio = String(ratio);
  preview.style.width = w + 'px';
  preview.style.maxWidth = w + 'px';
  preview.style.height = h + 'px';

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
  if (typeof positionFloatingShapePicker === 'function') positionFloatingShapePicker(selectedPhotoIndex);
}
window.addEventListener('resize', () => resizeCanvasImmediate());

// ===== Layer & Photo Bank Management =====
function findPhotoByImageUrl(url) {
  const inBank = photoBank.find(p => p.imageUrl === url);
  if (inBank) return inBank;
  return layers.find(l => l && l.imageUrl === url);
}
function findPhotoByTempId(tid) {
  const inBank = photoBank.find(p => p.tempId && p.tempId === tid);
  if (inBank) return inBank;
  return layers.find(l => l && l.tempId && l.tempId === tid);
}
function getTotalPhotoCount() {
  return photoBank.length + layers.filter(l => l !== null).length;
}
function getAssignedCount() {
  return layers.filter(l => l !== null).length;
}
// Ensure layers array matches current layout slot count
function ensureLayerSlots() {
  const max = getMaxSlots();
  if (max === Infinity) return; // freeform: dynamic
  // Grow: fill new slots with null
  while (layers.length < max) layers.push(null);
  // Shrink: unassign excess photos back to bank
  while (layers.length > max) {
    const removed = layers.pop();
    if (removed) photoBank.push(removed);
  }
}

function createPhotoObj(obj) {
  return {
    id: obj.id || null,
    tempId: obj.tempId || null,
    imageUrl: obj.imageUrl,
    owner: obj.owner || 'Anon',
    ts: obj.ts || now(),
    state: obj.state || 'pending',
    dropProgress: 0,
    dropStartTs: null,
    scale: obj.scale || 1,
    shape: obj.shape || frameShapeDefault,
    borderColor: obj.borderColor || null,
    offsetX: obj.offsetX || 0,
    offsetY: obj.offsetY || 0,
    cropX: obj.cropX || 0,
    cropY: obj.cropY || 0,
    cropScale: obj.cropScale || 1,
  };
}

function addToPhotoBank(obj) {
  if (!obj || !obj.imageUrl) return null;
  const existing = findPhotoByImageUrl(obj.imageUrl);
  if (existing) {
    if (existing.state === 'pending' && obj.state === 'confirmed') {
      existing.state = 'confirmed';
      if (obj.id) existing.id = obj.id;
    }
    return existing;
  }
  const photo = createPhotoObj(obj);
  photoBank.push(photo);
  renderPhotoBank();
  renderVbgPhotos();
  render();
  updateSnapButton();
  return photo;
}

function confirmLayerFromServer(serverLayer) {
  if (!serverLayer || !serverLayer.imageUrl) return;
  const existing = findPhotoByImageUrl(serverLayer.imageUrl);
  if (existing) {
    existing.id = serverLayer.id || existing.id;
    existing.owner = serverLayer.owner || existing.owner;
    existing.ts = serverLayer.timestamp || existing.ts;
    existing.state = 'confirmed';
    if (existing.dropProgress === 0) existing.dropProgress = 1;
  } else {
    addToPhotoBank({
      id: serverLayer.id, imageUrl: serverLayer.imageUrl,
      owner: serverLayer.owner, ts: serverLayer.timestamp, state: 'confirmed'
    });
  }
  renderPhotoBank();
  renderVbgPhotos();
  render();
}

// ===== Photo Bank (below canvas) =====
function renderPhotoBank() {
  const container = document.getElementById('thumbs');
  container.innerHTML = '';

  // Assigned slot photos first (top of gallery)
  const max = getMaxSlots();
  const slotCount = max === Infinity ? getAssignedCount() : max;
  for (let i = 0; i < slotCount; i++) {
    const l = layers[i];
    if (!l) continue;
    const isLayerPending = l.state === 'pending';
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb-wrapper thumb-assigned' + (isLayerPending ? ' thumb-pending' : '');
    wrapper.draggable = !isLayerPending;
    wrapper.dataset.slotIndex = i;

    if (!isLayerPending) {
      wrapper.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/slot-index', String(i));
        e.dataTransfer.effectAllowed = 'move';
        wrapper.classList.add('thumb-dragging');
      });
      wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('thumb-dragging');
      });
    }

    const img = document.createElement('img');
    img.className = 'thumb-img';
    if (!isLayerPending) {
      img.onerror = () => { img.style.background = '#ddd'; img.removeAttribute('src'); };
    }
    img.title = isLayerPending ? 'Uploading...' : 'Slot ' + (i + 1) + ' — ' + (l.owner || '');
    if (l.imageUrl) img.src = l.imageUrl;
    wrapper.appendChild(img);

    // Uploading overlay for pending photos
    if (isLayerPending) {
      const overlay = document.createElement('div');
      overlay.className = 'thumb-uploading-overlay';
      overlay.textContent = 'Uploading...';
      wrapper.appendChild(overlay);
    }

    // Corner marker showing frame slot number
    const marker = document.createElement('span');
    marker.className = 'thumb-frame-marker';
    marker.textContent = '#' + (i + 1);
    wrapper.appendChild(marker);

    // Unassign button (only for confirmed photos)
    if (!isLayerPending) {
      const unassign = document.createElement('button');
      unassign.className = 'thumb-delete-btn';
      unassign.textContent = '\u21A9';
      unassign.title = 'Remove from frame';
      unassign.onclick = ((idx) => (e) => {
        e.stopPropagation();
        unassignFromSlot(idx);
      })(i);
      wrapper.appendChild(unassign);
    }

    container.appendChild(wrapper);
  }

  // Bank photos below (new photos appear at bottom)
  for (let i = 0; i < photoBank.length; i++) {
    const p = photoBank[i];
    const isPending = p.state === 'pending';
    const wrapper = document.createElement('div');
    wrapper.className = 'thumb-wrapper bank-photo' + (isPending ? ' thumb-pending' : '');
    wrapper.draggable = !isPending;
    wrapper.dataset.bankIndex = i;

    if (!isPending) {
      wrapper.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/bank-index', String(i));
        e.dataTransfer.effectAllowed = 'move';
        wrapper.classList.add('thumb-dragging');
      });
      wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('thumb-dragging');
      });
    }

    const img = document.createElement('img');
    img.className = 'thumb-img';
    if (!isPending) {
      img.onerror = () => { img.style.background = '#ddd'; img.removeAttribute('src'); };
    }
    img.title = isPending ? 'Uploading...' : (p.owner || '') + ' (drag to frame)';
    if (p.imageUrl) img.src = p.imageUrl;
    wrapper.appendChild(img);

    // Uploading overlay for pending photos
    if (isPending) {
      const overlay = document.createElement('div');
      overlay.className = 'thumb-uploading-overlay';
      overlay.textContent = 'Uploading...';
      wrapper.appendChild(overlay);
    }

    // Delete button (only for confirmed photos)
    if (!isPending) {
      const del = document.createElement('button');
      del.className = 'thumb-delete-btn';
      del.textContent = '\u00D7';
      del.title = 'Delete photo';
      del.onclick = ((idx) => (e) => {
        e.stopPropagation();
        photoBank.splice(idx, 1);
        renderPhotoBank();
        updateSnapButton();
      })(i);
      wrapper.appendChild(del);
    }

    container.appendChild(wrapper);
  }
}

function assignToSlot(bankIndex, slotIndex) {
  if (bankIndex < 0 || bankIndex >= photoBank.length) return;
  // Block assigning pending (still uploading) photos
  if (photoBank[bankIndex].state === 'pending') return;
  const max = getMaxSlots();
  if (max !== Infinity && slotIndex >= max) return;
  const photo = photoBank.splice(bankIndex, 1)[0];
  // If slot already has a photo, preserve its transforms then send it back to bank
  const oldPhoto = layers[slotIndex];
  if (oldPhoto) {
    // Copy the old photo's frame transforms to the new photo
    photo.scale = oldPhoto.scale || 1;
    photo.shape = oldPhoto.shape || frameShapeDefault;
    photo.borderColor = oldPhoto.borderColor || null;
    photo.offsetX = oldPhoto.offsetX || 0;
    photo.offsetY = oldPhoto.offsetY || 0;
    photo.cropX = oldPhoto.cropX || 0;
    photo.cropY = oldPhoto.cropY || 0;
    photo.cropScale = oldPhoto.cropScale || 1;
    photo.rotation = oldPhoto.rotation || 0;
    // Reset old photo's transforms before returning to bank
    oldPhoto.scale = 1;
    oldPhoto.offsetX = 0;
    oldPhoto.offsetY = 0;
    oldPhoto.cropX = 0;
    oldPhoto.cropY = 0;
    oldPhoto.cropScale = 1;
    oldPhoto.rotation = 0;
    photoBank.push(oldPhoto);
  }
  photo.dropProgress = 0;
  photo.dropStartTs = null;
  layers[slotIndex] = photo;
  renderPhotoBank();
  render();
  updateSnapButton();
  if (sessionCode) socket.emit('slot-assign', { code: sessionCode, slotIndex, photoId: photo.id });
}

function unassignFromSlot(slotIndex) {
  if (slotIndex < 0 || !layers[slotIndex]) return;
  const photo = layers[slotIndex];
  layers[slotIndex] = null;
  photoBank.push(photo);
  selectedPhotoIndex = -1;
  if (cropModeIndex === slotIndex) cropModeIndex = -1;
  updateShapeUIForPhoto(-1);
  renderPhotoBank();
  render();
  updateSnapButton();
  if (sessionCode) socket.emit('slot-unassign', { code: sessionCode, slotIndex });
}

function swapSlots(fromSlot, toSlot) {
  const temp = layers[fromSlot];
  layers[fromSlot] = layers[toSlot];
  layers[toSlot] = temp;
  if (selectedPhotoIndex === fromSlot) selectedPhotoIndex = toSlot;
  else if (selectedPhotoIndex === toSlot) selectedPhotoIndex = fromSlot;
  if (cropModeIndex === fromSlot) cropModeIndex = toSlot;
  else if (cropModeIndex === toSlot) cropModeIndex = fromSlot;
  renderPhotoBank();
  render();
  if (sessionCode) socket.emit('photo-swap', { code: sessionCode, fromIndex: fromSlot, toIndex: toSlot });
}

// ===== Camera & Upload =====
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = localStream;
    cameraRunning = true;
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

let isProcessingSnap = false;

function setSnapProcessing(processing) {
  isProcessingSnap = processing;
  const snapBtn = document.getElementById('snap');
  const stopBtn = document.getElementById('btnStopCamera');
  const overlay = document.getElementById('bgProcessing');
  if (processing) {
    snapBtn.disabled = true;
    snapBtn.style.opacity = '0.4';
    stopBtn.disabled = true;
    overlay.querySelector('span').textContent = 'Advanced background removal is processing, please wait\u2026';
    overlay.style.display = 'flex';
    if (segmentationLoop) { cancelAnimationFrame(segmentationLoop); segmentationLoop = null; }
  } else {
    snapBtn.disabled = !cameraRunning;
    snapBtn.style.opacity = cameraRunning ? '1' : '0.4';
    stopBtn.disabled = false;
    overlay.style.display = 'none';
    if (virtualBgEnabled && cameraRunning) startLivePreview();
  }
}

async function doSnap() {
  if (isProcessingSnap) return;
  if (getTotalPhotoCount() >= MAX_PHOTOS) return;

  let tmpCanvas;
  if (video && video.readyState >= 2) {
    const targetW = 480;
    const targetH = Math.round(targetW * (video.videoHeight / video.videoWidth || 3 / 4));
    tmpCanvas = document.createElement('canvas'); tmpCanvas.width = targetW; tmpCanvas.height = targetH;
    tmpCanvas.getContext('2d').drawImage(video, 0, 0, targetW, targetH);
  } else {
    tmpCanvas = document.createElement('canvas'); tmpCanvas.width = 480; tmpCanvas.height = 360;
    const tc = tmpCanvas.getContext('2d'); tc.fillStyle = '#ccc'; tc.fillRect(0, 0, 480, 360);
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

  snapAndEmit(tmpCanvas);
}

// Convert canvas to data URL and emit directly via socket — no file upload needed
function snapAndEmit(processedCanvas) {
  const dataUrl = processedCanvas.toDataURL('image/jpeg', 0.7);
  const id = generateId();
  addToPhotoBank({ id, imageUrl: dataUrl, owner: getMyName(), state: 'confirmed' });
  socket.emit('snapped', { code: sessionCode, id, imageData: dataUrl, name: getMyName() });
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

async function removeBackground(srcCanvas) {
  const blob = await new Promise(r => srcCanvas.toBlob(r, 'image/png'));
  // Overlay is managed by setSnapProcessing — no need to toggle here
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
  const d = devicePixelRatioVal;
  const bw = frameBorderWidth * d; // account for border width
  const margin = Math.max(24 * d, bw * 2 + 12 * d); // gap includes border space
  const cols = Math.min(3, Math.max(1, Math.floor((cw - margin) / (240 * d))));
  const thumbW = Math.min(300 * d, Math.floor((cw - margin * (cols + 1)) / cols));
  const thumbH = Math.round(thumbW * 0.75);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      x: margin + (i % cols) * (thumbW + margin),
      y: 60 * d + Math.floor(i / cols) * (thumbH + margin),
      w: thumbW,
      h: thumbH
    });
  }
  return slots;
}

function getMaxSlots() {
  const def = LAYOUTS[currentLayout];
  if (!def || !def.slots) return Infinity; // freeform
  return def.slots.length;
}

function updateSnapButton() {
  const total = getTotalPhotoCount();
  const snapBtn = document.getElementById('snap');
  const counter = document.getElementById('photoCounter');

  if (total >= MAX_PHOTOS) {
    snapBtn.disabled = true;
    snapBtn.style.opacity = '0.4';
    counter.textContent = total + ' / ' + MAX_PHOTOS + ' photos (delete some to continue)';
    counter.classList.add('photo-counter-full');
  } else {
    snapBtn.disabled = false;
    snapBtn.style.opacity = '1';
    counter.classList.remove('photo-counter-full');
    counter.textContent = total > 0 ? total + '/' + MAX_PHOTOS : '';
  }
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
    // Tiled/repeated background based on frameBgScale
    const tileW = Math.max(10, cw * frameBgScale);
    const aspect = frameBgImage.naturalWidth / frameBgImage.naturalHeight || 1;
    const tileH = tileW / aspect;
    for (let ty = 0; ty < ch; ty += tileH) {
      for (let tx = 0; tx < cw; tx += tileW) {
        ctx.drawImage(frameBgImage, tx, ty, tileW, tileH);
      }
    }
  } else {
    ctx.fillStyle = frameBgColor;
    ctx.fillRect(0, 0, cw, ch);
  }

  const d = devicePixelRatioVal;

  // Logo is now rendered as a decoration in renderDecorations()

  const max = getMaxSlots();
  const slotCount = max === Infinity ? getAssignedCount() : max;
  const slots = getLayoutSlots(cw, ch, slotCount || 1);

  if (slotCount === 0 && max === Infinity) {
    // Freeform with nothing assigned
    if (!isExporting) {
      ctx.fillStyle = 'rgba(139,107,74,0.25)';
      ctx.font = `${16 * d}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Snap photos, then drag them here!', cw / 2, ch / 2);
      ctx.textAlign = 'left';
    }
    return;
  }

  const t = typeof time === 'number' ? time : performance.now();

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const l = i < layers.length ? layers[i] : null;

    if (!l) {
      // Empty slot placeholder — only show in edit mode
      if (!isExporting) {
        const pad = 4 * d;
        // Pick opposite color to background for visibility
        const isLightBg = getLogoVariant() === logoDark; // light bg → logoDark
        const slotColor = isLightBg ? 'rgba(90, 78, 124, 0.35)' : 'rgba(255, 255, 255, 0.4)';
        const slotTextColor = isLightBg ? 'rgba(90, 78, 124, 0.5)' : 'rgba(255, 255, 255, 0.55)';
        ctx.save();
        ctx.strokeStyle = slotColor;
        ctx.lineWidth = 2 * d;
        ctx.setLineDash([8 * d, 6 * d]);
        ctx.strokeRect(slot.x + pad, slot.y + pad, slot.w - pad * 2, slot.h - pad * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = slotTextColor;
        const fontSize = Math.max(10, Math.min(14, slot.w / (14 * d))) * d;
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Drag to input image', slot.x + slot.w / 2, slot.y + slot.h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
      continue;
    }

    // Drop animation
    if (!l.dropStartTs) l.dropStartTs = now();
    if (l.dropProgress < 1) l.dropProgress = Math.min(1, (now() - l.dropStartTs) / 450);
    const dropOffset = isExporting ? 0 : (1 - l.dropProgress) * 30 * d;

    const img = await loadImage(l.imageUrl);
    const rot = l.rotation || 0;

    // Apply per-photo scale and offset
    const s = l.scale || 1;
    const sw = slot.w * s, sh = slot.h * s;
    const sx = slot.x + (slot.w - sw) / 2 + (l.offsetX || 0);
    const sy = slot.y + (slot.h - sh) / 2 + dropOffset + (l.offsetY || 0);
    drawPolaroid(img, sx, sy, sw, sh, rot, l, t, i);

    // Editor-only UI: selection highlights, handles — rotated with image
    if (!isExporting) {
      const isCrop = (i === cropModeIndex);
      const isSelected = (i === selectedPhotoIndex);
      const rot = l.rotation || 0;

      // Crop mode highlight (blue) — rotated
      if (isCrop) {
        ctx.save();
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate(rot);
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.85)';
        ctx.lineWidth = 3 * d;
        ctx.setLineDash([4 * d, 4 * d]);
        ctx.strokeRect(-sw / 2 - 2, -sh / 2 - 2, sw + 4, sh + 4);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 150, 255, 0.85)';
        ctx.font = `600 ${11 * d}px Inter, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('CROP', -sw / 2 + 4, -sh / 2 - 6);
        ctx.restore();
      }
      // Selected photo highlight (pink) — rotated
      else if (isSelected) {
        ctx.save();
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate(rot);
        ctx.strokeStyle = 'rgba(255, 107, 129, 0.85)';
        ctx.lineWidth = 3 * d;
        ctx.setLineDash([8 * d, 5 * d]);
        ctx.strokeRect(-sw / 2 - 2, -sh / 2 - 2, sw + 4, sh + 4);
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw corner resize handles — rotated
      if (isCrop || isSelected) {
        const hs = 8 * d;
        ctx.save();
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate(rot);
        ctx.fillStyle = isCrop ? 'rgba(0,150,255,0.85)' : 'rgba(255,107,129,0.9)';
        const corners = [[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [-sw / 2, sh / 2], [sw / 2, sh / 2]];
        for (const [cx, cy] of corners) {
          ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        }
        ctx.restore();
      }

      // Rotation handle (below center) — rotated
      if (isSelected && !isCrop) {
        const rhr = 7 * d;
        ctx.save();
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate(rot);
        ctx.strokeStyle = 'rgba(255,107,129,0.6)';
        ctx.lineWidth = 1.5 * d;
        ctx.beginPath();
        ctx.moveTo(0, sh / 2);
        ctx.lineTo(0, sh / 2 + 24 * d);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, sh / 2 + 24 * d, rhr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,107,129,0.9)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * d;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `${9 * d}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u21BB', 0, sh / 2 + 24 * d);
        ctx.restore();
      }
    }
  }

  // Re-render decorations (including logo) so they react to bg changes
  renderDecorations();
}

function drawPolaroid(img, x, y, w, h, rotation, layer, time, index) {
  const d = devicePixelRatioVal;
  const isFreeform = (currentLayout === 'freeform');
  const bw = isFreeform ? 0 : frameBorderWidth * d;
  const br = isFreeform ? 0 : frameBorderRadius * d;
  const borderBottom = bw; // consistent border on all sides
  const shape = layer.shape || frameShapeDefault;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);

  const borderCol = layer.borderColor || frameBorderColor;
  const hw = w / 2, hh = h / 2; // half-width, half-height for maximized bounding box

  if (!isFreeform) {
    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 12 * d;
    ctx.shadowOffsetY = 3 * d;
  }

  // Draw frame border (shape-aware) — skip in freeform
  if (!isFreeform) {
  if (shape === 'circle') {
    const r = Math.min(hw, hh) + bw;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'oval') {
    drawOvalPath(ctx, 0, 0, hw + bw, hh + bw);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'heart') {
    drawHeartPath(ctx, 0, 0, hw + bw, hh + bw);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'star') {
    drawStarPath(ctx, 0, 0, hw + bw, hh + bw, 5);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else if (shape === 'cloud') {
    drawCloudPath(ctx, 0, 0, hw + bw, hh + bw);
    ctx.fillStyle = borderCol;
    ctx.fill();
  } else {
    const frameX = -hw - bw;
    const frameY = -hh - bw;
    const frameW = w + bw * 2;
    const frameH = h + bw + borderBottom;
    roundRect(ctx, frameX, frameY, frameW, frameH, br);
    ctx.fillStyle = borderCol;
    ctx.fill();
  }
  } // end if (!isFreeform) border

  ctx.shadowColor = 'transparent';

  // Clip & draw image (shape-aware, with crop support)
  const hasCrop = layer.cropX || layer.cropY || (layer.cropScale && layer.cropScale !== 1);
  const drawImg = (img) => hasCrop ? drawImageCoverCropped(ctx, img, -hw, -hh, w, h, layer) : drawImageCover(ctx, img, -hw, -hh, w, h);
  ctx.save();
  if (shape === 'circle') {
    const r = Math.min(hw, hh);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  } else if (shape === 'oval') {
    drawOvalPath(ctx, 0, 0, hw, hh);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  } else if (shape === 'heart') {
    drawHeartPath(ctx, 0, 0, hw, hh);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  } else if (shape === 'star') {
    drawStarPath(ctx, 0, 0, hw, hh, 5);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  } else if (shape === 'cloud') {
    drawCloudPath(ctx, 0, 0, hw, hh);
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  } else {
    roundRect(ctx, -hw, -hh, w, h, Math.max(1, br - 2));
    ctx.clip();
    if (img) drawImg(img);
    else { ctx.fillStyle = '#eee'; ctx.fillRect(-hw, -hh, w, h); }
  }
  ctx.restore();

  ctx.restore();
}

// Shape path helpers — all shapes use hw/hh (half-width/half-height) for maximized bounding box

function drawHeartPath(c, cx, cy, hw, hh) {
  // Heart that fills the bounding box (hw x hh) maximally
  c.beginPath();
  const w = hw, h = hh;
  // Bottom tip
  c.moveTo(cx, cy + h * 0.85);
  // Left curve
  c.bezierCurveTo(cx - w * 1.1, cy + h * 0.1, cx - w * 1.0, cy - h * 0.7, cx, cy - h * 0.35);
  // Right curve
  c.bezierCurveTo(cx + w * 1.0, cy - h * 0.7, cx + w * 1.1, cy + h * 0.1, cx, cy + h * 0.85);
  c.closePath();
}

function drawStarPath(c, cx, cy, hw, hh, points) {
  c.beginPath();
  const outerW = hw, outerH = hh;
  const innerW = hw * 0.4, innerH = hh * 0.4;
  for (let i = 0; i < points * 2; i++) {
    const rw = i % 2 === 0 ? outerW : innerW;
    const rh = i % 2 === 0 ? outerH : innerH;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const px = cx + Math.cos(angle) * rw;
    const py = cy + Math.sin(angle) * rh;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function drawOvalPath(c, cx, cy, hw, hh) {
  c.beginPath();
  c.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
  c.closePath();
}

function drawCloudPath(c, cx, cy, hw, hh) {
  // Cloud shape using overlapping arcs, fits within hw x hh
  c.beginPath();
  const w = hw * 0.95, h = hh * 0.85;
  // Bottom flat-ish
  c.moveTo(cx - w * 0.7, cy + h * 0.45);
  // Bottom-left bump
  c.bezierCurveTo(cx - w * 1.0, cy + h * 0.45, cx - w * 1.0, cy - h * 0.1, cx - w * 0.65, cy - h * 0.2);
  // Top-left bump
  c.bezierCurveTo(cx - w * 0.65, cy - h * 0.75, cx - w * 0.2, cy - h * 0.95, cx, cy - h * 0.7);
  // Top-right bump
  c.bezierCurveTo(cx + w * 0.25, cy - h * 0.95, cx + w * 0.7, cy - h * 0.7, cx + w * 0.65, cy - h * 0.15);
  // Right bump
  c.bezierCurveTo(cx + w * 1.0, cy - h * 0.05, cx + w * 1.0, cy + h * 0.45, cx + w * 0.7, cy + h * 0.45);
  // Close bottom
  c.lineTo(cx - w * 0.7, cy + h * 0.45);
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
  const cw = decoCanvas.width || 1, ch = decoCanvas.height || 1;
  if (d.type === 'text') {
    const size = (d.fontSize || 18) * (d.scale || 1) * devicePixelRatioVal;
    decoCtx.font = `${d.fontWeight || 600} ${size}px '${d.fontFamily || "Baloo 2"}', cursive`;
    const metrics = decoCtx.measureText(d.content);
    const w = metrics.width / cw;
    const h = size / ch;
    const padW = d.showBg ? 1.3 : 1.15;
    const padH = d.showBg ? 1.6 : 1.4;
    return { w: w * padW, h: h * padH };
  }
  if (d.type === 'logo') {
    const logo = getLogoVariant();
    if (!logo || !logo.complete || !logo.naturalWidth) return { w: 0.1, h: 0.03 };
    const brandH = Math.max(10, Math.min(15, ch * 0.028)) * devicePixelRatioVal * 1.8;
    const aspect = logo.naturalWidth / logo.naturalHeight;
    const brandW = brandH * aspect;
    const lw = brandW * (d.scale || 1), lh = brandH * (d.scale || 1);
    return { w: lw / cw, h: lh / ch };
  }
  if (d.type === 'image-sticker') {
    const img = stickerImageCache[d.content];
    const size = 64 * (d.scale || 1) * devicePixelRatioVal;
    if (img && img.complete) {
      const aspect = img.naturalWidth / img.naturalHeight || 1;
      const drawW = aspect >= 1 ? size : size * aspect;
      const drawH = aspect >= 1 ? size / aspect : size;
      return { w: drawW / cw, h: drawH / ch };
    }
    return { w: size / cw, h: size / ch };
  }
  // emoji sticker
  const size = 32 * (d.scale || 1) * devicePixelRatioVal;
  return { w: size / cw, h: size / ch };
}

function toLocalDecoCoords(nx, ny, d) {
  const rot = d.rotation || 0;
  if (!rot) return { x: nx, y: ny };
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = nx - d.x, dy = ny - d.y;
  return { x: dx * cos - dy * sin + d.x, y: dx * sin + dy * cos + d.y };
}

function hitTestDeco(nx, ny) {
  for (let i = decorations.length - 1; i >= 0; i--) {
    const d = decorations[i];
    const s = getDecoSize(d);
    const local = toLocalDecoCoords(nx, ny, d);
    if (local.x >= d.x - s.w / 2 && local.x <= d.x + s.w / 2 &&
        local.y >= d.y - s.h / 2 && local.y <= d.y + s.h / 2) {
      return d;
    }
  }
  return null;
}

function drawSingleDeco(d, cw, ch) {
  const px = d.x * cw, py = d.y * ch;
  const rot = d.rotation || 0;

  decoCtx.save();
  if (rot) {
    decoCtx.translate(px, py);
    decoCtx.rotate(rot);
    decoCtx.translate(-px, -py);
  }

  if (d.type === 'sticker') {
    const size = 32 * (d.scale || 1) * devicePixelRatioVal;
    decoCtx.font = `${size}px serif`;
    decoCtx.textAlign = 'center';
    decoCtx.textBaseline = 'middle';
    decoCtx.fillText(d.content, px, py);
  } else if (d.type === 'image-sticker') {
    const img = stickerImageCache[d.content];
    if (img && img.complete) {
      const size = 64 * (d.scale || 1) * devicePixelRatioVal;
      const aspect = img.naturalWidth / img.naturalHeight || 1;
      const drawW = aspect >= 1 ? size : size * aspect;
      const drawH = aspect >= 1 ? size / aspect : size;
      decoCtx.drawImage(img, px - drawW / 2, py - drawH / 2, drawW, drawH);
    }
  } else if (d.type === 'text') {
    const size = (d.fontSize || 18) * (d.scale || 1) * devicePixelRatioVal;
    decoCtx.font = `${d.fontWeight || 600} ${size}px '${d.fontFamily || "Baloo 2"}', cursive`;
    decoCtx.textAlign = 'center';
    decoCtx.textBaseline = 'middle';
    // Draw background if enabled
    if (d.showBg && d.bgColor) {
      const metrics = decoCtx.measureText(d.content);
      const pad = size * 0.3;
      decoCtx.fillStyle = d.bgColor;
      const rr = size * 0.15;
      const rx = px - metrics.width / 2 - pad;
      const ry = py - size / 2 - pad / 2;
      const rw = metrics.width + pad * 2;
      const rh = size + pad;
      decoCtx.beginPath();
      decoCtx.roundRect(rx, ry, rw, rh, rr);
      decoCtx.fill();
    }
    decoCtx.fillStyle = d.color || '#8B6B4A';
    decoCtx.fillText(d.content, px, py);
  } else if (d.type === 'logo') {
    const logo = getLogoVariant();
    if (logo && logo.complete && logo.naturalWidth > 0) {
      const brandH = Math.max(10, Math.min(15, ch * 0.028)) * devicePixelRatioVal * 1.8;
      const aspect = logo.naturalWidth / logo.naturalHeight;
      const brandW = brandH * aspect;
      const lw = brandW * (d.scale || 1), lh = brandH * (d.scale || 1);
      decoCtx.globalAlpha = 0.85;
      decoCtx.drawImage(logo, px - lw / 2, py - lh / 2, lw, lh);
      decoCtx.globalAlpha = 1;
    }
  }

  decoCtx.restore();
}

function drawDecoSelection(d, cw, ch) {
  const px = d.x * cw, py = d.y * ch;
  const s = getDecoSize(d);
  const hw = (s.w / 2) * cw, hh = (s.h / 2) * ch;
  const rot = d.rotation || 0;

  decoCtx.save();
  decoCtx.translate(px, py);
  if (rot) decoCtx.rotate(rot);

  // Bounding box
  decoCtx.strokeStyle = 'rgba(255, 107, 129, 0.8)';
  decoCtx.lineWidth = 2 * devicePixelRatioVal;
  decoCtx.setLineDash([6, 4]);
  decoCtx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  decoCtx.setLineDash([]);

  // Corner resize handles
  const handleSize = 6 * devicePixelRatioVal;
  decoCtx.fillStyle = 'rgba(255, 107, 129, 0.9)';
  const corners = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]];
  for (const [cx, cy] of corners) {
    decoCtx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
  }

  // Rotation handle (below center) — for text and logo
  if (d.type === 'text' || d.type === 'logo') {
    const rhr = 7 * devicePixelRatioVal;
    const handleDist = hh + 24 * devicePixelRatioVal;
    decoCtx.strokeStyle = 'rgba(255,107,129,0.6)';
    decoCtx.lineWidth = 1.5 * devicePixelRatioVal;
    decoCtx.beginPath();
    decoCtx.moveTo(0, hh);
    decoCtx.lineTo(0, handleDist);
    decoCtx.stroke();
    decoCtx.beginPath();
    decoCtx.arc(0, handleDist, rhr, 0, Math.PI * 2);
    decoCtx.fillStyle = 'rgba(255,107,129,0.9)';
    decoCtx.fill();
    decoCtx.strokeStyle = '#fff';
    decoCtx.lineWidth = 2 * devicePixelRatioVal;
    decoCtx.stroke();
    decoCtx.fillStyle = '#fff';
    decoCtx.font = `${9 * devicePixelRatioVal}px sans-serif`;
    decoCtx.textAlign = 'center';
    decoCtx.textBaseline = 'middle';
    decoCtx.fillText('\u21BB', 0, handleDist);
  }

  decoCtx.restore();
}

function renderDecorations() {
  decoCtx.clearRect(0, 0, decoCanvas.width, decoCanvas.height);
  const cw = decoCanvas.width, ch = decoCanvas.height;
  if (cw === 0 || ch === 0) return;

  // Pass 1: draw all non-selected decorations
  for (const d of decorations) {
    if (d.id === selectedDecoId) continue;
    drawSingleDeco(d, cw, ch);
  }

  // Pass 2: draw selected decoration on top
  const selected = decorations.find(d => d.id === selectedDecoId);
  if (selected) {
    drawSingleDeco(selected, cw, ch);
    if (!isExporting) drawDecoSelection(selected, cw, ch);
  }
}

// Floating delete button for selected decoration
const floatingDecoDelete = document.getElementById('floatingDecoDelete');

const floatingTextEdit = document.getElementById('floatingTextEdit');

function positionFloatingDecoDelete() {
  if (!selectedDecoId) {
    floatingDecoDelete.style.display = 'none';
    return;
  }
  const d = decorations.find(dec => dec.id === selectedDecoId);
  if (!d) { floatingDecoDelete.style.display = 'none'; return; }

  const canvasEl = document.getElementById('canvas');
  const cssW = parseFloat(canvasEl.style.width) || canvasEl.offsetWidth;
  const cssH = parseFloat(canvasEl.style.height) || canvasEl.offsetHeight;
  const s = getDecoSize(d);
  const hw = (s.w / 2) * cssW;
  const hh = (s.h / 2) * cssH;
  const cx = d.x * cssW;
  const cy = d.y * cssH;
  const rot = d.rotation || 0;

  // Top-right corner in rotated space
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const cornerX = cx + hw * cos - (-hh) * sin;
  const cornerY = cy + hw * sin + (-hh) * cos;

  floatingDecoDelete.style.display = 'flex';
  floatingDecoDelete.style.left = Math.max(0, Math.min(cssW - 15, cornerX - 5)) + 'px';
  floatingDecoDelete.style.top = Math.max(0, Math.min(cssH - 15, cornerY - 5)) + 'px';
}

function positionFloatingTextEdit() {
  if (!floatingTextEdit) return;
  if (!selectedDecoId) {
    floatingTextEdit.style.display = 'none';
    return;
  }
  const d = decorations.find(dec => dec.id === selectedDecoId);
  if (!d || d.type !== 'text') {
    floatingTextEdit.style.display = 'none';
    return;
  }

  const canvasEl = document.getElementById('canvas');
  const cssW = parseFloat(canvasEl.style.width) || canvasEl.offsetWidth;
  const cssH = parseFloat(canvasEl.style.height) || canvasEl.offsetHeight;
  const s = getDecoSize(d);
  const hh = (s.h / 2) * cssH;
  const cx = d.x * cssW;
  const cy = d.y * cssH;
  const rot = d.rotation || 0;

  // Top-center in rotated space
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const topX = cx + 0 * cos - (-hh) * sin;
  const topY = cy + 0 * sin + (-hh) * cos;

  const toolbarW = floatingTextEdit.offsetWidth || 280;
  const toolbarH = floatingTextEdit.offsetHeight || 36;

  floatingTextEdit.style.display = 'flex';
  floatingTextEdit.style.left = Math.max(0, Math.min(cssW - toolbarW, topX - toolbarW / 2)) + 'px';
  floatingTextEdit.style.top = Math.max(0, topY - toolbarH - 8) + 'px';

  // Sync control values
  document.getElementById('decoTextColor').value = d.color || '#8B6B4A';
  document.getElementById('decoTextFont').value = d.fontFamily || 'Baloo 2';
  document.getElementById('decoTextSize').value = String(d.fontSize || 18);
  document.getElementById('decoTextWeight').value = String(d.fontWeight || 600);
  document.getElementById('decoTextBg').value = d.bgColor || '#ffffff';
  document.getElementById('decoTextBgToggle').checked = !!d.showBg;
}

floatingDecoDelete.addEventListener('click', (e) => {
  e.stopPropagation();
  deleteSelectedDeco();
  floatingDecoDelete.style.display = 'none';
  if (floatingTextEdit) floatingTextEdit.style.display = 'none';
});

// Text edit toolbar event handlers
if (floatingTextEdit) {
  document.getElementById('decoTextColor').addEventListener('input', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.color = e.target.value; renderDecorations(); }
  });
  document.getElementById('decoTextFont').addEventListener('change', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.fontFamily = e.target.value; renderDecorations(); }
  });
  document.getElementById('decoTextSize').addEventListener('change', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.fontSize = parseInt(e.target.value, 10); renderDecorations(); }
  });
  document.getElementById('decoTextWeight').addEventListener('change', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.fontWeight = parseInt(e.target.value, 10); renderDecorations(); }
  });
  document.getElementById('decoTextBg').addEventListener('input', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.bgColor = e.target.value; renderDecorations(); }
  });
  document.getElementById('decoTextBgToggle').addEventListener('change', (e) => {
    const d = decorations.find(dec => dec.id === selectedDecoId);
    if (d && d.type === 'text') { d.showBg = e.target.checked; renderDecorations(); }
  });
  // Prevent pointer events on toolbar from deselecting
  floatingTextEdit.addEventListener('pointerdown', (e) => e.stopPropagation());
}

// Patch renderDecorations to also position floating UI
const _origRenderDecorations = renderDecorations;
renderDecorations = function() {
  _origRenderDecorations();
  positionFloatingDecoDelete();
  positionFloatingTextEdit();
};

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
  const local = toLocalDecoCoords(nx, ny, d);
  const s = getDecoSize(d);
  const hw = s.w / 2, hh = s.h / 2;
  const corners = [
    { x: d.x - hw, y: d.y - hh },
    { x: d.x + hw, y: d.y - hh },
    { x: d.x - hw, y: d.y + hh },
    { x: d.x + hw, y: d.y + hh },
  ];
  for (const c of corners) {
    if (Math.abs(local.x - c.x) < HANDLE_RADIUS && Math.abs(local.y - c.y) < HANDLE_RADIUS) {
      return d;
    }
  }
  return null;
}

function hitTestDecoRotateHandle(nx, ny) {
  if (!selectedDecoId) return null;
  const d = decorations.find(dec => dec.id === selectedDecoId);
  if (!d || (d.type !== 'text' && d.type !== 'logo')) return null;
  const local = toLocalDecoCoords(nx, ny, d);
  const s = getDecoSize(d);
  const hh = s.h / 2;
  // The rotation handle is at (d.x, d.y + hh + 24px_normalized)
  const cw = decoCanvas.width || 1, ch = decoCanvas.height || 1;
  const handleDistNorm = hh + (24 * devicePixelRatioVal) / ch;
  const handleX = d.x;
  const handleY = d.y + handleDistNorm;
  const dist = Math.hypot(local.x - handleX, local.y - handleY);
  if (dist < HANDLE_RADIUS * 1.5) return d;
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

  // --- Decoration rotation handle ---
  const rotHit = hitTestDecoRotateHandle(coords.x, coords.y);
  if (rotHit) {
    isRotatingDeco = true;
    rotateDecoId = rotHit.id;
    rotateDecoStartAngle = Math.atan2(coords.y - rotHit.y, coords.x - rotHit.x);
    rotateDecoStartRotation = rotHit.rotation || 0;
    return;
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
    let deco;
    if (currentStickerType === 'image' && currentStickerImageSrc) {
      deco = {
        id: generateId(), type: 'image-sticker', content: currentStickerImageSrc,
        x: coords.x, y: coords.y, scale: 1, owner: getMyName()
      };
      // Preload image into cache
      if (!stickerImageCache[currentStickerImageSrc]) {
        const img = new Image();
        img.src = currentStickerImageSrc;
        stickerImageCache[currentStickerImageSrc] = img;
        img.onload = () => renderDecorations();
      }
    } else {
      deco = {
        id: generateId(), type: 'sticker', content: currentStickerEmoji,
        x: coords.x, y: coords.y, scale: 1, owner: getMyName()
      };
    }
    decorations.push(deco);
    selectedDecoId = deco.id;
    renderDecorations();
    if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
    // Reset to Select tool after placing
    resetDecoToolToSelect();
  } else if (currentDecoTool === 'text') {
    const text = prompt('Enter text:');
    if (text) {
      const deco = {
        id: generateId(), type: 'text', content: text,
        x: coords.x, y: coords.y, scale: 1, owner: getMyName(),
        color: '#8B6B4A', fontSize: 18, fontFamily: 'Baloo 2', fontWeight: 600,
        rotation: 0, showBg: false, bgColor: '#ffffff'
      };
      decorations.push(deco);
      selectedDecoId = deco.id;
      renderDecorations();
      if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
    }
    // Reset to Select tool after placing
    resetDecoToolToSelect();
  } else {
    // --- Rotation handle ---
    const rotIdx = hitTestRotateHandle(canvasCoords.px, canvasCoords.py);
    if (rotIdx >= 0) {
      isRotatingPhoto = true;
      rotatePhotoIndex = rotIdx;
      const r = getPhotoRect(rotIdx);
      rotateStartAngle = Math.atan2(canvasCoords.py - r.centerY, canvasCoords.px - r.centerX);
      rotateStartRotation = layers[rotIdx].rotation || 0;
      return;
    }
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
        dragPhotoInitialOffset = { x: layers[bodyIdx].offsetX || 0, y: layers[bodyIdx].offsetY || 0 };
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

  // --- Photo rotation ---
  if (isRotatingPhoto && rotatePhotoIndex >= 0 && layers[rotatePhotoIndex]) {
    e.preventDefault();
    const r = getPhotoRect(rotatePhotoIndex);
    const angle = Math.atan2(canvasCoords.py - r.centerY, canvasCoords.px - r.centerX);
    layers[rotatePhotoIndex].rotation = rotateStartRotation + (angle - rotateStartAngle);
    render();
    return;
  }

  // --- Decoration rotation ---
  if (isRotatingDeco && rotateDecoId) {
    e.preventDefault();
    const d = decorations.find(dec => dec.id === rotateDecoId);
    if (d) {
      const angle = Math.atan2(coords.y - d.y, coords.x - d.x);
      d.rotation = rotateDecoStartRotation + (angle - rotateDecoStartAngle);
      renderDecorations();
    }
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
  if (isResizingPhoto && resizePhotoIndex >= 0 && layers[resizePhotoIndex]) {
    e.preventDefault();
    const dist = computeDistFromCenter(canvasCoords, resizePhotoIndex);
    if (photoResizeStartDist > 1) {
      layers[resizePhotoIndex].scale = Math.max(0.3, Math.min(3, photoResizeStartScale * (dist / photoResizeStartDist)));
      render();
    }
    return;
  }

  // --- Photo drag ---
  if (isDraggingPhoto && dragPhotoIndex >= 0 && layers[dragPhotoIndex]) {
    e.preventDefault();
    const l = layers[dragPhotoIndex];
    const sc_count = getSlotCount();
    const slots = getLayoutSlots(canvas.width, canvas.height, sc_count || 1);
    const slot = slots[dragPhotoIndex];
    if (slot) {
      const sc = l.scale || 1;
      const sw = slot.w * sc, sh = slot.h * sc;
      const baseSx = slot.x + (slot.w - sw) / 2;
      const baseSy = slot.y + (slot.h - sh) / 2;
      l.offsetX = (canvasCoords.px - dragPhotoOffset.x) - baseSx;
      l.offsetY = (canvasCoords.py - dragPhotoOffset.y) - baseSy;
      render();
      if (typeof positionFloatingShapePicker === 'function') positionFloatingShapePicker(dragPhotoIndex);
    }
    return;
  }

  // (Logo is now handled as a decoration — no separate logo drag/resize)

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

decoCanvas.addEventListener('pointerup', (e) => {
  if (isRotatingDeco && rotateDecoId) {
    const d = decorations.find(dec => dec.id === rotateDecoId);
    if (d && sessionCode) socket.emit('decoration-rotate', { code: sessionCode, id: d.id, rotation: d.rotation });
    isRotatingDeco = false;
    rotateDecoId = null;
  }
  if (isResizingDeco && resizeDeco) {
    if (sessionCode) socket.emit('decoration-scale', { code: sessionCode, id: resizeDeco.id, scale: resizeDeco.scale });
    isResizingDeco = false;
    resizeDeco = null;
  }
  if (isDragging && dragDeco) {
    if (sessionCode) socket.emit('decoration-move', { code: sessionCode, id: dragDeco.id, x: dragDeco.x, y: dragDeco.y });
  }
  // Photo drag: revert if pointer ended outside canvas, otherwise emit
  if (isDraggingPhoto && dragPhotoIndex >= 0 && layers[dragPhotoIndex]) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX, cy = e.clientY;
    if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) {
      // Revert offset — don't move the photo
      layers[dragPhotoIndex].offsetX = dragPhotoInitialOffset.x;
      layers[dragPhotoIndex].offsetY = dragPhotoInitialOffset.y;
      render();
    } else if (sessionCode) {
      const l = layers[dragPhotoIndex];
      socket.emit('photo-edit', { code: sessionCode, index: dragPhotoIndex, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, rotation: l.rotation, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
    }
  }
  // Emit photo scale after resize ends
  if (isResizingPhoto && resizePhotoIndex >= 0 && layers[resizePhotoIndex] && sessionCode) {
    const l = layers[resizePhotoIndex];
    socket.emit('photo-edit', { code: sessionCode, index: resizePhotoIndex, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, rotation: l.rotation, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
  }
  // Emit rotation after rotate ends
  if (isRotatingPhoto && rotatePhotoIndex >= 0 && layers[rotatePhotoIndex] && sessionCode) {
    const l = layers[rotatePhotoIndex];
    socket.emit('photo-edit', { code: sessionCode, index: rotatePhotoIndex, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, rotation: l.rotation, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
  }
  // Emit crop changes
  if ((isCropPanning || isCropZooming) && cropModeIndex >= 0 && layers[cropModeIndex] && sessionCode) {
    const l = layers[cropModeIndex];
    socket.emit('photo-edit', { code: sessionCode, index: cropModeIndex, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, rotation: l.rotation, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
  }
  isDragging = false;
  dragDeco = null;
  isResizingPhoto = false;
  resizePhotoIndex = -1;
  isDraggingPhoto = false;
  dragPhotoIndex = -1;
  isRotatingPhoto = false;
  rotatePhotoIndex = -1;
  isCropPanning = false;
  isCropZooming = false;
});

decoCanvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
decoCanvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// Fallback: if pointer released outside canvas, revert photo position and clean up
document.addEventListener('pointerup', (e) => {
  // Only act if canvas pointerup didn't already handle it (isDraggingPhoto still true means canvas handler didn't fire)
  if (isDraggingPhoto && dragPhotoIndex >= 0 && layers[dragPhotoIndex]) {
    layers[dragPhotoIndex].offsetX = dragPhotoInitialOffset.x;
    layers[dragPhotoIndex].offsetY = dragPhotoInitialOffset.y;
    isDraggingPhoto = false;
    dragPhotoIndex = -1;
    render();
  }
});

// ===== Canvas Drop Zone (drag from bank to frame) =====
const canvasPreview = document.getElementById('preview');
canvasPreview.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
canvasPreview.addEventListener('drop', (e) => {
  e.preventDefault();
  const bankIdx = e.dataTransfer.getData('application/bank-index');
  const slotIdx = e.dataTransfer.getData('application/slot-index');
  const canvasCoords = getCanvasCoords(e);

  if (bankIdx !== '') {
    // Dragged from bank → find target slot
    const bi = parseInt(bankIdx, 10);
    const max = getMaxSlots();
    if (max === Infinity) {
      // Freeform: check if dropped on an existing photo to replace it
      const targetPhoto = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
      if (targetPhoto >= 0 && layers[targetPhoto]) {
        // Replace: swap the image but keep all transforms
        const oldLayer = layers[targetPhoto];
        const newPhoto = photoBank.splice(bi, 1)[0];
        if (newPhoto) {
          // Copy transforms from old to new
          newPhoto.scale = oldLayer.scale || 1;
          newPhoto.shape = oldLayer.shape || frameShapeDefault;
          newPhoto.borderColor = oldLayer.borderColor || null;
          newPhoto.offsetX = oldLayer.offsetX || 0;
          newPhoto.offsetY = oldLayer.offsetY || 0;
          newPhoto.cropX = oldLayer.cropX || 0;
          newPhoto.cropY = oldLayer.cropY || 0;
          newPhoto.cropScale = oldLayer.cropScale || 1;
          newPhoto.rotation = oldLayer.rotation || 0;
          newPhoto.dropProgress = 1;
          newPhoto.dropStartTs = null;
          // Reset old photo transforms and return to bank
          oldLayer.scale = 1;
          oldLayer.offsetX = 0;
          oldLayer.offsetY = 0;
          oldLayer.cropX = 0;
          oldLayer.cropY = 0;
          oldLayer.cropScale = 1;
          oldLayer.rotation = 0;
          photoBank.push(oldLayer);
          layers[targetPhoto] = newPhoto;
          renderPhotoBank();
          render();
          updateSnapButton();
          if (sessionCode) socket.emit('slot-assign', { code: sessionCode, slotIndex: targetPhoto, photoId: newPhoto.id });
        }
      } else {
        // Freeform: append to end (dropped on empty space)
        const newIdx = getAssignedCount();
        const photo = photoBank.splice(bi, 1)[0];
        if (photo) {
          photo.dropProgress = 0;
          photo.dropStartTs = null;
          layers.push(photo);
          renderPhotoBank();
          render();
          updateSnapButton();
          if (sessionCode) socket.emit('slot-assign', { code: sessionCode, slotIndex: newIdx, photoId: photo.id });
        }
      }
    } else {
      // Fixed layout: find which slot was dropped on
      let targetSlot = hitTestEmptySlot(canvasCoords.px, canvasCoords.py);
      if (targetSlot < 0) {
        // Dropped on an occupied slot — swap
        targetSlot = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
      }
      if (targetSlot < 0) {
        // Find first empty slot
        for (let s = 0; s < max; s++) {
          if (!layers[s]) { targetSlot = s; break; }
        }
      }
      if (targetSlot >= 0) {
        assignToSlot(bi, targetSlot);
      }
    }
  } else if (slotIdx !== '') {
    // Dragged from a slot → unassign (dropped back on canvas but not on another slot)
    // Check if dropped on another slot to swap
    const si = parseInt(slotIdx, 10);
    const targetBody = hitTestPhotoBody(canvasCoords.px, canvasCoords.py);
    const targetEmpty = hitTestEmptySlot(canvasCoords.px, canvasCoords.py);
    if (targetBody >= 0 && targetBody !== si) {
      swapSlots(si, targetBody);
    } else if (targetEmpty >= 0) {
      swapSlots(si, targetEmpty);
    }
  }
});

// Also allow dropping bank photos on the bank area (reorder or drop from slot to unassign)
document.getElementById('thumbs').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
document.getElementById('thumbs').addEventListener('drop', (e) => {
  e.preventDefault();
  const slotIdx = e.dataTransfer.getData('application/slot-index');
  if (slotIdx !== '') {
    unassignFromSlot(parseInt(slotIdx, 10));
  }
});

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

function getSlotCount() {
  const max = getMaxSlots();
  return max === Infinity ? getAssignedCount() : max;
}

function getPhotoRect(i) {
  const sc_count = getSlotCount();
  const slots = getLayoutSlots(canvas.width, canvas.height, sc_count || 1);
  if (i < 0 || i >= slots.length) return null;
  const l = i < layers.length ? layers[i] : null;
  if (!l) return null;
  const slot = slots[i];
  const sc = l.scale || 1;
  const sw = slot.w * sc, sh = slot.h * sc;
  const sx = slot.x + (slot.w - sw) / 2 + (l.offsetX || 0);
  const sy = slot.y + (slot.h - sh) / 2 + (l.offsetY || 0);
  return { sx, sy, sw, sh, centerX: slot.x + slot.w / 2 + (l.offsetX || 0), centerY: slot.y + slot.h / 2 + (l.offsetY || 0) };
}

// Transform point into photo's local (unrotated) coordinate space
function toLocalPhotoCoords(px, py, r, rot) {
  const cx = r.sx + r.sw / 2, cy = r.sy + r.sh / 2;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = px - cx, dy = py - cy;
  return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
}

function hitTestPhotoHandle(px, py) {
  const sc_count = getSlotCount();
  for (let i = 0; i < sc_count; i++) {
    if (!layers[i]) continue;
    const r = getPhotoRect(i);
    if (!r) continue;
    const rot = layers[i].rotation || 0;
    const lp = toLocalPhotoCoords(px, py, r, rot);
    const corners = [
      [r.sx, r.sy], [r.sx + r.sw, r.sy], [r.sx, r.sy + r.sh], [r.sx + r.sw, r.sy + r.sh]
    ];
    for (const [cx, cy] of corners) {
      if (Math.abs(lp.x - cx) < PHOTO_HANDLE_PX && Math.abs(lp.y - cy) < PHOTO_HANDLE_PX) {
        return i;
      }
    }
  }
  return -1;
}

function hitTestRotateHandle(px, py) {
  if (selectedPhotoIndex < 0) return -1;
  const r = getPhotoRect(selectedPhotoIndex);
  if (!r) return -1;
  const rot = layers[selectedPhotoIndex].rotation || 0;
  const lp = toLocalPhotoCoords(px, py, r, rot);
  const rhx = r.sx + r.sw / 2;
  const rhy = r.sy + r.sh + 24 * devicePixelRatioVal;
  const dist = Math.sqrt((lp.x - rhx) ** 2 + (lp.y - rhy) ** 2);
  if (dist < 18 * devicePixelRatioVal) return selectedPhotoIndex;
  return -1;
}

function hitTestPhotoBody(px, py) {
  const sc_count = getSlotCount();
  const slots = getLayoutSlots(canvas.width, canvas.height, sc_count || 1);
  for (let i = Math.min(sc_count, slots.length) - 1; i >= 0; i--) {
    if (!layers[i]) continue;
    const r = getPhotoRect(i);
    if (!r) continue;
    const rot = layers[i].rotation || 0;
    const lp = toLocalPhotoCoords(px, py, r, rot);
    if (lp.x >= r.sx && lp.x <= r.sx + r.sw && lp.y >= r.sy && lp.y <= r.sy + r.sh) {
      return i;
    }
  }
  return -1;
}

// Hit test empty slot (for drop targeting)
function hitTestEmptySlot(px, py) {
  const max = getMaxSlots();
  if (max === Infinity) return -1; // freeform handled differently
  const slots = getLayoutSlots(canvas.width, canvas.height, max);
  for (let i = slots.length - 1; i >= 0; i--) {
    if (layers[i]) continue; // only test empty slots
    const s = slots[i];
    if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) {
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


function resetDecoToolToSelect() {
  currentDecoTool = 'none';
  document.querySelectorAll('.deco-tool').forEach(b => b.classList.remove('active'));
  const stickerArea = document.getElementById('stickerPickerArea');
  if (stickerArea) stickerArea.style.display = 'none';
  const decoCanvasEl = document.getElementById('decoCanvas');
  if (decoCanvasEl) decoCanvasEl.style.cursor = 'default';
}

function deleteSelectedDeco() {
  if (!selectedDecoId) return;
  decorations = decorations.filter(d => d.id !== selectedDecoId);
  if (sessionCode) socket.emit('decoration-remove', { code: sessionCode, id: selectedDecoId });
  selectedDecoId = null;
  renderDecorations();
}

// ===== Logo Helpers =====
function getLogoVariant() {
  let r, g, b;
  if (frameBgType === 'image' && frameBgImage) {
    // Sample a small grid for a better average of the image
    const sz = 8;
    const tmp = document.createElement('canvas');
    tmp.width = sz; tmp.height = sz;
    const tc = tmp.getContext('2d');
    tc.drawImage(frameBgImage, 0, 0, sz, sz);
    const px = tc.getImageData(0, 0, sz, sz).data;
    let tr = 0, tg = 0, tb = 0;
    const count = sz * sz;
    for (let i = 0; i < px.length; i += 4) {
      tr += px[i]; tg += px[i + 1]; tb += px[i + 2];
    }
    r = tr / count; g = tg / count; b = tb / count;
  } else {
    const hex = frameBgColor.replace('#', '');
    r = parseInt(hex.substr(0, 2), 16) || 0;
    g = parseInt(hex.substr(2, 2), 16) || 0;
    b = parseInt(hex.substr(4, 2), 16) || 0;
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? logoDark : logoLight;
}

// Logo rect and hit test functions removed — logo is now a decoration

// ===== Export PNG =====
function exportCanvasPNG() {
  (async () => {
    isExporting = true;
    await render(performance.now());
    isExporting = false;

    // Composite decorations on top
    ctx.drawImage(decoCanvas, 0, 0);

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

// ===== Pose Prompts =====
const PROMPT_FEEDBACKS = [
  "Okaaay that's giving main character energy!",
  "Slay! Absolutely no notes!",
  "Sheesh that one hit different!",
  "Nailed it! That's a whole vibe!",
  "Period! Frame-worthy for real!",
  "Ugh obsessed with this one!",
  "Not gonna lie that ate!",
  "It's giving photogenic! We love to see it!",
  "Hold up — that was lowkey iconic!",
  "Certified banger right there!",
];

function showPrompt(text) {
  const display = document.getElementById('promptDisplay');
  const actionRow = document.getElementById('promptActionRow');
  const feedback = document.getElementById('promptFeedback');
  const countdownEl = document.getElementById('promptCountdown');
  const generateBtn = document.getElementById('btnRandomPrompt');

  // Clear any running countdown
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  countdownEl.style.display = 'none';
  feedback.style.display = 'none';

  // Hide generate button to save space, show prompt text
  generateBtn.style.display = 'none';
  display.textContent = text;
  display.classList.remove('animate');
  void display.offsetHeight;
  display.classList.add('animate');

  // Show the action row (Ready + Redo)
  actionRow.style.display = 'flex';
}

function startPromptCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  const el = document.getElementById('promptCountdown');
  const actionRow = document.getElementById('promptActionRow');
  actionRow.style.display = 'none';
  el.style.display = 'block';
  let count = 3;
  el.textContent = count;
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      el.textContent = count;
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
      el.style.display = 'none';
      doSnap().then(() => showPromptFeedback()).catch(e => console.error('auto-snap failed', e));
    }
  }, 1000);
}

function showPromptFeedback() {
  const feedback = document.getElementById('promptFeedback');
  const display = document.getElementById('promptDisplay');
  const generateBtn = document.getElementById('btnRandomPrompt');
  const n = Math.max(1, participants.length);
  const template = PROMPT_FEEDBACKS[Math.floor(Math.random() * PROMPT_FEEDBACKS.length)];
  const msg = template;
  display.textContent = '';
  feedback.textContent = msg;
  feedback.style.display = 'block';
  feedback.classList.remove('animate');
  void feedback.offsetHeight;
  feedback.classList.add('animate');
  // Auto-hide after 4 seconds, then show generate button again
  setTimeout(() => {
    feedback.style.display = 'none';
    generateBtn.style.display = '';
  }, 4000);
}

// Store password for auto-rejoin on reconnect
let sessionPassword = null;
let hasJoinedSession = false; // true after first successful user-joined

// ===== Socket Events =====

// Helper: emit join only when socket is connected
function emitJoin() {
  if (!sessionCode) return;
  const payload = { code: sessionCode, name: getMyName() || 'Guest', password: sessionPassword || '' };
  if (socket.connected) {
    socket.emit('join', payload);
  } else {
    socket.once('connect', () => socket.emit('join', payload));
  }
}

socket.on('connect', () => {
  console.log('connected', socket.id);
  // Auto-rejoin session after reconnect (only if we previously joined successfully)
  if (sessionCode && hasJoinedSession) {
    console.log('Rejoining session', sessionCode);
    emitJoin();
  }
});

socket.on('user-joined', ({ participant, participants: ps }) => {
  participants = ps || [];
  hasJoinedSession = true;
  syncSessionDisplay(undefined, participants.length);
  render();
});

socket.on('user-left', ({ participantId, participants: ps }) => {
  participants = ps || [];
  syncSessionDisplay(undefined, participants.length);
  render();
});

socket.on('snapped', ({ layer: sl }) => confirmLayerFromServer(sl));

socket.on('finish', ({ layers: finalLayers }) => {
  if (Array.isArray(finalLayers) && finalLayers.length > 0) {
    layers = finalLayers.map(l => ({
      id: l.id, imageUrl: l.imageUrl, owner: l.owner || 'Anon',
      ts: l.timestamp || now(), state: 'confirmed', dropProgress: 1
    }));
    renderPhotoBank(); render();
  }
  exportCanvasPNG();
});

socket.on('layers-sync', ({ layers: sl }) => {
  for (const l of sl) confirmLayerFromServer(l);
  ensureLayerSlots();
});

socket.on('prompt', ({ text }) => showPrompt(text));

socket.on('decoration-add', ({ decoration }) => {
  if (decoration.type === 'image-sticker' && decoration.content && !stickerImageCache[decoration.content]) {
    const img = new Image();
    img.src = decoration.content;
    stickerImageCache[decoration.content] = img;
    img.onload = () => renderDecorations();
  }
  decorations.push(decoration);
  renderDecorations();
});
socket.on('decoration-move', ({ id, x, y }) => {
  const d = decorations.find(dec => dec.id === id);
  if (d) { d.x = x; d.y = y; renderDecorations(); }
});
socket.on('decoration-scale', ({ id, scale }) => {
  const d = decorations.find(dec => dec.id === id);
  if (d) { d.scale = scale; renderDecorations(); }
});
socket.on('decoration-rotate', ({ id, rotation }) => {
  const d = decorations.find(dec => dec.id === id);
  if (d) { d.rotation = rotation; renderDecorations(); }
});
socket.on('decoration-remove', ({ id }) => {
  decorations = decorations.filter(d => d.id !== id);
  if (selectedDecoId === id) selectedDecoId = null;
  renderDecorations();
});
socket.on('decorations-sync', ({ decorations: sd }) => {
  decorations = sd || [];
  // Preload any image stickers
  decorations.forEach(d => {
    if (d.type === 'image-sticker' && d.content && !stickerImageCache[d.content]) {
      const img = new Image();
      img.src = d.content;
      stickerImageCache[d.content] = img;
      img.onload = () => renderDecorations();
    }
  });
  renderDecorations();
});

socket.on('layout-change', ({ layout }) => {
  currentLayout = layout;
  ensureLayerSlots();
  updateLayoutUI();
  resizeCanvasImmediate();
  updateSnapButton();
  renderPhotoBank();
});
socket.on('layout-sync', ({ layout }) => {
  currentLayout = layout;
  ensureLayerSlots();
  updateLayoutUI();
  resizeCanvasImmediate();
  updateSnapButton();
  renderPhotoBank();
});

// Photo edit sync from other users
socket.on('photo-edit', ({ index, offsetX, offsetY, scale, shape, borderColor, cropX, cropY, cropScale, rotation }) => {
  if (index < 0 || index >= layers.length || !layers[index]) return;
  const l = layers[index];
  if (offsetX !== undefined) l.offsetX = offsetX;
  if (offsetY !== undefined) l.offsetY = offsetY;
  if (scale !== undefined) l.scale = scale;
  if (shape !== undefined) l.shape = shape;
  if (borderColor !== undefined) l.borderColor = borderColor;
  if (cropX !== undefined) l.cropX = cropX;
  if (cropY !== undefined) l.cropY = cropY;
  if (cropScale !== undefined) l.cropScale = cropScale;
  if (rotation !== undefined) l.rotation = rotation;
  render();
});

// Photo swap sync from other users
socket.on('photo-swap', ({ fromIndex, toIndex }) => {
  const temp = layers[fromIndex] || null;
  layers[fromIndex] = layers[toIndex] || null;
  layers[toIndex] = temp;
  if (selectedPhotoIndex === fromIndex) selectedPhotoIndex = toIndex;
  else if (selectedPhotoIndex === toIndex) selectedPhotoIndex = fromIndex;
  if (cropModeIndex === fromIndex) cropModeIndex = toIndex;
  else if (cropModeIndex === toIndex) cropModeIndex = fromIndex;
  renderPhotoBank();
  render();
});

// Slot assign/unassign sync from other users
socket.on('slot-assign', ({ slotIndex, photoId }) => {
  if (!photoId) return;
  // Find photo by ID in our local bank
  const bankIdx = photoBank.findIndex(p => p.id === photoId);
  if (bankIdx < 0) return; // photo not found locally — ignore
  const photoObj = photoBank.splice(bankIdx, 1)[0];
  if (layers[slotIndex]) photoBank.push(layers[slotIndex]);
  photoObj.dropProgress = 0;
  photoObj.dropStartTs = null;
  layers[slotIndex] = photoObj;
  renderPhotoBank();
  render();
  updateSnapButton();
});
socket.on('slot-unassign', ({ slotIndex }) => {
  if (layers[slotIndex]) {
    photoBank.push(layers[slotIndex]);
    layers[slotIndex] = null;
  }
  renderPhotoBank();
  render();
  updateSnapButton();
});

// ===== UI Wiring =====

// Screen transitions
function showSession() {
  document.getElementById('screenLanding').style.display = 'none';
  document.getElementById('screenWizard').style.display = 'none';
  document.getElementById('screenSession').style.display = 'flex';
  // Add logo as decoration if not already present
  if (!decorations.find(d => d.type === 'logo')) {
    decorations.push({
      id: 'logo-brand', type: 'logo', content: 'logo',
      x: 0.5, y: 0.028, scale: 0.95, owner: '__system__', rotation: 0
    });
  }
  setTimeout(() => { resizeCanvasImmediate(); initSlots(); }, 100);
}

// Create session — show wizard first
document.getElementById('btnCreate').onclick = () => {
  if (!getMyName() || getMyName() === 'You') {
    alert('Please enter your name');
    return;
  }
  // Clear join inputs so they don't interfere
  document.getElementById('joinCode').value = '';
  document.getElementById('joinPassword').value = '';
  wizardStep = 1;
  wizardAspectRatio = '4cut';
  wizardLayout = 'strip';
  wizardPassword = '';
  showWizard();
};

// Join session — with password
document.getElementById('btnJoin').onclick = async () => {
  const code = document.getElementById('joinCode').value.trim();
  if (!code || code.length !== 4) { alert('Enter a 4-digit code'); return; }
  const password = document.getElementById('joinPassword').value.trim();
  sessionCode = code;
  sessionPassword = password;
  isHost = false;
  history.pushState(null, '', '/' + sessionCode);
  syncSessionDisplay(sessionCode, '0');
  showSession();
  // Join the socket room immediately — don't wait for camera
  hasJoinedSession = false;
  emitJoin();
  startCamera();
};

// ===== Wizard =====
function showWizard() {
  document.getElementById('screenLanding').style.display = 'none';
  document.getElementById('screenWizard').style.display = 'flex';
  document.getElementById('screenSession').style.display = 'none';
  updateWizardUI();
}

function updateWizardUI() {
  document.getElementById('wizardStep1').style.display = wizardStep === 1 ? 'block' : 'none';
  document.getElementById('wizardStep2').style.display = wizardStep === 2 ? 'block' : 'none';
  document.getElementById('wizardStep3').style.display = wizardStep === 3 ? 'block' : 'none';

  document.querySelectorAll('.wizard-step-dot').forEach(dot => {
    const step = parseInt(dot.dataset.step);
    dot.classList.toggle('active', step <= wizardStep);
    dot.classList.toggle('current', step === wizardStep);
  });

  document.getElementById('wizardBack').style.display = wizardStep === 1 ? 'none' : 'inline-flex';
  document.getElementById('wizardNext').textContent = wizardStep === 3 ? 'Create Room' : 'Next';
}

// Wizard option selection: aspect ratio
document.querySelectorAll('[data-wratio]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-wratio]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wizardAspectRatio = btn.dataset.wratio;
  });
});

// Wizard option selection: layout
document.querySelectorAll('[data-wlayout]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-wlayout]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wizardLayout = btn.dataset.wlayout;
  });
});

// Wizard Next button
document.getElementById('wizardNext').onclick = async () => {
  if (wizardStep < 3) {
    wizardStep++;
    updateWizardUI();
    return;
  }

  // Step 3 finalize: get password and create session
  wizardPassword = document.getElementById('wizardPassword').value.trim();
  if (!wizardPassword) { alert('Please set a password'); return; }

  let j;
  try {
    const res = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: wizardPassword,
        aspectRatio: wizardAspectRatio,
        layout: wizardLayout
      })
    });
    if (!res.ok) throw new Error('Server error');
    j = await res.json();
    if (!j.code) throw new Error('No code returned');
  } catch (e) {
    alert('Failed to create session. Please try again.');
    return;
  }
  sessionCode = j.code;
  isHost = true;

  // Apply wizard settings locally
  currentLayout = wizardLayout;
  canvasRatioOverride = RATIO_MAP[wizardAspectRatio] !== undefined ? RATIO_MAP[wizardAspectRatio] : null;

  sessionPassword = wizardPassword;
  history.pushState(null, '', '/' + sessionCode);
  syncSessionDisplay(sessionCode, '0');
  showSession();
  // Join the socket room immediately — don't wait for camera
  hasJoinedSession = false;
  emitJoin();
  startCamera();

  // Update layout & ratio UI in session screen
  updateLayoutUI();
  document.querySelectorAll('.ratio-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.ratio === wizardAspectRatio);
  });
};

// Wizard Back button
document.getElementById('wizardBack').onclick = () => {
  if (wizardStep > 1) {
    wizardStep--;
    updateWizardUI();
  }
};

// Wizard Home button — back to landing
document.getElementById('wizardHome').onclick = () => {
  document.getElementById('screenWizard').style.display = 'none';
  document.getElementById('screenLanding').style.display = 'flex';
};

// Handle join error (wrong password, invalid code)
socket.on('join-error', ({ message }) => {
  // If we already joined successfully before, this is a reconnect failure — don't kick out
  if (hasJoinedSession) {
    console.warn('join-error during reconnect:', message);
    return;
  }
  // First join attempt failed — show error and go back to landing
  alert(message || 'Could not join session');
  document.getElementById('screenSession').style.display = 'none';
  document.getElementById('screenWizard').style.display = 'none';
  document.getElementById('screenLanding').style.display = 'flex';
  history.pushState(null, '', '/');
  sessionCode = null;
  sessionPassword = null;
  hasJoinedSession = false;
});

// Sync session display
function syncSessionDisplay(code, count) {
  const codeEl = document.getElementById('sessionCodeDisplay');
  const countEl = document.getElementById('participantCount');
  if (codeEl && code !== undefined) codeEl.textContent = code;
  if (countEl && count !== undefined) countEl.textContent = count;
}

// Copy shareable link (share button)
document.getElementById('btnCopyLink').onclick = function() {
  const btn = this;
  if (sessionCode) {
    const link = window.location.origin + '/' + sessionCode;
    navigator.clipboard.writeText(link).then(() => {
      const origHTML = btn.innerHTML;
      btn.textContent = '\u2705';
      setTimeout(() => btn.innerHTML = origHTML, 1500);
    });
  }
};

// ===== Capture Timer =====
let captureTimerSeconds = 0;

const btnTimerTrigger = document.getElementById('btnTimerTrigger');
const timerPanel = document.getElementById('timerPanel');
const timerDropdown = document.getElementById('timerDropdown');
const timerValueLabel = document.getElementById('timerValue');

btnTimerTrigger.addEventListener('click', () => {
  const isOpen = timerPanel.style.display !== 'none';
  timerPanel.style.display = isOpen ? 'none' : 'flex';
});
document.addEventListener('click', (e) => {
  if (!timerDropdown.contains(e.target) && timerPanel.style.display !== 'none') {
    timerPanel.style.display = 'none';
  }
});
document.querySelectorAll('.timer-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    captureTimerSeconds = parseInt(btn.dataset.timer, 10);
    document.querySelectorAll('.timer-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    timerValueLabel.textContent = captureTimerSeconds === 0 ? 'Off' : captureTimerSeconds + 's';
    timerPanel.style.display = 'none';
  });
});

function startCaptureWithTimer() {
  if (captureTimerSeconds === 0) {
    doSnap().catch(e => { console.error('snap failed', e); alert('Snap failed: ' + (e.message || e)); });
    return;
  }
  // Show countdown overlay
  const overlay = document.createElement('div');
  overlay.className = 'snap-countdown-overlay';
  const num = document.createElement('div');
  num.className = 'snap-countdown-number';
  overlay.appendChild(num);
  document.body.appendChild(overlay);

  let remaining = captureTimerSeconds;
  num.textContent = remaining;
  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      overlay.remove();
      doSnap().catch(e => { console.error('snap failed', e); alert('Snap failed: ' + (e.message || e)); });
    } else {
      num.textContent = remaining;
    }
  }, 1000);
}

// Snap
document.getElementById('snap').onclick = async () => {
  startCaptureWithTimer();
};

// Initialize slot structure on session start
function initSlots() {
  ensureLayerSlots();
  renderPhotoBank();
  updateSnapButton();
}

// Export / Finish — modal flow
const exportModal = document.getElementById('exportModal');
const exportModalClose = document.getElementById('exportModalClose');

document.getElementById('finish').onclick = () => {
  exportModal.style.display = 'flex';
};

exportModalClose.onclick = () => {
  exportModal.style.display = 'none';
};

exportModal.addEventListener('click', (e) => {
  if (e.target === exportModal) exportModal.style.display = 'none';
});

document.getElementById('exportModalPng').onclick = () => {
  exportModal.style.display = 'none';
  if (sessionCode) socket.emit('finish', { code: sessionCode });
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

document.getElementById('btnStartPrompt').addEventListener('click', () => {
  startPromptCountdown();
});

document.getElementById('btnRedoPrompt').addEventListener('click', () => {
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
    ensureLayerSlots();
    updateLayoutUI();
    resizeCanvasImmediate();
    updateSnapButton();
    renderPhotoBank();
    if (sessionCode) socket.emit('layout-change', { code: sessionCode, layout: currentLayout });
  });
});

// Aspect ratio picker
document.querySelectorAll('.ratio-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ratio-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.ratio;
    canvasRatioOverride = RATIO_MAP[key] !== undefined ? RATIO_MAP[key] : null;
    resizeCanvasImmediate();
  });
});

// Dropdown picker toggles (layout, aspect ratio, background)
const btnLayoutTrigger = document.getElementById('btnLayoutTrigger');
const layoutPanel = document.getElementById('layoutPanel');
const layoutDropdown = document.getElementById('layoutDropdown');
const btnRatioTrigger = document.getElementById('btnRatioTrigger');
const ratioPanel = document.getElementById('ratioPanel');
const ratioDropdown = document.getElementById('ratioDropdown');
const btnBgTrigger = document.getElementById('btnBgTrigger');
const bgPanel = document.getElementById('bgPanel');
const bgDropdown = document.getElementById('bgDropdown');

function closeAllPickers() {
  layoutPanel.style.display = 'none';
  btnLayoutTrigger.classList.remove('active');
  ratioPanel.style.display = 'none';
  btnRatioTrigger.classList.remove('active');
  bgPanel.style.display = 'none';
  btnBgTrigger.classList.remove('active');
}

btnLayoutTrigger.addEventListener('click', () => {
  const isOpen = layoutPanel.style.display !== 'none';
  closeAllPickers();
  if (!isOpen) {
    layoutPanel.style.display = 'flex';
    btnLayoutTrigger.classList.add('active');
  }
});
btnRatioTrigger.addEventListener('click', () => {
  const isOpen = ratioPanel.style.display !== 'none';
  closeAllPickers();
  if (!isOpen) {
    ratioPanel.style.display = 'flex';
    btnRatioTrigger.classList.add('active');
  }
});
btnBgTrigger.addEventListener('click', () => {
  const isOpen = bgPanel.style.display !== 'none';
  closeAllPickers();
  if (!isOpen) {
    bgPanel.style.display = 'flex';
    btnBgTrigger.classList.add('active');
  }
});
document.addEventListener('click', (e) => {
  if (!layoutDropdown.contains(e.target) && layoutPanel.style.display !== 'none') {
    layoutPanel.style.display = 'none';
    btnLayoutTrigger.classList.remove('active');
  }
  if (!ratioDropdown.contains(e.target) && ratioPanel.style.display !== 'none') {
    ratioPanel.style.display = 'none';
    btnRatioTrigger.classList.remove('active');
  }
  if (!bgDropdown.contains(e.target) && bgPanel.style.display !== 'none') {
    bgPanel.style.display = 'none';
    btnBgTrigger.classList.remove('active');
  }
});

// Decoration dial toggle
const decoDialToggle = document.getElementById('decoDialToggle');
const decoDial = document.getElementById('decoDial');
const decoDialSection = document.getElementById('decoDialSection');

decoDialToggle.addEventListener('click', () => {
  const isOpen = decoDial.style.display !== 'none';
  decoDial.style.display = isOpen ? 'none' : 'flex';
  decoDialToggle.classList.toggle('active', !isOpen);
});

// Close deco panel on outside click
document.addEventListener('click', (e) => {
  if (!decoDialSection.contains(e.target) && decoDial.style.display !== 'none') {
    decoDial.style.display = 'none';
    decoDialToggle.classList.remove('active');
  }
});

// Decoration tools (inside dial)
document.querySelectorAll('.deco-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    document.querySelectorAll('.deco-tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDecoTool = tool;
    const stickerArea = document.getElementById('stickerPickerArea');
    stickerArea.style.display = tool === 'sticker' ? 'block' : 'none';

    // Change cursor
    decoCanvas.style.cursor = (tool === 'sticker' || tool === 'text') ? 'crosshair' : 'default';
  });
});

// Sticker tabs (Emoji / HackHer / Vietnam)
const stickerTabIds = {
  emoji: 'stickerTabEmoji',
  hackher: 'stickerTabHackher',
  vietnam: 'stickerTabVietnam',
};
document.querySelectorAll('.sticker-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sticker-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.stickerTab;
    // Hide all tab contents, show the selected one
    for (const [key, id] of Object.entries(stickerTabIds)) {
      const el = document.getElementById(id);
      if (el) el.style.display = key === which ? 'block' : 'none';
    }
    currentStickerType = which === 'emoji' ? 'emoji' : 'image';
  });
});

// Emoji picker
document.querySelectorAll('.emoji-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('active'));
    document.querySelectorAll('.img-sticker-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    currentStickerEmoji = opt.textContent;
    currentStickerType = 'emoji';
  });
});

// Image sticker picker
document.querySelectorAll('.img-sticker-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.img-sticker-opt').forEach(o => o.classList.remove('active'));
    document.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    currentStickerType = 'image';
    currentStickerImageSrc = opt.dataset.stickerSrc;
    // Preload into cache
    if (!stickerImageCache[currentStickerImageSrc]) {
      const img = new Image();
      img.src = currentStickerImageSrc;
      stickerImageCache[currentStickerImageSrc] = img;
    }
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
  const allPhotos = [...photoBank, ...layers.filter(p => p !== null)];
  for (const l of allPhotos) {
    if (!l || !l.imageUrl) continue;
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

// Floating shape picker element
const floatingShapePicker = document.getElementById('floatingShapePicker');

// Update shape UI to reflect the selected photo's shape (or default)
function updateShapeUIForPhoto(idx) {
  const l = (idx >= 0 && layers[idx]) ? layers[idx] : null;
  const shape = l ? (l.shape || frameShapeDefault) : frameShapeDefault;
  document.querySelectorAll('.fshape-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.shape === shape);
  });
  const color = (l && l.borderColor) ? l.borderColor : frameBorderColor;
  const picker = document.getElementById('frameBorderColorPicker');
  if (picker) picker.value = color;

  // Show/hide and position floating shape picker
  positionFloatingShapePicker(idx);
}

function positionFloatingShapePicker(idx) {
  if (idx < 0 || !layers[idx] || isExporting) {
    floatingShapePicker.style.display = 'none';
    return;
  }
  const r = getPhotoRect(idx);
  if (!r) { floatingShapePicker.style.display = 'none'; return; }

  // Convert canvas coords to CSS coords (canvas is scaled by devicePixelRatio)
  const canvasEl = document.getElementById('canvas');
  const cssW = parseFloat(canvasEl.style.width) || canvasEl.offsetWidth;
  const cssH = parseFloat(canvasEl.style.height) || canvasEl.offsetHeight;
  const scaleX = cssW / canvasEl.width;
  const scaleY = cssH / canvasEl.height;

  // Compute top-center of photo accounting for rotation
  const rot = layers[idx].rotation || 0;
  const cx = r.sx + r.sw / 2, cy = r.sy + r.sh / 2;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  // Top-center in local coords is (0, -sh/2), rotate to world
  const worldTopX = cx + 0 * cosR - (-r.sh / 2) * sinR;
  const worldTopY = cy + 0 * sinR + (-r.sh / 2) * cosR;

  const topY = worldTopY * scaleY;
  const centerX = worldTopX * scaleX;
  const pickerW = floatingShapePicker.offsetWidth || 200;
  const pickerH = floatingShapePicker.offsetHeight || 36;

  floatingShapePicker.style.display = 'flex';
  floatingShapePicker.style.left = Math.max(0, Math.min(cssW - pickerW, centerX - pickerW / 2)) + 'px';
  floatingShapePicker.style.top = Math.max(0, topY - pickerH - 4) + 'px';
}

// Frame shape controls
document.querySelectorAll('.fshape-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fshape-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const shape = btn.dataset.shape;
    if (selectedPhotoIndex >= 0 && layers[selectedPhotoIndex]) {
      layers[selectedPhotoIndex].shape = shape;
      if (sessionCode) {
        const l = layers[selectedPhotoIndex];
        socket.emit('photo-edit', { code: sessionCode, index: selectedPhotoIndex, shape: l.shape, borderColor: l.borderColor, rotation: l.rotation, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
      }
    } else {
      frameShapeDefault = shape;
    }
    render();
  });
});

// Remove photo from canvas (back to bank)
document.getElementById('btnRemoveFromCanvas').addEventListener('click', () => {
  if (selectedPhotoIndex >= 0 && layers[selectedPhotoIndex]) {
    unassignFromSlot(selectedPhotoIndex);
  }
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
  if (selectedPhotoIndex >= 0 && layers[selectedPhotoIndex]) {
    layers[selectedPhotoIndex].borderColor = e.target.value;
    if (sessionCode) {
      const l = layers[selectedPhotoIndex];
      socket.emit('photo-edit', { code: sessionCode, index: selectedPhotoIndex, shape: l.shape, borderColor: l.borderColor, rotation: l.rotation, offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, cropX: l.cropX, cropY: l.cropY, cropScale: l.cropScale });
    }
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
      updateBgScaleVisibility();
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
  updateBgScaleVisibility();
  render();
  if (sessionCode) socket.emit('frame-bg-change', { code: sessionCode, bgType: 'color', bgColor: frameBgColor });
});

// Show/hide background scale slider based on bg type
function updateBgScaleVisibility() {
  const group = document.getElementById('bgScaleGroup');
  if (group) group.style.display = (frameBgType === 'image' && frameBgImage) ? '' : 'none';
}

// Background scale slider
document.getElementById('frameBgScaleSlider').addEventListener('input', e => {
  frameBgScale = parseInt(e.target.value, 10) / 100;
  render();
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
      updateBgScaleVisibility();
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
    updateBgScaleVisibility();
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
    updateBgScaleVisibility();
    render();
  }
});

// Aspect ratio sync (from host or late join)
socket.on('aspect-ratio-sync', ({ aspectRatio }) => {
  if (aspectRatio && RATIO_MAP[aspectRatio] !== undefined) {
    canvasRatioOverride = RATIO_MAP[aspectRatio];
    document.querySelectorAll('.ratio-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.ratio === aspectRatio);
    });
    resizeCanvasImmediate();
  }
});
socket.on('aspect-ratio-change', ({ aspectRatio }) => {
  if (aspectRatio && RATIO_MAP[aspectRatio] !== undefined) {
    canvasRatioOverride = RATIO_MAP[aspectRatio];
    document.querySelectorAll('.ratio-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.ratio === aspectRatio);
    });
    resizeCanvasImmediate();
  }
});

// Settings panel toggle (inline popup)
const customSection = document.getElementById('customSection');
const settingsPanel = document.getElementById('settingsPanel');
const btnSettings = document.getElementById('btnSettings');
btnSettings.addEventListener('click', () => {
  const isOpen = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isOpen ? 'none' : 'block';
  btnSettings.classList.toggle('active', !isOpen);
});
document.addEventListener('click', (e) => {
  if (!customSection.contains(e.target) && settingsPanel.style.display !== 'none') {
    settingsPanel.style.display = 'none';
    btnSettings.classList.remove('active');
  }
});

// Add Date / Add Names buttons — create as decoration text blocks
document.getElementById('btnAddDate').onclick = () => {
  const deco = {
    id: generateId(), type: 'text', content: new Date().toLocaleDateString(),
    x: 0.85, y: 0.95, scale: 0.8, owner: '__system__',
    color: 'rgba(139,107,74,0.6)', fontSize: 12, fontFamily: 'Inter', fontWeight: 400,
    rotation: 0, showBg: false, bgColor: '#ffffff'
  };
  decorations.push(deco);
  selectedDecoId = deco.id;
  renderDecorations();
  if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
};
document.getElementById('btnAddNames').onclick = () => {
  const names = participants.map(p => p.name).filter(Boolean);
  const unique = [...new Set(names)];
  const text = 'by ' + (unique.length > 0 ? unique.join(', ') : 'everyone');
  const deco = {
    id: generateId(), type: 'text', content: text,
    x: 0.85, y: 0.92, scale: 0.8, owner: '__system__',
    color: 'rgba(139,107,74,0.6)', fontSize: 11, fontFamily: 'Inter', fontWeight: 400,
    rotation: 0, showBg: false, bgColor: '#ffffff'
  };
  decorations.push(deco);
  selectedDecoId = deco.id;
  renderDecorations();
  if (sessionCode) socket.emit('decoration-add', { code: sessionCode, decoration: deco });
};

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

// Click outside canvas to deselect photos and exit crop mode
document.addEventListener('pointerdown', (e) => {
  // Check if click is inside the canvas area (preview div or its children)
  const preview = document.getElementById('preview');
  if (preview && preview.contains(e.target)) return; // inside canvas area, handled by decoCanvas

  // Click is outside the canvas — deselect photo and exit crop
  let changed = false;
  if (cropModeIndex >= 0) { cropModeIndex = -1; changed = true; }
  if (selectedPhotoIndex >= 0) { selectedPhotoIndex = -1; updateShapeUIForPhoto(-1); changed = true; }
  if (selectedDecoId) { selectedDecoId = null; renderDecorations(); changed = true; }
  if (changed) render();
});

// ===== URL-based auto-join =====
if (urlRoomCode) {
  fetch('/api/session/' + urlRoomCode)
    .then(r => {
      if (!r.ok) throw new Error('not found');
      return r.json();
    })
    .then(info => {
      document.getElementById('joinCode').value = urlRoomCode;
      if (info.hasPassword) {
        document.getElementById('joinPassword').placeholder = 'Password required';
        document.getElementById('joinPassword').focus();
      }
    })
    .catch(() => {
      document.getElementById('joinCode').value = urlRoomCode;
    });
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const code = getRoomCodeFromURL();
  if (!code && sessionCode) {
    document.getElementById('screenSession').style.display = 'none';
    document.getElementById('screenWizard').style.display = 'none';
    document.getElementById('screenLanding').style.display = 'flex';
    sessionCode = null;
    sessionPassword = null;
    hasJoinedSession = false;
  }
});
