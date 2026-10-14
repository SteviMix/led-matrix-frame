FROM node:20-bookworm-slim

# Python and image-processing libraries (OpenCV, numpy, Pillow, scikit-learn),
# plus build tools for compiling better-sqlite3 if no prebuilt binary is available
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-numpy python3-opencv python3-pil python3-sklearn \
      make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached when only source code changes
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev

# Copy the rest of the code, keeping the repo's folder layout
COPY backend/ backend/
COPY scripts/ scripts/
COPY images/ images/

WORKDIR /app/backend
EXPOSE 3000
CMD ["npm", "start"]