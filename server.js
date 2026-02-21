// CuteCollage - Minimal server
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
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true, limit:'10mb'}));

const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);
app.use('/', express.static(PUBLIC));
app.use('/uploads', express.static(UPLOADS));

// In-memory sessions
const sessions = {}; // code => { id, code, host, participants:[], layers:[] }

// create a new session
app.post('/api/create', (req,res)=>{
  const code = Math.floor(1000 + Math.random()*9000).toString();
  sessions[code] = { id: uuidv4(), code, participants: [], layers: [] };
  res.json({ code });
});

// multer for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS); },
  filename: function (req, file, cb) { const name = Date.now() + '-' + file.originalname; cb(null, name); }
});
const upload = multer({ storage });

// upload image endpoint
app.post('/api/upload', upload.single('photo'), (req,res)=>{
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// simple session listing (debug)
app.get('/api/sessions', (req,res)=> res.json(Object.keys(sessions)));

// Socket.io realtime
io.on('connection', socket => {
  console.log('conn', socket.id);
  socket.on('join', ({code, name})=>{
    if (!code || !sessions[code]) {
      socket.emit('join-error', { message: 'Invalid code' });
      return;
    }
    socket.join(code);
    const participant = { id: socket.id, name: name || 'Anon', critter: 'mochi-' + (Math.floor(Math.random()*4)+1) };
    sessions[code].participants.push(participant);
    io.to(code).emit('user-joined', { participant, participants: sessions[code].participants });
    console.log(code, 'joined', participant.name);
  });

  socket.on('snapped', ({code, imageUrl, name})=>{
    if (!sessions[code]) return;
    const layer = { id: uuidv4(), owner: name || 'Anon', imageUrl, timestamp: Date.now() };
    sessions[code].layers.push(layer);
    socket.to(code).emit('snapped', { layer });
  });

  socket.on('finish', ({code})=>{
    if (!sessions[code]) return;
    io.to(code).emit('finish', { layers: sessions[code].layers });
  });

  socket.on('disconnect', ()=> {
    // remove from sessions
    for (const c in sessions) {
      sessions[c].participants = sessions[c].participants.filter(p=>p.id !== socket.id);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, ()=> console.log('CuteCollage server running on', PORT));
