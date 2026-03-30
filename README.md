# ShareBooth

**Real-time collaborative photobooth -- group photos without borders.**

ShareBooth lets people from anywhere in the world join a shared session, snap photos from their own devices, and compose them together on a live canvas with layouts, stickers, background removal, and more. No downloads, no editing skills -- just open a browser and create.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (>=18) |
| **Server** | Express 4.x |
| **Real-time** | Socket.IO 4.x (WebSocket with fallback) |
| **Frontend** | Vanilla HTML5 / CSS3 / JavaScript (no build step) |
| **Rendering** | Canvas API (client-side compositing) |
| **Camera** | WebRTC API (getUserMedia) |
| **Background Removal** | MediaPipe Selfie Segmentation (~30 fps live), @imgly/background-removal (high-quality export) |
| **Icons** | Boxicons 2.1 |
| **Fonts** | Google Fonts (Baloo 2, Inter) |
| **Utilities** | UUID, CORS, Multer |

---

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Client A   │    │  Client B   │    │  Client C   │
│  (Browser)  │    │  (Browser)  │    │  (Browser)  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │ WebSocket        │ WebSocket        │ WebSocket
       │ (Socket.IO)      │ (Socket.IO)      │ (Socket.IO)
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │   Node.js /     │
                 │   Express       │
                 │   Server        │
                 │                 │
                 │  ┌───────────┐  │
                 │  │ In-Memory │  │
                 │  │ Sessions  │  │
                 │  └───────────┘  │
                 │                 │
                 │  Socket.IO      │
                 │  Room Mgmt     │
                 └─────────────────┘
```

### How It Works

1. **Session creation** -- Host hits `POST /api/create`, server generates a 4-digit room code and stores session state in memory.
2. **Joining** -- Participants connect via WebSocket and join the Socket.IO room. Late joiners receive the full current state (photos, decorations, layout, frame settings).
3. **Photo capture** -- Each client captures a frame via WebRTC, optionally applies real-time background removal with MediaPipe, and emits the base64 image over the socket.
4. **Server broadcast** -- The server stores the photo in the session's layer array and broadcasts it to all other participants in the room.
5. **Canvas compositing** -- Every client renders the shared canvas locally using the Canvas API: background, layout slots, photos with transforms, decorations, and text.
6. **Collaboration sync** -- All interactions (drag, scale, rotate, add stickers, change layout) emit socket events that are broadcast to the room in real time.
7. **Cleanup** -- Sessions are garbage-collected 60 seconds after the last participant disconnects.

### Data Flow

```
Camera Frame
  → MediaPipe segmentation mask (optional, ~30 fps)
  → Canvas render → base64 data URL
  → Socket.IO emit ("snapped")
  → Server stores in sessions[code].layers[]
  → Broadcast to room
  → All clients re-render canvas
```

All photo compositing and rendering happens **client-side**. The server is a lightweight coordination layer -- it never processes images.

---

## Project Structure

```
sharebooth/
├── server.js               # Express + Socket.IO server (~300 lines)
├── package.json            # Dependencies & scripts
├── render.yaml             # Render deployment config
├── public/
│   ├── index.html          # Single-page app shell
│   ├── client.js           # Core client logic (~4400 lines)
│   ├── prompts.js          # Pose prompt data
│   ├── style.css           # All styles (~2600 lines)
│   └── logo.svg            # App logo
└── assets/
    ├── logo/               # Light/dark logo variants
    ├── background/         # Preset frame backgrounds
    └── stickers/           # Themed sticker packs
        ├── hackher/        # HackHer collection
        └── vietnam/        # Vietnam collection
```

---

## Features

**Camera & Capture**
- Front/back camera toggle with mirror view
- Countdown timer (3s / 5s)
- Real-time background removal with live preview
- Custom background color or image upload
- Photo import from device

**Layouts & Canvas**
- 7 layout presets: 2-cut, 3-strip, 4-strip, 2x2, 6-cut, 1-big-3, freeform
- 8 aspect ratios including Instagram Post (4:5) and Story (9:16)
- Drag, pinch-to-scale, two-finger rotate on photos
- Photo shapes: rectangle, circle, oval, heart, star, cloud

**Decorations**
- Emoji stickers and themed sticker packs
- Text with customizable font, size, weight, color, and background
- All decorations are draggable, scalable, and rotatable

**Frame Customization**
- Solid color or image backgrounds (cover / tiled repeat)
- Adjustable border width, radius, and color

**Collaboration**
- 4-digit session codes with optional password protection
- Live participant list
- Full state sync for late joiners
- Automatic reconnection on network loss

**Export**
- Download composite as PNG
- Copy shareable link

---

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:4000`. Click **Create Session** in one tab, copy the code, and **Join with Code** from another.

---

## Deployment

ShareBooth runs on any Node.js host. The server listens on `process.env.PORT` (default `4000`).

### Render

A `render.yaml` is included for one-click deploy on [Render](https://render.com):

```yaml
services:
  - type: web
    runtime: node
    buildCommand: npm install
    startCommand: node server.js
```

### DigitalOcean App Platform

Connect the GitHub repo and DigitalOcean will auto-detect the Node.js app. Set the run command to `node server.js`.

### Any Node.js Host

```bash
git clone https://github.com/AndyHuynh24/sharebooth.git
cd sharebooth
npm install
node server.js
```

For production, use a process manager like [PM2](https://pm2.keymetrics.io/):

```bash
pm2 start server.js --name sharebooth
```

---

## License

MIT
