// Wraps scripts/process_image.py. This is the only file in the backend that
// knows Python exists - Node never decodes, resizes, or crops an image
// itself, it just spawns the script and passes file paths.

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const SCRIPT_PATH = path.join(__dirname, "..", "..", "scripts", "process_image.py");
const TIMEOUT_MS = 30000;
const EXPECTED_BYTES = 128 * 128 * 3;

// Runs process_image.py <inputPath> <outputPath> and resolves once the
// output file has been verified. Rejects on non-zero exit, unparsable
// stdout, a script-reported error, or a wrong-sized output file.
function processImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [SCRIPT_PATH, inputPath, outputPath]);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`process_image.py timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start process_image.py: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch (err) {
        reject(
          new Error(
            `process_image.py produced invalid JSON (exit ${code}): ${stdout || stderr}`
          )
        );
        return;
      }

      if (code !== 0 || !result.ok) {
        reject(new Error(`process_image.py failed: ${result.error || stderr || "unknown error"}`));
        return;
      }

      let stats;
      try {
        stats = fs.statSync(outputPath);
      } catch (err) {
        reject(new Error(`Output file missing after processing: ${outputPath}`));
        return;
      }

      if (stats.size !== EXPECTED_BYTES) {
        reject(
          new Error(
            `Output file has wrong size: ${stats.size} bytes, expected ${EXPECTED_BYTES}`
          )
        );
        return;
      }

      resolve(result);
    });
  });
}

module.exports = { processImage };