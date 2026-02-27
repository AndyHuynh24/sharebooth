// Sharebooth - Server with decorations, layouts, challenges
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket'],
  allowUpgrades: false,
  maxHttpBufferSize: 5e6 // 5MB — enough for base64 image data
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PUBLIC = path.join(__dirname, 'public');
const ASSETS = path.join(__dirname, 'assets');
app.use('/', express.static(PUBLIC));
app.use('/assets', express.static(ASSETS));

// In-memory sessions
const sessions = {};
const cleanupTimers = {};

function generateUniqueCode() {
  const existing = new Set(Object.keys(sessions));
  if (existing.size >= 9000) return null; // all 1000-9999 taken
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (existing.has(code));
  return code;
}

app.post('/api/create', (req, res) => {
  const code = generateUniqueCode();
  if (!code) return res.status(503).json({ error: 'No room codes available' });
  const { password, aspectRatio, layout } = req.body || {};
  sessions[code] = {
    id: uuidv4(),
    code,
    password: password || null,
    aspectRatio: aspectRatio || null,
    participants: [],
    layers: [],
    decorations: [],
    currentPrompt: null,
    layout: layout || 'strip',
    frameBg: { type: 'color', color: '#8070B6' }
  };
  res.json({ code });
});

// Session info (for join-by-URL)
app.get('/api/session/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    code: session.code,
    hasPassword: !!session.password,
    participantCount: session.participants.length,
    aspectRatio: session.aspectRatio,
    layout: session.layout
  });
});

app.get('/api/sessions', (req, res) => res.json(Object.keys(sessions)));

// Socket.IO
io.on('connection', socket => {
  console.log('conn', socket.id);

  socket.on('join', ({ code, name, password }) => {
    if (!code || !sessions[code]) {
      socket.emit('join-error', { message: 'Invalid code' });
      return;
    }
    if (sessions[code].password && sessions[code].password !== password) {
      socket.emit('join-error', { message: 'Incorrect password' });
      return;
    }
    socket.join(code);
    // Cancel any pending cleanup timer
    if (cleanupTimers[code]) {
      clearTimeout(cleanupTimers[code]);
      delete cleanupTimers[code];
    }
    // Remove any stale entry for this socket (in case of reconnect)
    sessions[code].participants = sessions[code].participants.filter(p => p.id !== socket.id);
    const participant = { id: socket.id, name: name || 'Anon' };
    sessions[code].participants.push(participant);
    io.to(code).emit('user-joined', { participant, participants: sessions[code].participants });
    console.log(code, 'joined', participant.name, '(' + sessions[code].participants.length + ' total)');

    // Sync existing state to late joiners
    if (sessions[code].layers.length > 0) {
      socket.emit('layers-sync', { layers: sessions[code].layers });
    }
    if (sessions[code].decorations.length > 0) {
      socket.emit('decorations-sync', { decorations: sessions[code].decorations });
    }
    if (sessions[code].currentPrompt) {
      socket.emit('prompt', { text: sessions[code].currentPrompt });
    }
    socket.emit('layout-sync', { layout: sessions[code].layout });
    const fb = sessions[code].frameBg;
    socket.emit('frame-bg-sync', { bgType: fb.type, bgColor: fb.color, bgImageUrl: fb.imageUrl, bgMode: fb.mode, bgScale: fb.scale });
    if (sessions[code].frameBorder) {
      socket.emit('frame-border-change', sessions[code].frameBorder);
    }
    if (sessions[code].aspectRatio) {
      socket.emit('aspect-ratio-sync', { aspectRatio: sessions[code].aspectRatio });
    }
  });

  // Photo snap — receives base64 data URL directly (no file upload needed)
  socket.on('snapped', ({ code, id, imageData, name }) => {
    if (!sessions[code]) return;
    const layer = { id: id || uuidv4(), owner: name || 'Anon', imageUrl: imageData, timestamp: Date.now() };
    sessions[code].layers.push(layer);
    socket.to(code).emit('snapped', { layer });
  });

  socket.on('photo-delete', ({ code, photoId }) => {
    if (!sessions[code] || !photoId) return;
    sessions[code].layers = sessions[code].layers.filter(l => l.id !== photoId);
    socket.to(code).emit('photo-delete', { photoId });
  });

  socket.on('finish', ({ code }) => {
    if (!sessions[code]) return;
    socket.to(code).emit('finish', { layers: sessions[code].layers });
  });

  // Pose prompt
  socket.on('prompt', ({ code, text }) => {
    if (!sessions[code]) return;
    sessions[code].currentPrompt = text;
    socket.to(code).emit('prompt', { text });
  });

  // Decorations
  socket.on('decoration-add', ({ code, decoration }) => {
    if (!sessions[code]) return;
    sessions[code].decorations.push(decoration);
    socket.to(code).emit('decoration-add', { decoration });
  });

  socket.on('decoration-move', ({ code, id, x, y }) => {
    if (!sessions[code]) return;
    const dec = sessions[code].decorations.find(d => d.id === id);
    if (dec) { dec.x = x; dec.y = y; }
    socket.to(code).emit('decoration-move', { id, x, y });
  });

  socket.on('decoration-scale', ({ code, id, scale }) => {
    if (!sessions[code]) return;
    const dec = sessions[code].decorations.find(d => d.id === id);
    if (dec) { dec.scale = scale; }
    socket.to(code).emit('decoration-scale', { id, scale });
  });

  socket.on('decoration-rotate', ({ code, id, rotation }) => {
    if (!sessions[code]) return;
    const dec = sessions[code].decorations.find(d => d.id === id);
    if (dec) dec.rotation = rotation;
    socket.to(code).emit('decoration-rotate', { id, rotation });
  });

  socket.on('decoration-remove', ({ code, id }) => {
    if (!sessions[code]) return;
    sessions[code].decorations = sessions[code].decorations.filter(d => d.id !== id);
    socket.to(code).emit('decoration-remove', { id });
  });

  socket.on('decoration-update', ({ code, id, props }) => {
    if (!sessions[code]) return;
    const dec = sessions[code].decorations.find(d => d.id === id);
    if (dec) Object.assign(dec, props);
    socket.to(code).emit('decoration-update', { id, props });
  });

  // Layout
  socket.on('layout-change', ({ code, layout }) => {
    if (!sessions[code]) return;
    sessions[code].layout = layout;
    socket.to(code).emit('layout-change', { layout });
  });

  // Aspect ratio
  socket.on('aspect-ratio-change', ({ code, aspectRatio }) => {
    if (!sessions[code]) return;
    sessions[code].aspectRatio = aspectRatio;
    socket.to(code).emit('aspect-ratio-change', { aspectRatio });
  });

  // Frame background
  socket.on('frame-bg-change', ({ code, bgType, bgColor, bgImageUrl, bgMode, bgScale }) => {
    if (!sessions[code]) return;
    sessions[code].frameBg = { type: bgType, color: bgColor, imageUrl: bgImageUrl, mode: bgMode, scale: bgScale };
    socket.to(code).emit('frame-bg-change', { bgType, bgColor, bgImageUrl, bgMode, bgScale });
  });

  // Frame border sync
  socket.on('frame-border-change', ({ code, width, radius, color }) => {
    if (!sessions[code]) return;
    if (!sessions[code].frameBorder) sessions[code].frameBorder = {};
    if (width !== undefined) sessions[code].frameBorder.width = width;
    if (radius !== undefined) sessions[code].frameBorder.radius = radius;
    if (color !== undefined) sessions[code].frameBorder.color = color;
    socket.to(code).emit('frame-border-change', { width, radius, color });
  });

  // Photo edit (move/scale/shape/crop) sync
  socket.on('photo-edit', ({ code, index, offsetX, offsetY, scale, shape, borderColor, cropX, cropY, cropScale, rotation }) => {
    if (!sessions[code]) return;
    const layer = sessions[code].layers[index];
    if (layer) {
      if (offsetX !== undefined) layer.offsetX = offsetX;
      if (offsetY !== undefined) layer.offsetY = offsetY;
      if (scale !== undefined) layer.scale = scale;
      if (shape !== undefined) layer.shape = shape;
      if (borderColor !== undefined) layer.borderColor = borderColor;
      if (cropX !== undefined) layer.cropX = cropX;
      if (cropY !== undefined) layer.cropY = cropY;
      if (cropScale !== undefined) layer.cropScale = cropScale;
      if (rotation !== undefined) layer.rotation = rotation;
    }
    socket.to(code).emit('photo-edit', { index, offsetX, offsetY, scale, shape, borderColor, cropX, cropY, cropScale, rotation });
  });

  // Photo swap sync
  socket.on('photo-swap', ({ code, fromIndex, toIndex }) => {
    if (!sessions[code]) return;
    const arr = sessions[code].layers;
    if (fromIndex >= 0 && toIndex >= 0 && fromIndex < arr.length && toIndex < arr.length) {
      const temp = arr[fromIndex];
      arr[fromIndex] = arr[toIndex];
      arr[toIndex] = temp;
    }
    socket.to(code).emit('photo-swap', { fromIndex, toIndex });
  });

  // Slot assign/unassign (lightweight — only sends photo ID, not data)
  socket.on('slot-assign', ({ code, slotIndex, photoId }) => {
    if (!sessions[code]) return;
    socket.to(code).emit('slot-assign', { slotIndex, photoId });
  });
  socket.on('slot-unassign', ({ code, slotIndex }) => {
    if (!sessions[code]) return;
    socket.to(code).emit('slot-unassign', { slotIndex });
  });

  socket.on('disconnect', () => {
    for (const c in sessions) {
      const before = sessions[c].participants.length;
      sessions[c].participants = sessions[c].participants.filter(p => p.id !== socket.id);
      const after = sessions[c].participants.length;
      // Only broadcast if this socket was actually in this session
      if (before !== after) {
        io.to(c).emit('user-left', { participantId: socket.id, participants: sessions[c].participants });
        console.log(c, 'left (' + after + ' remaining)');
      }
      if (after === 0) {
        if (cleanupTimers[c]) clearTimeout(cleanupTimers[c]);
        const code = c;
        cleanupTimers[code] = setTimeout(() => {
          if (sessions[code] && sessions[code].participants.length === 0) {
            delete sessions[code];
            console.log('Session', code, 'cleaned up');
          }
          delete cleanupTimers[code];
        }, 60000); // 1 min grace period
      }
    }
  });
});

// SPA catch-all: serve index.html for /[4-digit-code] URLs
app.get('/:code(\\d{4})', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('Sharebooth running on', PORT));
