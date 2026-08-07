// Wraps the Python image scripts (scripts/process_image.py,
// scripts/raw_to_png.py, scripts/pbn_analyze.py). This is the only file in
// the backend that knows Python exists - Node never decodes, resizes,
// crops, or encodes an image itself, it just spawns a script and passes
// file paths.

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const SCRIPTS_DIR = path.join(__dirname, "..", "..", "scripts");
const PROCESS_IMAGE_SCRIPT = path.join(SCRIPTS_DIR, "process_image.py");
const RAW_TO_PNG_SCRIPT = path.join(SCRIPTS_DIR, "raw_to_png.py");
const PBN_ANALYZE_SCRIPT = path.join(SCRIPTS_DIR, "pbn_analyze.py");
const TIMEOUT_MS = 30000;
const FRAME_BYTES = 128 * 128 * 3;

// Runs `python3 <args>`, resolving with the parsed JSON result printed on
// stdout. Rejects on non-zero exit, unparsable stdout, a script-reported
// error, or a timeout (so a hung Python process can't block a request
// forever).
function runPythonScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", args);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${args[0]} timed out after ${TIMEOUT_MS}ms`));
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
      reject(new Error(`Failed to start ${args[0]}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch (err) {
        reject(new Error(`${args[0]} produced invalid JSON (exit ${code}): ${stdout || stderr}`));
        return;
      }

      if (code !== 0 || !result.ok) {
        reject(new Error(`${args[0]} failed: ${result.error || stderr || "unknown error"}`));
        return;
      }

      resolve(result);
    });
  });
}

// Runs process_image.py <inputPath> <outputPath> [--crop-x/y/w/h] [--no-dither]
// and resolves once the output file has been verified. `options.cropX/Y/W/H`
// must all be provided together to apply a crop; `options.dither === false`
// disables dithering (on by default in the script).
async function processImage(inputPath, outputPath, options = {}) {
  const args = [PROCESS_IMAGE_SCRIPT, inputPath, outputPath];

  const { cropX, cropY, cropW, cropH, dither } = options;
  const hasCrop = [cropX, cropY, cropW, cropH].every((v) => v !== undefined);
  if (hasCrop) {
    args.push(
      "--crop-x", String(cropX),
      "--crop-y", String(cropY),
      "--crop-w", String(cropW),
      "--crop-h", String(cropH)
    );
  }
  if (dither === false) {
    args.push("--no-dither");
  }

  const result = await runPythonScript(args);

  let stats;
  try {
    stats = fs.statSync(outputPath);
  } catch (err) {
    throw new Error(`Output file missing after processing: ${outputPath}`);
  }
  if (stats.size !== FRAME_BYTES) {
    throw new Error(`Output file has wrong size: ${stats.size} bytes, expected ${FRAME_BYTES}`);
  }

  return result;
}

// Runs raw_to_png.py <rawPath> <pngPath> - converts an already-raw 128x128
// RGB file (e.g. a saved drawing canvas) into a viewable PNG.
async function convertRawToPng(rawPath, pngPath) {
  const result = await runPythonScript([RAW_TO_PNG_SCRIPT, rawPath, pngPath]);

  if (!fs.existsSync(pngPath)) {
    throw new Error(`Output file missing after conversion: ${pngPath}`);
  }

  return result;
}

// Runs pbn_analyze.py <inputPath> <difficulty> <outputJsonPath> - builds a
// colour palette and per-block answers for paint-by-number mode. Returns
// the parsed result directly from stdout (grid_width, grid_height, palette,
// block_colors, full_res_path) rather than re-reading the JSON file the
// script also writes - both contain the same data, and the script writes
// the file because the CLI contract requires an output path, not because
// Node needs to read it back.
async function analyzePbn(inputPath, difficulty, outputJsonPath) {
  const result = await runPythonScript([PBN_ANALYZE_SCRIPT, inputPath, difficulty, outputJsonPath]);

  if (!fs.existsSync(result.full_res_path)) {
    throw new Error(`Full-res file missing after analysis: ${result.full_res_path}`);
  }

  return result;
}

module.exports = { processImage, convertRawToPng, analyzePbn };
