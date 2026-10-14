FROM python:3.11-slim

WORKDIR /app

# Emulator that renders the LED matrix in a browser instead of real HUB75 panels
RUN pip install --no-cache-dir RGBMatrixEmulator

COPY renderer/ renderer/

# Browser view of the matrix
EXPOSE 8888

# Run from /app, same as running from the repo root on the Pi
CMD ["python3", "renderer/renderer_emulator.py"]