// Regenerate src/modules.js from the repo-root on-device scripts (base64 of UTF-8 bytes).
// Run after editing ../../location-spoofer.js or ../../location-settings.js:
//   cd stateless-picker/worker && node scripts/gen-modules.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // stateless-picker/worker
const repoRoot = path.resolve(dir, "..", ".."); // repo root (ios-location-spoofer)
const b64 = (p) => readFileSync(p).toString("base64");

const spoofer = b64(path.join(repoRoot, "location-spoofer.js"));
const settings = b64(path.join(repoRoot, "location-settings.js"));
const spooferQx = b64(path.join(repoRoot, "location-spoofer-qx.js"));

const out =
  "// Auto-generated: the on-device module scripts, base64 (UTF-8 bytes). DO NOT EDIT BY HAND.\n" +
  "// Regenerate with: cd stateless-picker/worker && node scripts/gen-modules.mjs\n" +
  "// The worker serves these at /location-spoofer.js, /location-settings.js and\n" +
  "// /location-spoofer-qx.js so the whole stateless setup runs from the worker (no GitHub dep).\n" +
  'export const LOCATION_SPOOFER_B64 = "' + spoofer + '";\n' +
  'export const LOCATION_SETTINGS_B64 = "' + settings + '";\n' +
  'export const LOCATION_SPOOFER_QX_B64 = "' + spooferQx + '";\n';

writeFileSync(path.join(dir, "src", "modules.js"), out);
console.log("wrote src/modules.js (spoofer=" + spoofer.length + ", settings=" + settings.length + ", qx=" + spooferQx.length + ")");
