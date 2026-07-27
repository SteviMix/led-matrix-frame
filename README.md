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

**Phase 3 part 1 complete** (mode management + slideshow), on top of a working Phase 2 pipeline, verified against the browser-based emulator (real HUB75 panels have not arrived yet):

HTTP upload → Python image processing (crop + dither) → SQLite → mode manager → slideshow timer → Unix socket → renderer → matrix

Playlists, crop/pan, and dithering all work. A mode manager now guarantees only one mode (slideshow, draw, paint-by-number, idle) can write to the renderer at a time, and the active mode survives a backend restart. Live drawing, paint-by-number, and the Angular frontend are not built yet.

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

## C++ renderer

`renderer/src/main.cpp` compiles cleanly against `rpi-rgb-led-matrix` (`cd renderer && make`) and implements the identical socket protocol, but it is **unverified** — it has not run against real HUB75 panels because the hardware hasn't arrived yet. It is the Phase 6 target; `renderer_emulator.py` is the active renderer until then.