#!/usr/bin/env python3
"""Test client for the LED matrix renderer.

Connects to /tmp/ledframe.sock and streams an animated gradient pattern,
using the exact same wire protocol the real backend will use: raw RGB
bytes, 128*128*3 = 49152 bytes per frame, row-major, no header, sent
back-to-back on one persistent connection.

Use this to visually confirm a renderer (C++ or the Python emulator
stand-in) is receiving and drawing frames correctly.
"""

import socket
import time

SOCKET_PATH = "/tmp/ledframe.sock"
WIDTH = 128
HEIGHT = 128


def build_frame(offset):
    """Builds one 49152-byte row-major RGB frame: a shifting gradient."""
    row = bytearray(WIDTH * 3)
    frame = bytearray(WIDTH * HEIGHT * 3)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            i = x * 3
            row[i] = (x * 2 + offset) % 256
            row[i + 1] = (y * 2 + offset) % 256
            row[i + 2] = 128
        frame[y * WIDTH * 3:(y + 1) * WIDTH * 3] = row
    return bytes(frame)


def main():
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(SOCKET_PATH)
    print(f"Connected to {SOCKET_PATH}. Streaming test pattern, Ctrl+C to stop.")

    offset = 0
    try:
        while True:
            sock.sendall(build_frame(offset))
            offset = (offset + 4) % 256
            time.sleep(0.05)
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()
        print("Disconnected.")


if __name__ == "__main__":
    main()
