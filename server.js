// Sharebooth - Server with decorations, layouts, challenges
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);
app.use('/', express.static(PUBLIC));
app.use('/uploads', express.static(UPLOADS));

// In-memory sessions
const sessions = {};

app.post('/api/create', (req, res) => {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  sessions[code] = {
    id: uuidv4(),
    code,
    participants: [],
    layers: [],
    decorations: [],
    currentPrompt: null,
    layout: 'freeform',
    frameBg: { type: 'color', color: '#FFF6EB' }
  };
  res.json({ code });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.get('/api/sessions', (req, res) => res.json(Object.keys(sessions)));

// Socket.IO
io.on('connection', socket => {
  console.log('conn', socket.id);

  socket.on('join', ({ code, name }) => {
    if (!code || !sessions[code]) {
      socket.emit('join-error', { message: 'Invalid code' });
      return;
    }
    socket.join(code);
    const participant = { id: socket.id, name: name || 'Anon' };
    sessions[code].participants.push(participant);
    io.to(code).emit('user-joined', { participant, participants: sessions[code].participants });
    console.log(code, 'joined', participant.name);

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
    socket.emit('frame-bg-sync', sessions[code].frameBg);
  });

  socket.on('snapped', ({ code, imageUrl, name }) => {
    if (!sessions[code]) return;
    const layer = { id: uuidv4(), owner: name || 'Anon', imageUrl, timestamp: Date.now() };
    sessions[code].layers.push(layer);
    socket.to(code).emit('snapped', { layer });
  });

  socket.on('finish', ({ code }) => {
    if (!sessions[code]) return;
    io.to(code).emit('finish', { layers: sessions[code].layers });
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

  socket.on('decoration-remove', ({ code, id }) => {
    if (!sessions[code]) return;
    sessions[code].decorations = sessions[code].decorations.filter(d => d.id !== id);
    socket.to(code).emit('decoration-remove', { id });
  });

  // Layout
  socket.on('layout-change', ({ code, layout }) => {
    if (!sessions[code]) return;
    sessions[code].layout = layout;
    socket.to(code).emit('layout-change', { layout });
  });

  // Frame background
  socket.on('frame-bg-change', ({ code, bgType, bgColor }) => {
    if (!sessions[code]) return;
    sessions[code].frameBg = { type: bgType, color: bgColor };
    socket.to(code).emit('frame-bg-change', { bgType, bgColor });
  });

  socket.on('disconnect', () => {
    for (const c in sessions) {
      sessions[c].participants = sessions[c].participants.filter(p => p.id !== socket.id);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('Sharebooth running on', PORT));
