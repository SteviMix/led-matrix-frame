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

**Phase 2 complete.** The core architecture works end to end, verified against the browser-based emulator (real HUB75 panels have not arrived yet):

HTTP upload → Python image processing → SQLite → Unix socket → renderer → matrix

Slideshow crop/pan UI, playlists, live drawing, paint-by-number, and the Angular frontend are not built yet — Phase 2 only proves the pipeline itself.

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

**Terminal 3 — manual integration test:**
```bash
# Upload an image (returns the created row, including its id)
curl -X POST -F "image=@/path/to/photo.jpg" http://localhost:3000/api/images

# Display it on the matrix (use the id from the upload response)
curl -X POST http://localhost:3000/api/images/1/display
```
Confirm in the browser that the photo appears center-cropped to a square and resized to 128x128 (never stretched).

**Restart proof (the reason SQLite is in the stack):** stop the backend (Ctrl+C in terminal 2), start it again (`npm start`), then without touching terminal 1 or re-uploading:
```bash
curl http://localhost:3000/api/images
curl -X POST http://localhost:3000/api/images/1/display
```
Both should still work — the row survived the restart and the image displays again.

**Status check** at any point:
```bash
curl http://localhost:3000/api/status
```
Reports renderer connection state, DB connection state, and row counts per table.

## C++ renderer

`renderer/src/main.cpp` compiles cleanly against `rpi-rgb-led-matrix` (`cd renderer && make`) and implements the identical socket protocol, but it is **unverified** — it has not run against real HUB75 panels because the hardware hasn't arrived yet. It is the Phase 6 target; `renderer_emulator.py` is the active renderer until then.