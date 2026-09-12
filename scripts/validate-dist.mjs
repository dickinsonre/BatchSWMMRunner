#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifestFile } from "./validate-engines.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "dist", "public");
const MANIFEST_PATH = path.join(PUBLIC_DIR, "engines.json");

// These are the legal files required by the bundled engine records. Keep this
// list as paths, not copied license text, so the production gate checks the
// same files served to browsers without duplicating their contents.
const REQUIRED_LICENSE_FILES = [
  "licenses/MIT-OWA-SWMM.txt",
  "licenses/openswmm/LICENSE.txt",
  "licenses/openswmm/NOTICE.txt",
  "licenses/openswmm/LICENSE-DEVELOP-MIT.txt",
  "licenses/openswmm/PROVENANCE.md",
  "licenses/openswmm/DEPENDENCY_AUDIT.md",
  "licenses/openswmm/EMSCRIPTEN-LICENSE.txt",
  "licenses/openswmm/MUSL-COPYRIGHT.txt",
  "wasmhydra/LICENSE-AGPL-3.0.txt",
];

const errors = [];
const ROOT_NOTICE_PATH = path.join(ROOT, "NOTICE");
const PUBLIC_NOTICE_PATH = path.join(PUBLIC_DIR, "NOTICE.txt");
if (!fs.existsSync(MANIFEST_PATH)) {
  errors.push(`missing production manifest: ${MANIFEST_PATH}`);
} else {
  errors.push(
    ...validateManifestFile(MANIFEST_PATH, { publicDir: PUBLIC_DIR }).errors,
  );
}

if (!fs.existsSync(ROOT_NOTICE_PATH)) {
  errors.push(`missing root NOTICE: ${ROOT_NOTICE_PATH}`);
} else if (!fs.existsSync(PUBLIC_NOTICE_PATH)) {
  errors.push(`missing production NOTICE: ${PUBLIC_NOTICE_PATH}`);
} else if (!fs.readFileSync(ROOT_NOTICE_PATH).equals(fs.readFileSync(PUBLIC_NOTICE_PATH))) {
  errors.push("production NOTICE.txt differs from the root NOTICE");
}

for (const relativePath of REQUIRED_LICENSE_FILES) {
  const absolutePath = path.join(PUBLIC_DIR, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    errors.push(`missing required production notice/license: ${relativePath}`);
  }
}

if (errors.length > 0) {
  console.error("Production public-output validation failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "Production public output valid: engines.json, artifact hashes, fingerprints, and engine notices verified.",
  );
}