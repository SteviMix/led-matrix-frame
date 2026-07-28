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

**Phase 3 part 2 complete** (collaborative live drawing), on top of mode management + slideshow (part 1) and a working Phase 2 pipeline, verified against the browser-based emulator (real HUB75 panels have not arrived yet).

Playlists, crop/pan, dithering, and slideshow all work. Live drawing now works too: any number of browser tabs can draw on a shared 128x128 canvas over a WebSocket, see each other's strokes in real time, and the canvas streams to the renderer at a fixed ~30fps independent of how fast people draw. Paint-by-number and the Angular frontend are not built yet.

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

**Terminal 3 — manual test: playlist → slideshow → restart:**

```bash
# Create a playlist
curl -X POST -H "Content-Type: application/json" -d '{"name":"My playlist"}' http://localhost:3000/api/playlists
# -> {"id":1,...}

# Upload a couple of images (each returns its row, including its id)
curl -X POST -F "image=@/path/to/photo1.jpg" http://localhost:3000/api/images
curl -X POST -F "image=@/path/to/photo2.jpg" http://localhost:3000/api/images

# Assign each image to the playlist (repeat per image id)
curl -X PATCH -H "Content-Type: application/json" -d '{"playlistId":1}' http://localhost:3000/api/images/1
curl -X PATCH -H "Content-Type: application/json" -d '{"playlistId":1}' http://localhost:3000/api/images/2

# Start the slideshow on that playlist
curl -X POST -H "Content-Type: application/json" -d '{"playlistId":1}' http://localhost:3000/api/modes/slideshow/start
```

Watch `http://ledframe.local:8888` — the images should cycle automatically (every 10s by default; `PATCH /api/modes/slideshow/settings` with `{"intervalSeconds":2}` to speed that up while testing). `POST /api/modes/slideshow/next` and `/previous` jump manually.

**Restart proof (the reason SQLite is in the stack):** with the slideshow running, stop the backend (Ctrl+C in terminal 2) and start it again (`npm start`) — without touching terminal 1 or re-creating anything:
```bash
curl http://localhost:3000/api/status
```
`mode.mode` should already read `"slideshow"` with the same playlist and the timer running again — the backend read `current_mode` and `active_playlist` back out of `app_state` on startup and resumed on its own.

**Cropping an image** (re-processes the original, overwrites the processed file, never touches the original):
```bash
curl -X POST -H "Content-Type: application/json" -d '{"cropX":50,"cropY":50,"cropW":150,"cropH":150}' http://localhost:3000/api/images/1/crop
```

**Status check** at any point:
```bash
curl http://localhost:3000/api/status
```
Reports renderer connection state, DB connection state, row counts per table, and current mode state (mode name, active playlist, image count, current index, interval, running).

## Manual test: live drawing (Phase 3 part 2)

There's no Angular frontend yet, so `backend/public/draw-test.html` (served automatically by the backend) is the manual test client — a plain HTML canvas that talks to `/ws/draw`.

With **Terminal 1** (renderer) and **Terminal 2** (backend) already running:

```bash
curl -X POST http://localhost:3000/api/modes/draw/start
```

Then, from a Mac/laptop on the same network:

1. Open `http://ledframe.local:3000/draw-test.html` in **two separate browser tabs** (or two different devices).
2. Draw in tab 1 — strokes should appear in **both** tab 1 (drawn locally as you go) and tab 2 (received over the WebSocket), and on the matrix in `http://ledframe.local:8888`.
3. Open a **third** tab mid-session — it should immediately show the existing drawing (the snapshot sent on connect), not a blank canvas.
4. Click **Clear** in any tab — all tabs should go blank together.
5. Draw something, click **Save** — it should alert with a new image id. Confirm it landed in the database:
   ```bash
   curl http://localhost:3000/api/images
   ```
   The newest row should have `"source":"draw"`, and both `original_path` (a `.png`) and `processed_path` (a `.rgb`) should exist on disk.
6. Switch away and back to confirm the render loop is fully torn down, not leaked:
   ```bash
   curl -X POST http://localhost:3000/api/modes/slideshow/stop   # -> idle
   curl -X POST http://localhost:3000/api/modes/draw/clear       # -> 409, draw is not active
   curl -X POST http://localhost:3000/api/modes/draw/start       # -> fresh blank canvas, old drawing gone
   ```
   A stray timer from the old session would keep pushing frames after step 6's `stop`; a fresh, blank canvas on the next `start` confirms the old instance was fully discarded, not paused.

## C++ renderer

`renderer/src/main.cpp` compiles cleanly against `rpi-rgb-led-matrix` (`cd renderer && make`) and implements the identical socket protocol, but it is **unverified** — it has not run against real HUB75 panels because the hardware hasn't arrived yet. It is the Phase 6 target; `renderer_emulator.py` is the active renderer until then.