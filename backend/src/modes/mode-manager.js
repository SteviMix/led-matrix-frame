// Central authority for which mode (slideshow / draw / paint-by-number / idle)
// is currently allowed to write to the renderer. Only one mode may run at a
// time - switching always fully stops the previous mode before starting the
// next, so a leaked timer from a stopped mode can never keep pushing frames.
//
// Every mode implements the same interface: start(), stop(), getState().

const VALID_MODES = ["slideshow", "draw", "paint-by-number", "idle"];

function createIdleMode() {
  return {
    start() {},
    stop() {},
    getState() {
      return {};
    },
  };
}

function createModeManager({ db }) {
  const registry = {};
  let currentModeName = "idle";
  let currentInstance = createIdleMode();

  // `factory` is a zero-arg function that returns a fresh mode instance -
  // any dependencies it needs (db, rendererClient, ...) are closed over by
  // the caller when registering, since mode-manager itself only knows about db.
  function register(name, factory) {
    registry[name] = factory;
  }

  function persistCurrentMode(name) {
    db.prepare(
      `INSERT INTO app_state (key, value) VALUES ('current_mode', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(name);
  }

  async function switchMode(name) {
    if (!VALID_MODES.includes(name)) {
      throw new Error(`Unknown mode: ${name}`);
    }
    if (name !== "idle" && !registry[name]) {
      throw new Error(`Mode '${name}' is not implemented yet.`);
    }

    // The one rule this layer exists to enforce: fully stop the previous
    // mode before starting the next, so nothing keeps writing to the socket
    // after it is supposedly off.
    await currentInstance.stop();

    currentInstance = name === "idle" ? createIdleMode() : registry[name]();
    currentModeName = name;
    persistCurrentMode(name);
    await currentInstance.start();

    return getState();
  }

  function getState() {
    return { mode: currentModeName, ...currentInstance.getState() };
  }

  function getCurrentModeName() {
    return currentModeName;
  }

  function getCurrentInstance() {
    return currentInstance;
  }

  // Reads current_mode from app_state and resumes it. Called once on backend
  // startup. Falls back to idle if the stored mode has no implementation
  // registered yet (draw, paint-by-number), so an old app_state value can
  // never crash startup.
  async function resume() {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'current_mode'").get();
    const storedMode = row ? row.value : "idle";

    if (storedMode === "idle" || !registry[storedMode]) {
      if (storedMode !== "idle") {
        console.log(
          `[mode-manager] Stored mode '${storedMode}' has no implementation yet, staying idle.`
        );
      }
      currentModeName = "idle";
      currentInstance = createIdleMode();
      return;
    }

    console.log(`[mode-manager] Resuming mode '${storedMode}' from app_state.`);
    currentInstance = registry[storedMode]();
    currentModeName = storedMode;
    await currentInstance.start();
  }

  // Stops the current mode's timer/resources for a clean process exit,
  // WITHOUT persisting a mode change - current_mode in app_state must still
  // say what to resume next startup, not 'idle' just because the process
  // happened to shut down.
  async function shutdown() {
    await currentInstance.stop();
  }

  return {
    register,
    switchMode,
    getState,
    getCurrentModeName,
    getCurrentInstance,
    resume,
    shutdown,
  };
}

module.exports = { createModeManager, VALID_MODES };
