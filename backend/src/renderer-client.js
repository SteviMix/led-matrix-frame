// Owns the Unix domain socket connection to the LED matrix renderer process.
// This is the only file in the backend that knows about the socket or the
// wire format: raw RGB bytes, 128*128*3 = 49152 bytes per frame, row-major,
// no header, no length prefix, written back-to-back on one persistent
// connection.

const net = require("net");

const SOCKET_PATH = "/tmp/ledframe.sock";
const RECONNECT_INTERVAL_MS = 2000;
const FRAME_BYTES = 128 * 128 * 3;

function createRendererClient() {
  let socket = null;
  let connected = false;
  let lastWriteOk = true; // false when the previous write reported backpressure
  let reconnectTimer = null;
  let closing = false;

  function scheduleReconnect() {
    if (reconnectTimer || closing) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_INTERVAL_MS);
  }

  function connect() {
    if (socket) return; // already connecting/connected

    const s = net.createConnection({ path: SOCKET_PATH });

    // Required: an unhandled 'error' event would crash the process.
    s.on("error", (err) => {
      console.log(`[renderer-client] Connection error: ${err.message}`);
    });

    s.on("connect", () => {
      connected = true;
      lastWriteOk = true;
      console.log("[renderer-client] Connected to renderer.");
    });

    // Fires once the kernel has drained the previous write - only then are
    // we allowed to send another frame instead of dropping it.
    s.on("drain", () => {
      lastWriteOk = true;
    });

    s.on("close", () => {
      const wasConnected = connected;
      socket = null;
      connected = false;
      if (wasConnected) {
        console.log("[renderer-client] Disconnected from renderer.");
      }
      console.log(`[renderer-client] Retrying in ${RECONNECT_INTERVAL_MS}ms...`);
      scheduleReconnect();
    });

    socket = s;
  }

  function isConnected() {
    return connected;
  }

  // Stops reconnect attempts and tears down the socket. Used on shutdown.
  function close() {
    closing = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.destroy();
      socket = null;
    }
    connected = false;
  }

  // Sends one frame. Returns false (without throwing) if not connected or
  // if the socket is still draining the previous frame's write buffer -
  // dropping a frame is preferable to queueing and building up latency.
  function sendFrame(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length !== FRAME_BYTES) {
      throw new Error(
        `sendFrame expects a Buffer of exactly ${FRAME_BYTES} bytes, got ${
          Buffer.isBuffer(buffer) ? buffer.length : typeof buffer
        }`
      );
    }

    if (!connected || !socket) {
      return false;
    }

    if (!lastWriteOk) {
      // Previous frame is still draining - drop this one instead of queueing.
      return false;
    }

    lastWriteOk = socket.write(buffer);
    return true;
  }

  connect();

  return {
    sendFrame,
    isConnected,
    close,
  };
}

module.exports = { createRendererClient, FRAME_BYTES };
