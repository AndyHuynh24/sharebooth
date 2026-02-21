// public/client.js - rewritten safe client for CuteCollage
// Requirements: /socket.io/socket.io.js loaded in index.html

const socket = io();
let sessionCode = null;
let participants = [];
let layers = []; // { id?, tempId?, imageUrl, owner, ts, state: 'pending'|'confirmed', dropProgress }
const imageCache = new Map();

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const thumbs = document.getElementById('thumbs');
const sessionInfo = document.getElementById('sessionInfo');
const controls = document.getElementById('controls');
const shareArea = document.getElementById('shareArea');

let localStream = null;
let devicePixelRatioVal = Math.max(1, window.devicePixelRatio || 1);

// ---------- Utility functions ----------
function now() { return Date.now(); }

function resizeCanvasImmediate() {
  const preview = document.getElementById('preview');
  const w = preview.clientWidth;
  const h = preview.clientHeight;
  devicePixelRatioVal = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * devicePixelRatioVal);
  canvas.height = Math.round(h * devicePixelRatioVal);
  render(); // update visuals immediately
}
window.addEventListener('resize', () => resizeCanvasImmediate());

// load an image with caching
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    if (imageCache.has(src)) return resolve(imageCache.get(src));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageCache.set(src, img); resolve(img); };
    img.onerror = () => {
      // placeholder canvas
      const c = document.createElement('canvas');
      c.width = 200; c.height = 150;
      const cctx = c.getContext('2d');
      cctx.fillStyle = '#ddd'; cctx.fillRect(0,0,200,150);
      imageCache.set(src, c);
      resolve(c);
    };
    img.src = src;
  });
}

function mkTempId() { return 'tmp-' + Math.floor(Math.random()*1e9) + '-' + Date.now(); }

// find layer by imageUrl (prefer confirmed)
function findLayerByImageUrl(url) {
  return layers.find(l => l.imageUrl === url);
}

// find layer by tempId
function findLayerByTempId(tempId) {
  return layers.find(l => l.tempId && l.tempId === tempId);
}

// add layer locally (if duplicate imageUrl exists, skip)
function addLocalLayer(obj) {
  // obj: { imageUrl, owner, tempId(optional), state:'pending'|'confirmed' }
  if (!obj || !obj.imageUrl) return null;
  const existing = findLayerByImageUrl(obj.imageUrl);
  if (existing) {
    // if existing was pending and obj is confirmed, upgrade
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
    dropProgress: 0, // 0..1 for drop animation
  };
  layers.push(layer);
  renderThumbs();
  render();
  return layer;
}

// replace or confirm layer when server sends authoritative layer
function confirmLayerFromServer(serverLayer) {
  // serverLayer: { id, owner, imageUrl, timestamp }
  if (!serverLayer || !serverLayer.imageUrl) return;
  const existing = findLayerByImageUrl(serverLayer.imageUrl);
  if (existing) {
    existing.id = serverLayer.id || existing.id;
    existing.owner = serverLayer.owner || existing.owner;
    existing.ts = serverLayer.timestamp || existing.ts;
    existing.state = 'confirmed';
    // ensure dropProgress if needed
    if (existing.dropProgress === 0) existing.dropProgress = 1;
  } else {
    // add fresh confirmed
    addLocalLayer({ id: serverLayer.id, imageUrl: serverLayer.imageUrl, owner: serverLayer.owner, ts: serverLayer.timestamp, state: 'confirmed' });
  }
  renderThumbs();
  render();
}

// simple UI thumbs refresh
function renderThumbs() {
  thumbs.innerHTML = '';
  for (const l of layers) {
    const img = document.createElement('img');
    img.src = l.imageUrl;
    img.className = 'small';
    img.title = (l.owner || '') + (l.state === 'pending' ? ' (pending)' : '');
    if (l.state === 'pending') img.style.filter = 'grayscale(40%)';
    thumbs.appendChild(img);
  }
}

// ---------- Camera & upload ----------
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = localStream;
  } catch (e) {
    console.warn('camera error', e);
  }
}

// upload blob as 'photo' using fetch FormData -> returns { url }
async function uploadBlob(blob) {
  const fd = new FormData();
  fd.append('photo', blob, 'snap.png');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  return res.json(); // { url }
}

// SNAP handler: capture, upload, add pending layer, emit snapped
async function doSnap() {
  if (!video || video.readyState < 2) {
    // fallback: snapshot a gray placeholder
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    c.getContext('2d').fillStyle = '#ccc'; c.getContext('2d').fillRect(0,0,c.width,c.height);
    return uploadAndEmitFromCanvas(c);
  }
  // capture frame sized proportionally
  const targetW = 800;
  const targetH = Math.round(targetW * (video.videoHeight / video.videoWidth || 3/4));
  const tmp = document.createElement('canvas'); tmp.width = targetW; tmp.height = targetH;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(video, 0, 0, targetW, targetH);
  await uploadAndEmitFromCanvas(tmp);
}

async function uploadAndEmitFromCanvas(tmpCanvas) {
  return new Promise((resolve, reject) => {
    tmpCanvas.toBlob(async (blob) => {
      try {
        // create temp layer immediately for instant UX
        const tempId = mkTempId();
        // create object URL for instant preview (revoked later)
        const localUrl = URL.createObjectURL(blob);
        addLocalLayer({ imageUrl: localUrl, owner: document.getElementById('name').value || 'You', tempId, state: 'pending' });

        // upload
        const j = await uploadBlob(blob);
        const imageUrl = j.url; // server path /uploads/...
        // update local preview from objectURL -> server url
        const localLayer = findLayerByTempId(tempId);
        if (localLayer) {
          localLayer.imageUrl = imageUrl;
          // revoke the previous objectURL after short time may be tricky; skip for now
          localLayer.tempId = null;
        } else {
          addLocalLayer({ imageUrl, owner: document.getElementById('name').value || 'You', state: 'pending' });
        }

        // emit snapped with imageUrl and owner
        socket.emit('snapped', { code: sessionCode, imageUrl, name: document.getElementById('name').value || 'Anon' });

        // wait for server confirmation (which may or may not come back to sender)
        // if server doesn't confirm within 800ms, mark as confirmed locally to avoid permanent pending
        setTimeout(() => {
          const l = findLayerByImageUrl(imageUrl);
          if (l && l.state !== 'confirmed') {
            l.state = 'confirmed';
            l.dropProgress = 1;
            renderThumbs();
            render();
          }
        }, 800);

        resolve();
      } catch (err) {
        console.error('upload error', err);
        reject(err);
      }
    }, 'image/png', 0.9);
  });
}

// ---------- Socket events ----------
socket.on('connect', () => {
  console.log('socket connected', socket.id);
});

socket.on('user-joined', ({ participant, participants: ps }) => {
  participants = ps || [];
  render();
});

socket.on('snapped', ({ layer: serverLayer }) => {
  // serverLayer: { id, owner, imageUrl, timestamp } (server sends)
  confirmLayerFromServer(serverLayer);
});

socket.on('finish', ({ layers: finalLayers }) => {
  // server authoritative final layers; render them (replace local copy)
  if (Array.isArray(finalLayers) && finalLayers.length > 0) {
    layers = finalLayers.map(l => ({ id: l.id, imageUrl: l.imageUrl, owner: l.owner || 'Anon', ts: l.timestamp || now(), state: 'confirmed', dropProgress: 1 }));
    renderThumbs();
    render();
  }
  // export PNG for this client too (so all participants get a download)
  exportCanvasPNG();
});

// ---------- Render logic ----------
let lastRenderTime = performance.now();

async function render(time = 0) {
  // time is in ms, optional; use performance.now fallback
  const t = typeof time === 'number' ? time : performance.now();
  lastRenderTime = t;

  const cw = canvas.width, ch = canvas.height;
  // clear
  ctx.clearRect(0, 0, cw, ch);

  // background
  ctx.fillStyle = '#FFF6EB';
  ctx.fillRect(0, 0, cw, ch);

  // title
  ctx.fillStyle = '#8B6B4A';
  ctx.font = `${24 * devicePixelRatioVal}px Baloo, serif`;
  ctx.fillText('CuteCollage', 20 * devicePixelRatioVal, 40 * devicePixelRatioVal);

  // layout polaroids
  const gap = 20 * devicePixelRatioVal;
  const cols = Math.min(3, Math.max(1, Math.floor((cw - gap) / (240 * devicePixelRatioVal)))); // adapt columns
  const thumbW = Math.min(300 * devicePixelRatioVal, Math.floor((cw - gap * (cols + 1)) / cols));
  const thumbH = Math.round(thumbW * 0.75);

  // ensure we draw top-down with small drop animation for newly-added items
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    // compute grid pos
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (thumbW + gap);
    const baseY = 80 * devicePixelRatioVal + row * (thumbH + gap);

    // dropProgress behaviour: if <1 animate toward 1
    if (!l.dropStartTs) l.dropStartTs = now();
    const elapsed = now() - l.dropStartTs;
    // simple easing: progress from 0 -> 1 in 500ms
    const target = 1;
    if (l.dropProgress < 1) {
      l.dropProgress = Math.min(1, elapsed / 450);
    }
    const dropOffset = (1 - l.dropProgress) * 40 * devicePixelRatioVal; // start 40px above
    const y = baseY + dropOffset;

    const rot = ((i % 2) === 0) ? -0.06 : 0.04;
    // draw polaroid with async image load
    const img = await loadImage(l.imageUrl);
    drawPolaroid(img, x, y, thumbW, thumbH, rot, l, t);
  }
}

function drawPolaroid(img, x, y, w, h, rotation = 0, layer = {}, time = 0) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);
  // image
  if (img) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#eee';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  // frame border (polaroid)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 6 * devicePixelRatioVal;
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  // critter: a small circle with gentle bounce
  const critX = w / 2 - 28 * devicePixelRatioVal;
  const critY = h / 2 - 10 * devicePixelRatioVal;
  const bounce = Math.sin((time / 300) + (layer.ts % 1000) / 1000) * 6 * devicePixelRatioVal;
  ctx.beginPath();
  ctx.fillStyle = '#A0D8FF';
  ctx.arc(critX, critY - bounce, 14 * devicePixelRatioVal, 0, Math.PI * 2);
  ctx.fill();

  // a small heart for confirmed layers
  if (layer.state === 'confirmed') {
    ctx.fillStyle = '#FF6B81';
    ctx.font = `${18 * devicePixelRatioVal}px Inter, sans-serif`;
    ctx.fillText('❤', critX - 6 * devicePixelRatioVal, critY + 6 * devicePixelRatioVal);
  } else {
    // pending indicator
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(-w / 2 + 8 * devicePixelRatioVal, h / 2 - 20 * devicePixelRatioVal, 50 * devicePixelRatioVal, 12 * devicePixelRatioVal);
    ctx.fillStyle = '#8B6B4A';
    ctx.font = `${12 * devicePixelRatioVal}px Inter, sans-serif`;
    ctx.fillText('pending', -w / 2 + 12 * devicePixelRatioVal, h / 2 - 10 * devicePixelRatioVal);
  }

  ctx.restore();
}

// lightweight animation loop to update animation (critters bounce) at ~30fps
let animating = false;
function startAnimationLoop() {
  if (animating) return;
  animating = true;
  (function loop() {
    render(performance.now());
    if (animating) setTimeout(loop, 33); // ~30fps
  })();
}
startAnimationLoop();

// ---------- Export PNG ----------
function exportCanvasPNG(filename = 'cutecollage.png') {
  // render final badge overlay (make copy of canvas if you don't want to mutate)
  // For simplicity we render badge on main canvas before export, then re-render normal view.
  (async () => {
    await render(performance.now());
    // add badge top-right
    const cw = canvas.width, ch = canvas.height;
    ctx.save();
    const pad = 14 * devicePixelRatioVal;
    const bw = 260 * devicePixelRatioVal;
    const bh = 64 * devicePixelRatioVal;
    const bx = cw - bw - pad;
    const by = pad;
    // rounded rect
    roundRect(ctx, bx, by, bw, bh, 12 * devicePixelRatioVal);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.fillStyle = '#8B6B4A';
    ctx.font = `${16 * devicePixelRatioVal}px Inter, sans-serif`;
    const dateText = new Date().toLocaleDateString();
    const names = layers.map(l => l.owner).filter(Boolean).slice(0,3).join(', ');
    ctx.fillText('CuteCollage • ' + dateText, bx + pad, by + 28 * devicePixelRatioVal);
    ctx.fillText(names, bx + pad, by + 48 * devicePixelRatioVal);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      // create auto click download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // show link in shareArea
      shareArea.innerHTML = '';
      const link = document.createElement('a');
      link.href = url;
      link.innerText = 'Download image (png)';
      link.target = '_blank';
      shareArea.appendChild(link);

      // cleanup after a while
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      // re-render normal view to remove badge
      setTimeout(() => render(performance.now()), 100);
    }, 'image/png');
  })();
}

// helper: rounded rect
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- UI wiring ----------
document.getElementById('btnCreate').onclick = async () => {
  const res = await fetch('/api/create', { method: 'POST' });
  const j = await res.json();
  sessionCode = j.code;
  sessionInfo.innerText = 'Code: ' + sessionCode;
  controls.style.display = 'block';
  resizeCanvasImmediate();
  await startCamera();
  socket.emit('join', { code: sessionCode, name: 'Host' });
};

document.getElementById('btnJoin').onclick = async () => {
  const code = prompt('Enter 4-digit code:');
  if (!code) return;
  sessionCode = code;
  sessionInfo.innerText = 'Code: ' + sessionCode;
  controls.style.display = 'block';
  resizeCanvasImmediate();
  await startCamera();
  socket.emit('join', { code: sessionCode, name: document.getElementById('name').value || 'Guest' });
};

document.getElementById('snap').onclick = async () => {
  try {
    await doSnap();
  } catch (e) {
    console.error('snap failed', e);
    alert('Snap failed: ' + (e.message || e));
  }
};

document.getElementById('finish').onclick = async () => {
  if (!sessionCode) return alert('No session');
  socket.emit('finish', { code: sessionCode });
  // immediate export for this client
  exportCanvasPNG();
};

// initial sizing
setTimeout(() => resizeCanvasImmediate(), 300);
