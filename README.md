# LED Matrix Digital Frame

A custom digital photo frame built on Raspberry Pi, driving HUB75 LED matrix panels. Designed as a gift, it runs fully offline as a local Wi-Fi access point and offers three interactive modes controlled from any phone or laptop on the network.

## Features (planned)

- **Slideshow mode** — upload photos with an adjustable crop/pan selector, organize them into playlists, and display them with dithering optimized for LED panels.
- **Live drawing mode** — draw in real time from a phone or laptop; each stroke appears instantly on the matrix over a WebSocket connection.
- **Paint-by-number mode** — upload an image, and the Raspberry Pi processes it into a color-mapped grid. As the user colors each block, the panel reveals the original image's true shades.

## Tech Stack

- **Hardware:** Raspberry Pi 4, 2x P2 HUB75 LED panels (128x128 px total), RGB Matrix Bonnet
- **Low-level rendering:** C++ with the hzeller/rpi-rgb-led-matrix library
- **Backend:** Node.js (Express + WebSocket), SQLite
- **Frontend:** Angular
- **Image processing:** Python (OpenCV, scikit-learn) for K-means color quantization
- **Networking:** hostapd (local access point, no internet required)

## Status

**Phase 3 complete** — all three interactive modes (slideshow, live drawing, paint-by-number) work end to end against the browser-based emulator (real HUB75 panels have not arrived yet).

Playlists, crop/pan, dithering, and slideshow all work. Live drawing lets any number of browser tabs paint on a shared 128x128 canvas over a WebSocket, seeing each other's strokes in real time, streamed to the renderer at a fixed ~30fps independent of how fast people draw. Paint-by-number analyzes an uploaded photo into a K-means colour palette and a difficulty-sized block grid; the panel shows dimmed hint colours for unsolved blocks and reveals true photo detail as each block is coloured correctly, with progress persisted so a session can be resumed after a restart.

**Phase 4 in progress** — the Angular frontend is scaffolded, connected to the backend (`GET /api/status` proven end to end), and has a routing skeleton with empty placeholder screens for viewer/slideshow/draw/admin/paint-by-number. None of the feature UIs are built yet — paint-by-number's number/colour-picker UI in particular is entirely a Phase 4 concern; the backend only produces the data and enforces the rules. Until each screen is built, its mode is only testable via `curl` (see Manual testing below).

## Architecture

```
Phone / laptop (LAN)
        │ HTTP
        ▼
Node backend (Express)  ──────────────►  SQLite (backend/db/ledframe.db)
        │                                  playlists, images, pbn_sessions,
        │ spawns per request                app_state — paths & metadata only,
        ▼                                    never image blobs
Python (scripts/process_image.py)
  center-crop → resize to 128x128
  → raw RGB file (49152 bytes)
        │
        │ Node reads the file, forwards bytes unchanged
        ▼
Unix domain socket (/tmp/ledframe.sock)
  raw RGB, 128*128*3 = 49152 bytes,
  row-major, no header, one frame
  after another on one persistent connection
        │
        ▼
Renderer (swappable, same protocol on both sides)
  ├─ renderer/renderer_emulator.py  → RGBMatrixEmulator → browser view (current dev target)
  └─ renderer/src/main.cpp          → rpi-rgb-led-matrix → physical HUB75 panels (Phase 6)
```

The wire protocol (raw RGB, row-major, no header, no length prefix) is identical across the Node client and both renderer implementations. That identity is what lets the renderer be swapped — emulator today, real hardware later — without touching the backend.

## Setup & run

Requires Python 3 with OpenCV/numpy/Pillow (system-wide) and Node.js. `backend/` has its own `npm install` (Express, better-sqlite3, multer, ws).

**Terminal 1 — renderer (emulator):**
```bash
cd ~/led-frame
python3 renderer/renderer_emulator.py
```
Open `http://ledframe.local:8888` in a browser to watch the matrix live.

**Terminal 2 — backend:**
```bash
cd ~/led-frame/backend
npm start
```

## Manual testing (no Angular UI yet for these modes)

With **Terminal 1** (renderer) and **Terminal 2** (backend) running, each mode was verified via `curl` during development — the panel itself (`http://ledframe.local:8888`) is the visual feedback. Full status at any point:
```bash
curl http://localhost:3000/api/status
```
Reports renderer/DB connection state, row counts per table, and current mode (name, active playlist, index, interval, running).

**Slideshow** — create a playlist, upload images, assign them, start:
```bash
curl -X POST -H "Content-Type: application/json" -d '{"name":"My playlist"}' http://localhost:3000/api/playlists
curl -X POST -F "image=@/path/to/photo1.jpg" http://localhost:3000/api/images
curl -X PATCH -H "Content-Type: application/json" -d '{"playlistId":1}' http://localhost:3000/api/images/1
curl -X POST -H "Content-Type: application/json" -d '{"playlistId":1}' http://localhost:3000/api/modes/slideshow/start
```
Images cycle automatically (10s default; `PATCH /api/modes/slideshow/settings` to adjust; `/next` and `/previous` jump manually). Cropping re-processes the original without touching it: `POST /api/images/:id/crop` with `{cropX,cropY,cropW,cropH}`.
**Restart proof:** stop and restart the backend mid-slideshow — `GET /api/status` already shows the same mode and playlist, resumed from `app_state` in SQLite.

**Live drawing** — `backend/public/draw-test.html` (served automatically) is the manual test client:
```bash
curl -X POST http://localhost:3000/api/modes/draw/start
```
Open `http://ledframe.local:3000/draw-test.html` in multiple tabs/devices — strokes drawn in one appear in the others over WebSocket (never echoed back to the sender), a tab joining mid-session gets the current canvas as a snapshot, **Clear** blanks every tab together, and **Save** persists the canvas as an `images` row (`source: "draw"`, visible via `GET /api/images`).

**Paint-by-number** — create a session (`difficulty`: `easy`/`medium`/`hard` → 16x16/32x32/64x64 blocks), start it, then colour blocks:
```bash
curl -X POST -F "image=@/path/to/photo.jpg" -F "difficulty=easy" http://localhost:3000/api/pbn/create
curl -X POST -H "Content-Type: application/json" -d '{"sessionId":1}' http://localhost:3000/api/modes/paint-by-number/start
curl -X POST -H "Content-Type: application/json" -d '{"blockIndex":0,"paletteIndex":<correct index from GET /api/pbn/1>}' http://localhost:3000/api/pbn/1/color
```
The panel shows dimmed hint colours for unsolved blocks (no numbers — that's a Phase 4 concern), revealing true photo detail as each block is coloured correctly; wrong guesses are rejected and change nothing. Progress is written to SQLite on every correct move — colouring takes days in practice, so a restart resumes exactly where it left off. Once `completed: true`, `POST /api/pbn/:id/save` writes two images: the flat block-colour pixel art and the full-res revealed photo, both usable in a slideshow.

## C++ renderer

`renderer/src/main.cpp` compiles cleanly against `rpi-rgb-led-matrix` (`cd renderer && make`) and implements the identical socket protocol, but it is **unverified** — it has not run against real HUB75 panels because the hardware hasn't arrived yet. It is the Phase 6 target; `renderer_emulator.py` is the active renderer until then.