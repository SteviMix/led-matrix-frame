#!/usr/bin/env python3
"""LED matrix renderer (emulator stand-in).

Reads raw RGB frames from a Unix domain socket and draws them onto the
RGBMatrixEmulator (browser view) instead of real hardware. Protocol matches
renderer/src/main.cpp exactly, so this is a drop-in replacement while the
physical panels are not yet available. emulator_config.json in the project
root is picked up automatically by RGBMatrixEmulator.

Frame format: 128 * 128 * 3 = 49152 bytes, row-major, no header.
"""

import os
import signal
import socket

from PIL import Image
from RGBMatrixEmulator import RGBMatrix, RGBMatrixOptions

SOCKET_PATH = "/tmp/ledframe.sock"
WIDTH = 128
HEIGHT = 128
FRAME_BYTES = WIDTH * HEIGHT * 3

running = True


def handle_sigint(signum, frame):
    global running
    running = False


def recv_full(conn, count):
    """Read exactly `count` bytes from `conn`, looping over partial recv()s.

    Returns the collected bytes, or None on client disconnect / shutdown.
    """
    buf = bytearray(count)
    view = memoryview(buf)
    received = 0
    while received < count:
        if not running:
            return None
        try:
            n = conn.recv_into(view[received:], count - received)
        except InterruptedError:
            continue
        except OSError:
            return None
        if n == 0:
            # Client closed the connection.
            return None
        received += n
    return buf


def main():
    signal.signal(signal.SIGINT, handle_sigint)
    signal.signal(signal.SIGTERM, handle_sigint)

    options = RGBMatrixOptions()
    options.rows = 64
    options.cols = 128
    options.chain_length = 1
    options.parallel = 2

    matrix = RGBMatrix(options=options)
    canvas = matrix.CreateFrameCanvas()

    # Remove a stale socket file from a previous run before binding.
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(1)

    print(f"[renderer_emulator] Listening on {SOCKET_PATH} ({WIDTH}x{HEIGHT})")

    try:
        while running:
            server.settimeout(1.0)
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break

            print("[renderer_emulator] Client connected.")
            conn.settimeout(None)

            # Serve frames from this client until it disconnects or we shut down.
            while running:
                frame = recv_full(conn, FRAME_BYTES)
                if frame is None:
                    break

                image = Image.frombuffer("RGB", (WIDTH, HEIGHT), bytes(frame), "raw", "RGB", 0, 1)
                canvas.SetImage(image)
                canvas = matrix.SwapOnVSync(canvas)

            print("[renderer_emulator] Client disconnected.")
            conn.close()
    except KeyboardInterrupt:
        pass
    finally:
        matrix.Clear()
        server.close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
        print("[renderer_emulator] Shutdown complete.")


if __name__ == "__main__":
    main()
