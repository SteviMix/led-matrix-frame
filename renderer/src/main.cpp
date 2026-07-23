// LED matrix renderer: reads raw RGB frames from a Unix domain socket and
// draws them onto a Raspberry Pi RGB LED matrix using rpi-rgb-led-matrix.
//
// Frame format: 128 * 128 * 3 = 49152 bytes, row-major, no header.

#include "led-matrix.h"

#include <arpa/inet.h>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

using rgb_matrix::Canvas;
using rgb_matrix::FrameCanvas;
using rgb_matrix::RGBMatrix;

namespace {

constexpr const char *kSocketPath = "/tmp/ledframe.sock";
constexpr int kMatrixRows = 64;
constexpr int kMatrixCols = 128;
constexpr int kChainLength = 2;
constexpr int kWidth = 128;
constexpr int kHeight = 128;
constexpr size_t kFrameBytes = static_cast<size_t>(kWidth) * kHeight * 3;

volatile sig_atomic_t g_running = 1;
int g_server_fd = -1;

void HandleSigint(int) {
  g_running = 0;
}

// Reads exactly `count` bytes from `fd` into `buf`, looping over partial
// reads. Returns true on success, false on EOF (client disconnected) or
// error, or if interrupted by shutdown.
bool ReadFull(int fd, uint8_t *buf, size_t count) {
  size_t total_read = 0;
  while (total_read < count) {
    ssize_t n = read(fd, buf + total_read, count - total_read);
    if (n > 0) {
      total_read += static_cast<size_t>(n);
      continue;
    }
    if (n == 0) {
      // Client closed the connection.
      return false;
    }
    if (errno == EINTR) {
      if (!g_running) return false;
      continue;
    }
    // Real error.
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char *argv[]) {
  signal(SIGINT, HandleSigint);
  signal(SIGTERM, HandleSigint);

  RGBMatrix::Options matrix_options;
  matrix_options.rows = kMatrixRows;
  matrix_options.cols = kMatrixCols;
  matrix_options.chain_length = kChainLength;
  matrix_options.hardware_mapping = "regular";

  rgb_matrix::RuntimeOptions runtime_options;

  RGBMatrix *matrix = rgb_matrix::CreateMatrixFromOptions(matrix_options, runtime_options);
  if (matrix == nullptr) {
    fprintf(stderr, "Failed to initialize RGB matrix.\n");
    return 1;
  }

  FrameCanvas *offscreen = matrix->CreateFrameCanvas();

  // Remove a stale socket file from a previous run before binding.
  unlink(kSocketPath);

  g_server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (g_server_fd < 0) {
    perror("socket");
    delete matrix;
    return 1;
  }

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  strncpy(addr.sun_path, kSocketPath, sizeof(addr.sun_path) - 1);

  if (bind(g_server_fd, reinterpret_cast<struct sockaddr *>(&addr), sizeof(addr)) < 0) {
    perror("bind");
    close(g_server_fd);
    delete matrix;
    return 1;
  }

  if (listen(g_server_fd, 1) < 0) {
    perror("listen");
    close(g_server_fd);
    unlink(kSocketPath);
    delete matrix;
    return 1;
  }

  fprintf(stderr, "Listening on %s (%dx%d)\n", kSocketPath, kWidth, kHeight);

  uint8_t *frame_buf = new uint8_t[kFrameBytes];

  while (g_running) {
    int client_fd = accept(g_server_fd, nullptr, nullptr);
    if (client_fd < 0) {
      if (errno == EINTR) continue;
      if (!g_running) break;
      perror("accept");
      continue;
    }

    fprintf(stderr, "Client connected.\n");

    // Serve frames from this client until it disconnects or we shut down.
    while (g_running) {
      if (!ReadFull(client_fd, frame_buf, kFrameBytes)) {
        break;
      }

      size_t offset = 0;
      for (int y = 0; y < kHeight; ++y) {
        for (int x = 0; x < kWidth; ++x) {
          uint8_t r = frame_buf[offset];
          uint8_t g = frame_buf[offset + 1];
          uint8_t b = frame_buf[offset + 2];
          offset += 3;
          offscreen->SetPixel(x, y, r, g, b);
        }
      }

      offscreen = matrix->SwapOnVSync(offscreen);
    }

    fprintf(stderr, "Client disconnected.\n");
    close(client_fd);
  }

  delete[] frame_buf;

  matrix->Clear();
  delete matrix;

  close(g_server_fd);
  unlink(kSocketPath);

  fprintf(stderr, "Shutdown complete.\n");
  return 0;
}
