# LED Matrix Digital Frame

A custom digital photo frame built on Raspberry Pi, driving HUB75 LED matrix panels. Designed as a gift, it runs fully offline as a local Wi-Fi access point and offers three interactive modes controlled from any phone or laptop on the network.

## Features

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

Work in progress.

## Manual integration test (Phase 2)

Proves the full chain: HTTP upload → Python image processing → SQLite → renderer socket → emulator display, and that state survives a backend restart.

**Terminal 1 — renderer:**
```bash
cd ~/led-frame
python3 renderer/renderer_emulator.py
```

**Terminal 2 — backend:**
```bash
cd ~/led-frame/backend
npm start
```

**Terminal 3 — drive the test:**
```bash
# Upload an image (returns the created row, including its id)
curl -X POST -F "image=@/path/to/photo.jpg" http://localhost:3000/api/images

# Display it on the matrix (use the id from the upload response)
curl -X POST http://localhost:3000/api/images/1/display
```

Open `http://ledframe.local:8888` and confirm the uploaded photo appears, center-cropped to a square and resized to 128x128 (not stretched).

**Now restart the backend** (Ctrl+C in terminal 2, then `npm start` again) and re-run, without touching terminal 1 or re-uploading:
```bash
curl http://localhost:3000/api/images
curl -X POST http://localhost:3000/api/images/1/display
```

Both should still work — the row is still there and the image displays again. This is the point of the test: it proves state survives a restart, which is the whole reason SQLite is in the stack.
