## Inspiration

Everyone has someone they wish they could take a photo with right now — a best friend studying abroad, grandparents back home, or teammates scattered across time zones.

We're a group of international students who live this reality every day. Group photos shouldn't require being in the same room. So we asked ourselves: **what if a photobooth had no walls?**

That's ShareBooth. **Distance disappears. Memories stay.**

## What it does

ShareBooth is a real-time, collaborative photobooth that puts everyone in the same frame — no matter where they are in the world.

Here's how it works:
1. **Create a session** and share a 4-digit code with your people
2. **Everyone joins from their own device** — phone, laptop, anywhere
3. **Snap your photos**, and they appear together on a shared canvas instantly
4. **Customize everything** — pick a layout, add stickers, change photo shapes to hearts, stars, or clouds, apply color filters, and add text
5. **Export and share** — one tap, one perfect group photo

No downloads. No editing skills. No awkward Photoshop merging. Just open a browser, join, and create.

We also built a set of hand-drawn stickers made specifically for HackHer — adding a personal, playful touch to every photo.

## How we built it

Everything runs in the browser — no heavy server-side processing needed.

- **Frontend:** Vanilla HTML, CSS, and JavaScript. All photo compositing happens client-side using the **Canvas API**, keeping the experience instant and responsive.
- **Real-time sync:** **Socket.IO** keeps every participant's canvas perfectly in sync — when someone snaps a photo, moves a sticker, or changes the layout, everyone sees it immediately.
- **Camera & background removal:** The **WebRTC API** captures live camera feeds, and **MediaPipe Selfie Segmentation** removes backgrounds in real-time at ~30fps — so you can place yourself on any backdrop.
- **Backend:** A lightweight **Node.js + Express** server on **DigitalOcean** handles session management, file uploads, and WebSocket coordination.

The result: a fast, lightweight experience that works across devices and continents with minimal latency.

## Challenges we ran into

- **Background removal in real-time** — running ML-based segmentation at 30fps in the browser while keeping things smooth was a serious technical challenge
- **Cross-device consistency** — different screen sizes, camera resolutions, and lighting conditions meant every photo looked different. We had to normalize and composite them into one cohesive frame
- **Latency across continents** — syncing canvas state between users in different countries while keeping the experience feel instant
- **Making powerful features feel simple** — the editing tools are deep (shapes, layouts, stickers, text, filters), but the interface had to feel effortless on first use

## Accomplishments that we're proud of

- **Zero-install, one-click group photos** — from any browser, any device, anywhere
- **Client-side compositing** — all rendering happens locally, making the experience fast regardless of server load
- **Real-time collaboration that actually feels real-time** — layout changes, stickers, and photo edits sync instantly across all participants
- **Hand-drawn HackHer stickers** — created by our teammate, adding something genuinely personal that no template could replicate
- **It just works** — our grandparents could use it, and our friends actually want to

## What we learned

- **Real-time media sync is harder than it looks** — but the payoff is magic when it works
- **Simplicity is the hardest feature to build** — every "easy" interaction required careful UX decisions behind the scenes
- **The best tools disappear** — users shouldn't think about WebSockets or Canvas APIs. They should just see their friends and smile
- **Building as international students gave us the problem and the perspective** — we didn't just imagine the distance problem, we live it

## What's next for ShareBooth

- **Larger groups** — support for bigger sessions with even more participants
- **AR effects and live props** — real-time face filters and accessories during the photobooth session
- **Public booths** — open sessions anyone can join, perfect for events, concerts, or online communities
- **Performance optimization** — smarter compression and adaptive quality to work seamlessly even on slower connections
