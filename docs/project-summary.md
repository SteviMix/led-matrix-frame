# LED Matrix Digital Frame — Project Summary

> Paste-ready summary of current state and next steps. Reflects only the CURRENT plan
> (outdated/changed decisions are omitted).

---

## Project Overview

A custom digital photo frame built as a gift, running on a Raspberry Pi 4 with LED matrix panels.
Also serves as a learning project (embedded/hardware + full-stack) and a GitHub portfolio piece for CV.

**Three modes:**
1. **Slideshow** — upload photos with an adjustable crop/pan selector, organize into playlists, display with dithering.
2. **Live drawing** — draw in real time from a phone/laptop; strokes appear instantly on the matrix via WebSocket.
3. **Paint-by-number** — upload an image; the Pi processes it into a color-mapped block grid. As the user colors each block, the panel reveals the original image's true shades. Result can be saved as pixel-art or full-res image.

Runs fully **offline** as a local Wi-Fi access point.

---

## Hardware (current plan)

| Item | Status | Notes |
|---|---|---|
| Raspberry Pi 4, 4GB | Purchased, set up | The compute core |
| Argon NEO case | Purchased | Used as heatsink; may not fully close with Bonnet (GPIO clearance) — test when panels arrive. Pi runs cool (~45°C) even without it |
| 2x EVERSHINE P2 panels | Ordered (AliExpress) | 128x64 px each, 256x128mm, SMD1515, 1/32 scan, ICN2037-type driver. Stacked vertically = **128x128 px total** |
| 6358 Triple LED Matrix Bonnet (Adafruit clone) | Ordered (AliExpress) | Physical Addr E switch (no soldering for E-line) |
| HUB75 IDC cables (20/30/40cm) | Ordered (AliExpress) | For Bonnet->panel and panel->panel |
| Mean Well 5V PSU (LRS-100-5 18A ~2978 RSD, or LRS-150F-5 22A ~4039 RSD) | Not purchased | For panels only. Low-profile 30mm fits tight frame. Decision pending (100-5 cheaper, 150F more headroom) |
| USB-C power supply 5.1V/3A | Purchased | For Pi only (separate from panel PSU) |
| microSD card reader | Purchased | For flashing/re-flashing from Mac |
| IKEA Sannahed frame, MDF, screws, VHB tape, wires, button | Buy locally at assembly | Universal parts — bought on-site in the other city |

### Key hardware facts
- **Final resolution: 128x128 px** (2 panels of 128x64, stacked vertically). Panel geometry config is **UNRESOLVED** — see "Panel geometry: chain vs parallel vs pixel-mapper" under Phase 6 below. Current emulator code uses `rows=64, cols=128, chain_length=1, parallel=2`, which is a placeholder, not a verified setting.
- **Power: two separate supplies** — Pi via its own USB-C charger, panels via Mean Well PSU. The Bonnet only passes signal + receives 5V for the panels; panel current never flows through the Pi. Both plug into one wall outlet via a small power strip inside the frame.
- **Panels are SMD (not GOB)** — protected in the final build by the frame's tinted glass; handle carefully during assembly (work from the back, on soft foam, never face-down on hard surface).
- **HDMI screen remains a documented fallback** if HUB75/scan issues prove unsolvable, but the current direction is the real LED matrix.
- **Thermals:** Pi 4 throttles at 80°C and shuts down at 85°C — 60°C under load is fine, not a problem. Check live with `vcgencmd measure_temp`; check whether throttling has occurred with `vcgencmd get_throttled` (`0x0` = all clear). Temperatures near 60°C during development are expected while compiling (hzeller lib, better-sqlite3 native build) and running processes.

### Installing the Argon NEO case — ALWAYS POWER DOWN FIRST
Never fit or remove the case, the Bonnet, or anything on the GPIO header while the Pi is running.

1. `sudo shutdown -h now`
2. Wait for the green activity LED to stop blinking (~10-15s)
3. **Unplug the power from the wall** — the board stays energised until you do
4. Ground yourself (touch something metal) before handling; hold the board by its edges

Reasons: pulling power mid-write can corrupt the SD card, and the GPIO pins are live while
running — static discharge or an accidental short against the metal case can kill the Pi.

When fitting: make sure the thermal pad/paste makes proper contact between the SoC and the
case. The Argon NEO cools by conducting heat into its body — without that contact it is just
a box. Expect roughly a 10-15°C drop once fitted.

**Open question (Bonnet clearance):** the Bonnet sits on the GPIO header and protrudes upward,
so the NEO's lid may not close over it. Three possible outcomes: (a) it closes — ideal;
(b) run without the upper lid — the lower half is the actual heatsink and still works;
(c) it doesn't fit at all — needs another solution. **The case can and should be fitted now**
regardless; test the fit when the Bonnet arrives, and remove the lid if needed. Nothing is lost
by installing it early.

### Assembly / logistics
- Everything is assembled in a **different city** (where panels ship to). Pi and its parts are carried there from Belgrade.
- Finished frame is transported **by car** (upright, wrapped, cushioned) — not by bus, to protect it.
- **Do software work in Belgrade first** (against the emulator, while internet is available), so only hardware + physical assembly remain for the other city.

---

## Tech Stack

- **Backend:** Node.js (Express + WebSocket) — strong at real-time WebSocket, single JS language across stack
- **Low-level render:** C++ with hzeller/rpi-rgb-led-matrix library; talks to backend via Unix socket
- **Image processing:** Python (OpenCV, scikit-learn K-means) — for paint-by-number

**DECISION — Python owns ALL image processing, not just paint-by-number.** Node never decodes,
resizes, crops, or dithers an image; it spawns a Python script and passes file paths. Reasons:
(a) the paint-by-number reveal effect must read pixels from the full-res original and stay
consistent with the K-means palette — splitting that across two languages invites subtle
mismatches; (b) dithering and LAB quantisation are the same class of problem and belong in one
place; (c) `sharp` in Node would leave Python unused until Phase 3 anyway. Cost: ~100-200ms
process-spawn overhead per call, which is irrelevant because image processing happens once per
upload, never per frame.
- **Database:** SQLite (single file, no server)
- **Frontend:** Angular (deliberately chosen to learn structured/TypeScript-disciplined code, different from the Vue already known from university)
- **Networking:** hostapd — Pi becomes its own offline Wi-Fi AP for the final gift

---

## Phase 1 — COMPLETE (development environment)

All done on the Pi, confirmed working:
- Raspberry Pi OS Lite (64-bit) flashed with SSH + Wi-Fi + hostname (`ledframe`) for headless access
- Connected via SSH (`ssh pi@ledframe.local`) and via VS Code Remote-SSH (opens `/home/pi/led-frame`)
- System updated
- Installed: Node.js v20.20.2, Python3 + OpenCV/numpy/scikit-learn/Pillow, git, build-essential, cmake, sqlite3
- Cloned + compiled `hzeller/rpi-rgb-led-matrix`
- Installed `RGBMatrixEmulator` — **confirmed working**: 128x128 gradient test rendered and viewed in browser at `http://ledframe.local:8888`
- GitHub repo live: **https://github.com/SteviMix/led-matrix-frame** (public), first commit pushed, git configured with noreply email
- Convention: all code/comments/commits in English; commit after each phase

---

## Architecture (Phase 2 — about to start)

Three cooperating components:

```
Phone/Laptop (Angular, later)
      | HTTP / WebSocket
      v
Node.js backend  <-- reads/writes -->  SQLite database
      | Unix socket
      v
C++ renderer  -->  LED matrix (emulator now, real panels later)
```

- **C++ renderer** = only process that writes to the matrix; receives frame buffers via Unix socket. Must be fast and the sole writer.
- **Node.js backend** = the brain; handles network requests, DB, and sends frames to the renderer.
- **SQLite** = memory; everything must survive power-off (which images exist, current mode, paint-by-number progress).

### Database schema (4 tables)

**playlists** — image collections
- id, name, sort_order, created_at

**images** — all images (uploaded, drawn, or paint-by-number output)
- id, playlist_id, original_path, processed_path, crop_x/y/w/h, source ('upload'|'draw'|'paint-by-number'), sort_order, created_at

**pbn_sessions** — paint-by-number state
- id, full_res_path (for reveal effect), pixel_art_path, grid_width, grid_height, palette_json, block_colors_json, progress_json, completed

**app_state** — global state (key/value)
- e.g. current_mode='slideshow', active_playlist='2'

**Note:** actual image files live on disk (e.g. `~/led-frame/images/`), NOT in the DB. The DB stores paths + metadata only. All processed image dimensions are **128x128**.

---

## Phase 2 — COMPLETE (architecture)

All five steps done, merged to `main` via PR "Phase 2: renderer, backend, database":

1. ✅ Project folder structure (`backend/`, `renderer/`, `images/original/`, `images/processed/`, `scripts/`)
2. ✅ C++ renderer (`renderer/src/main.cpp` + Makefile) — Unix socket -> HUB75. Compiles cleanly;
   **runtime unverified** until real panels arrive (see Phase 6 notes on the sound module and
   panel geometry)
3. ✅ Python emulator renderer (`renderer/renderer_emulator.py`) — identical wire protocol, draws
   to RGBMatrixEmulator. This is the active renderer during development. Two independent
   implementations on one protocol proved the interface is clean
4. ✅ Node.js backend — Express, reconnecting Unix socket client with drop-on-backpressure
   (`backend/src/renderer-client.js`), Python spawn wrapper (`backend/src/image-processor.js`)
5. ✅ SQLite (`backend/src/db/`) — 4 tables, WAL, foreign keys on, seeded `app_state`
6. ✅ Python image processing (`scripts/process_image.py`) — center-crop + resize to raw
   49152-byte RGB
7. ✅ Integration test passing end to end: upload -> Python -> SQLite -> Node -> Unix socket ->
   renderer -> emulator, with state surviving a backend restart

**Wire protocol (fixed, do not change):** raw RGB, 128*128*3 = 49152 bytes, row-major, no header,
no length prefix. Identical across C++, Python, and Node. Pixel (x, y) starts at byte offset
`(y * 128 + x) * 3`.

**Hardware note:** Pi is now in the Argon NEO case. Temperature dropped from ~60°C to ~38-47°C.

---

## Phase 3 part 1 — COMPLETE (mode manager + slideshow)

Merged to `main` via PR "Phase 3 part 1: mode management and slideshow" (branch `phase-3/slideshow`,
deleted after merge). Delivered:

- **Mode manager** (`backend/src/modes/mode-manager.js`) — tracks the active mode
  (`slideshow`/`draw`/`paint-by-number`/`idle`), enforces that switching always fully stops the
  previous mode (`await stop()`) before starting the next, persists `current_mode` to
  `app_state`, and resumes it on backend startup (falling back to `idle` if the stored mode has
  no implementation registered yet, so an old value can never crash startup).
- **Slideshow mode** (`backend/src/modes/slideshow.js`) — `setTimeout`-recursion timer (not
  `setInterval`, so manual `next()`/`previous()` can cleanly reset the schedule), reads the
  active playlist and interval from `app_state` on every tick (not cached), and handles empty
  playlist / missing file / disconnected renderer by logging and skipping — never throws, since
  a timer tick has no request to report an error to.
- **Playlist CRUD + image assignment** (`backend/src/routes/playlists.js`,
  extended `routes/images.js`) — `images.playlist_id` changed from `ON DELETE CASCADE` to
  `ON DELETE SET NULL`: deleting a playlist orphans its images (and never touches files on
  disk), since an image can exist outside any playlist.
- **Crop re-processing** (`POST /api/images/:id/crop`) — re-runs `process_image.py` on the
  original file with a new crop rectangle, overwrites `processed_path` only. `original_path` is
  never modified.
- **Floyd–Steinberg dithering** in `process_image.py`, on by default, applied after resize.

**Bug caught during manual testing, not by review:** the first version of backend shutdown
called `modeManager.switchMode("idle")` to stop timers cleanly on SIGINT — which also persisted
`current_mode = 'idle'` to `app_state`, silently defeating the resume-on-restart feature every
single time the backend shut down normally. Fixed by adding a separate `modeManager.shutdown()`
that stops the current instance without persisting a mode change. Caught by actually restarting
the backend and checking `/api/status`, not by reading the code.

**Performance note:** the first Floyd–Steinberg implementation used numpy scalar indexing
(`img[y, x]`) in the pixel loop and took ~1.5s for a 128x128 image — each numpy element access
carries array-object overhead that a plain Python list lookup doesn't. Converting to
`.tolist()` and working in plain Python lists dropped this to ~0.17s (about 9x).

**Renderer logging bug found in passing (Phase 2 code):** `renderer_emulator.py`'s status
`print()` calls had no `flush=True`, so they sat in Python's stdout buffer indefinitely
whenever stdout wasn't a TTY (i.e. always, in this project's `nohup`/redirected dev workflow) -
making the "only visibility during development" logging promised in Phase 2 silently useless.
Fixed.

## Remaining Phase 3 parts

1. **`phase-3/live-draw`** — WebSocket canvas, delta pixel protocol, in-memory canvas buffer
2. **`phase-3/paint-by-number`** — K-means, block-reveal, dual-save (hardest of the three)

**Order rationale:** slideshow was closest to what already worked (send an image to the
renderer), so it extended proven ground. Paint-by-number is hardest and goes last.

**State split principle (applies to all modes):** memory for state that changes every frame,
database for state that must survive a restart. Drawing strokes stay in an in-memory Buffer;
only the finished image is written to SQLite. Same rule later for games — ball position in
memory, match result in the database.

---

## Remaining Roadmap (after Phase 2)

- **Phase 3 — Three modes:** Slideshow (crop/pan, dithering, playlists), Live Draw (WebSocket canvas, delta pixel protocol), Paint-by-Number (K-means, block-reveal, dual-save — start in RGB, switch to LAB later; see Future Improvements), Read-only viewer (see definition below)

#### DEFINITION — Read-only viewer
Previously an undefined one-line item; now specified. It serves two purposes:

**(b) Screen mirror.** A page showing what is currently on the matrix, live, in a browser.
Useful for showing the frame's content to someone not in the room, and for debugging during
development.

**(c) Protection from accidental damage.** The frame runs as an open offline Wi-Fi AP, so
anyone who connects currently has full control — they could delete a playlist, switch modes,
or interrupt someone else's drawing session. The viewer is the safe default surface.

**What it shows:** current matrix contents, active mode, active playlist, position in playlist.
**What it has:** no controls whatsoever — no upload, delete, mode switching, or start/stop.

**Implementation notes:**
- `GET /api/current-frame` -> returns the last frame sent to the renderer as a PNG. Conversion
  is done in Python, consistent with the rule that Node never touches image data.
- `GET /api/status` already exists; extend it with mode and playlist position.
- Polling every 1-2s is sufficient — no WebSocket needed. Slideshow content changes every ~10s
  anyway.
- Access separation without authentication: viewer at `/`, controls at `/admin`. Not real
  security, but adequate for an offline frame in someone's home.

**Prerequisite (do now, in Phase 3):** the backend must keep the last frame sent to the renderer
in memory. It is one variable, and it is needed for both the viewer and for debugging.

**When to build:** Phase 4, alongside the Angular frontend. Building an HTML page for it now
would mean throwing that page away.
- **Phase 4 — Angular frontend** connected to backend
- **Phase 5 — hostapd** offline AP setup + test from phone/laptop
- **Phase 6 — Hardware** (when panels arrive): switch emulator -> real HUB75, resolve panel geometry (see note below), solve scan/multiplexing (try --led-multiplexing 0-17, focus Z-Stripe), calibration, shutdown button

#### KNOWN ISSUE — Pi sound module blocks the C++ renderer (already hit in Phase 2)
Running `sudo ./renderer` fails at startup with:
`snd_bcm2835: found that the Pi sound module is loaded ... Exiting; fix the above first`

The hzeller library uses the Pi's hardware PWM for precise timing; the built-in sound module
(`snd_bcm2835`) claims the same hardware. The library refuses to start rather than produce an
unstable, flickering display. **This is not a bug in the project code** — it was hit in Phase 2
with a clean build, and is irrelevant until real panels exist.

Two fixes:
1. `--led-no-hardware-pulse` — works immediately, but noticeably more flicker
2. **Blacklist the sound module and reboot** — the proper fix, use this for the final gift

Also worth applying for the final build: add `isolcpus=3` to `/boot/cmdline.txt` (the library
suggests this on startup). It reserves one CPU core for panel refresh and measurably reduces
flicker.

#### OPEN QUESTION — Panel geometry: chain vs parallel vs pixel-mapper
The emulator accepts any of these and will happily show 128x128, so **this cannot be verified
until the real panels and Bonnet are in hand.** Do not trust the current setting.

- `chain_length` = panels daisy-chained off **one** HUB75 output. Chaining extends the canvas
  **horizontally**: 2x (128x64) chained = 256x64, NOT 128x128.
- `parallel` = **physically separate** HUB75 outputs on the board, driven simultaneously. This
  is a hardware property, not a layout choice — it only works if the Bonnet actually exposes
  multiple output connectors.
- `pixel_mapper_config = "U-mapper"` = takes a physical horizontal chain and logically folds it
  so code can address it as a taller, narrower canvas. Combined with `chain_length=2` this turns
  a 256x64 physical chain into a 128x128 logical canvas.

**What the wiring plan implies:** the ordered parts (Bonnet -> panel cables *and* panel -> panel
cables) describe a single daisy chain. That points to `chain_length=2, parallel=1` plus
`U-mapper` as the likely correct config — NOT `parallel=2`.

**Must check when hardware arrives:**
1. How many HUB75 output connectors does the "6358 Triple LED Matrix Bonnet" actually have?
   ("Triple" in the product name may refer to something other than three outputs.)
2. If one output -> use `chain_length=2, parallel=1` + `U-mapper` (try `U-mapper` and
   `U-mapper;Rotate:180` — which one is correct depends on cable routing between the panels).
3. If two or more outputs -> `parallel=2` becomes viable, with one cable per panel.
4. Verify orientation with a test pattern that is asymmetric top-to-bottom (e.g. a number or
   arrow), not a symmetric gradient — a gradient will look plausible even when folded wrong.

Whichever config wins, it changes **only** the renderer's matrix options. The Unix socket
protocol (49152 raw RGB bytes, 128x128 logical canvas) stays identical, so the backend, the
database, and all three modes are unaffected.

**Note (Phase 2 finding):** the emulator side of this was already tested with
`chain_length=1, parallel=2` (panel below panel) and confirmed to render 128x128 correctly in
`RGBMatrixEmulator` — but the emulator has no concept of real HUB75 output connectors, so this
only proves the *math*, not the real wiring. Treat it as a placeholder, per the open question above.

#### DESIGN NOTE — Dithering (Phase 3, slideshow mode)
**The problem:** LED panels do not have full 8-bit-per-channel depth in practice. Each extra bit
of colour depth doubles the BCM refresh cycle, so the hzeller library trades depth for refresh
rate (default 11 bits, often dropped to 8 or lower to reduce flicker). Combined with the small
128x128 canvas — too few pixels to hide transitions — smooth gradients turn into visible
**banding**: hard stripes instead of a smooth ramp.

**The fix:** dithering deliberately adds noise. Instead of rendering a region as one flat
quantised value, it mixes pixels of the two nearest available values in a ratio matching the
true value. The eye blends them at viewing distance into a shade the panel cannot physically
produce. Same trick as halftone printing — black dots on white paper read as grey.

**Two methods:**
- **Floyd–Steinberg (error diffusion)** — rounding each pixel to the nearest available colour
  produces an error; that error is pushed onto neighbouring not-yet-processed pixels by fixed
  weights, so it spreads across the image rather than accumulating. Organic, natural-looking
  result. Downside: the noise is not stable frame-to-frame, so it "shimmers" on animation.
- **Ordered (Bayer) dithering** — compares each pixel against a fixed threshold matrix indexed
  by pixel position. Produces a visible cross-hatch pattern (retro/old-games look), but is
  **deterministic**: identical input always gives identical output, so no shimmer on animation.

**Choice for this project:** Floyd–Steinberg for slideshow (static images, natural look is
preferred). Ordered dithering only if something animated ever needs quantising, where the
frame-to-frame stability matters more than the look.

**Implementation:** belongs in the Python image-processing layer alongside the crop/resize step,
not in the renderer. The renderer stays dumb — it receives finished 49152-byte frames and draws
them. This also keeps dithering consistent with the LAB K-means work in Future Improvements,
since both are colour-quantisation concerns handled in the same place.
- **Phase 7 — Assembly** into IKEA frame, transport by car

#### Thermal check in the assembled frame
Bench temperatures are not representative of the finished build. Inside the sealed IKEA
Sannahed frame the Pi shares a small enclosed volume with the panels, the Mean Well PSU, and
the cabling — no airflow, and the panels generate their own heat. Measure `vcgencmd measure_temp`
and `vcgencmd get_throttled` **with the frame fully assembled and running for at least 30
minutes**, not just on the desk. If it approaches 80°C, options are: passive vents in the MDF
backing, repositioning the Pi away from the PSU, or a small low-noise fan.
- **Bonus — Games/Multiplayer:** LED matrix = shared screen, phones = controllers via WebSocket (simple since only one display). Order: single-player game (learn game loop) -> collaborative drawing -> competitive 1v1 (e.g. Pong)

---

## Future Improvements (nice-to-have, not blocking)

### LAB color space for paint-by-number K-means
Cluster pixels in **LAB color space** instead of RGB when building the paint-by-number
palette. Distances in LAB approximate how different two colors *look* to the human eye,
whereas RGB distance does not — so LAB produces more natural palettes, which matters most
at low resolution (128x128) with a limited number of colors. This is a near-pure upgrade:
same algorithm, same scikit-learn K-means, same pipeline — only a color-space conversion
before clustering and back after.

**Approach (MVP-first):** build the pipeline with plain RGB K-means so the whole flow works
end-to-end, then flip to LAB as a polish step once the visual output is being tuned. The
conversion is a one-time image-processing cost (not real-time render), so it's negligible
even on the Pi.

**Sketch:**
```python
# Convert to LAB before clustering (this is the whole point)
work = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2LAB)
pixels = work.reshape(-1, 3).astype(np.float32)

kmeans = KMeans(n_clusters=n_colors, n_init=10, random_state=42)
labels = kmeans.fit_predict(pixels)
centers = kmeans.cluster_centers_.astype(np.uint8)

quantized = centers[labels].reshape(img_rgb.shape)
quantized = cv2.cvtColor(quantized, cv2.COLOR_LAB2RGB)      # image back to RGB
palette   = cv2.cvtColor(centers.reshape(1, -1, 3),          # palette back to RGB
                         cv2.COLOR_LAB2RGB).reshape(-1, 3)
```
Only difference vs the RGB version is one `if` deciding whether to cluster in RGB or LAB;
the rest is identical.

### Other ideas considered (lower priority)
- **Auto-choosing palette size** (elbow / silhouette score) — nice ML-adjacent exercise, but
  a user-facing "number of colors" slider is probably enough for a gift.
- **Alternative quantization** (median cut via `Pillow.quantize()`, octree) — classic image
  processing, worth comparing but drifts away from ML.
- **Semantic segmentation** (DeepLab / SAM) for region-based blocks — the only option that is
  "real" deep learning, but models are large/slow and don't fit the offline Pi 4 scenario.
  If pursued, run it **offline on a laptop as a separate experiment**, not on the Pi.

---

## Working Principles

- **This file lives in the repo at `docs/project-summary.md` and is the single source of truth.**
  Update it there; do not maintain parallel copies elsewhere.
- Build against the emulator first — no physical panels needed until Phase 6
- Install ALL dependencies now while online — the final gift is offline and can't download later
- Emulator stays installed at the end (for debugging); switching to real hardware is just a config/flag change
- Commit after each phase for a clean portfolio history. In practice: small commits inside a
  branch, one branch per logical unit, merged via PR with a written description. Merge commits
  (not squash) so phase boundaries stay visible on `main`
- Learning project — explanations stay step-by-step, not just commands to copy

### Build photos (`docs/images/`)
Worth photographing as the hardware arrives — for a portfolio repo, proof that the project became
a physical object matters as much as the code:
- Pi in the case before closing it
- Bonnet seated on the GPIO header (also answers the clearance question)
- Panel-to-panel wiring (directly relevant to the `chain_length` vs `parallel` question — a photo
  of the cabling shows how the chain is physically wired)
- First test pattern on real panels
- Assembly into the frame; final result lit, ideally in low light

Technical: LED panels blow out camera exposure. Shoot with panel brightness turned down
(`--led-brightness`), in a darkened room, lowering exposure manually if the phone allows.

**Privacy:** this repo is public and the frame is a gift. Do not commit photos showing the
recipient, their home, faces, or any of the personal photos destined for the slideshow. Hardware
and neutral test patterns only. Compress to ~1200px wide before committing — git keeps every
version forever.
