# CuteCollage - Minimal Cutest Hack Demo

This is a minimal demo implementation for the Cutest Hack "CuteCollage" idea.
It's intentionally small and focused on the core experience: create a session, friends join with a 4-digit code, snap photos, and see cute critters appear.

## Run locally

1. Install Node dependencies:
   ```
   npm install
   ```
2. Start server:
   ```
   npm start
   ```
3. Open `http://localhost:4000` in two browser windows (or share the server if hosted).
4. Click **Create Cuddle** in one window, copy the code, and join from another window using **Join with Code**.

## Files
- `server.js` — Node + Express + socket.io server (minimal)
- `public/` — static client with camera, canvas, and simple composition
- `uploads/` — where photos are saved (created on first upload)

## Notes / Next steps
- This demo uses client-side composition for instant responsiveness.
- For the full hack: add sprite sheets for Mochi, better critter AI, WebM export server-side fallback, and social integrations.
