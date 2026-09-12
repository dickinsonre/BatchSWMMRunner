#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PUBLIC_DIR = path.join(ROOT, "client", "public");
const EXPECTED_SCHEMA_VERSION = 1;
const EXPECTED_ENGINE_IDS = ["swmm5", "swmm5-owa", "wasm6", "wasm6dev", "hydra"];
const EXPECTED_ARTIFACTS = {
  swmm5: {
    js: "wasm/swmm5.js",
    wasm: "wasm/swmm5.wasm",
  },
  "swmm5-owa": {
    js: "wasm-owa/swmm-owa.js",
    wasm: "wasm-owa/swmm-owa.wasm",
  },
  wasm6: {
    js: "wasm6/openswmm6.js",
    wasm: "wasm6/openswmm6.wasm",
    linkCommand: "wasm6/openswmm6.link-command.txt",
    linkMap: "wasm6/openswmm6.link.map",
  },
  wasm6dev: {
    js: "wasm6dev/openswmm6dev.js",
    wasm: "wasm6dev/openswmm6dev.wasm",
  },
  hydra: {
    js: "wasmhydra/hydra.js",
    wasm: "wasmhydra/hydra_bg.wasm",
    worker: "wasmhydra/hydra-worker.js",
  },
};
const EXPECTED_BUILD_INFO = {
  swmm5: null,
  "swmm5-owa": null,
  wasm6: "wasm6/BUILD_INFO.txt",
  wasm6dev: "wasm6dev/BUILD_INFO.txt",
  hydra: "wasmhydra/README.md",
};
const EXPECTED_LICENSE_PATHS = {
  // SWMM5 has no historical license text in client/public. Its unknown legal
  // state is recorded in the manifest rather than guessed.
  swmm5: [],
  "swmm5-owa": ["licenses/MIT-OWA-SWMM.txt"],
  wasm6: [
    "licenses/openswmm/LICENSE.txt",
    "licenses/openswmm/NOTICE.txt",
    "licenses/openswmm/PROVENANCE.md",
    "licenses/openswmm/DEPENDENCY_AUDIT.md",
    "licenses/openswmm/EMSCRIPTEN-LICENSE.txt",
    "licenses/openswmm/MUSL-COPYRIGHT.txt",
  ],
  wasm6dev: [
    "licenses/openswmm/LICENSE-DEVELOP-MIT.txt",
    "licenses/openswmm/PROVENANCE.md",
    "licenses/openswmm/DEPENDENCY_AUDIT.md",
    "licenses/openswmm/EMSCRIPTEN-LICENSE.txt",
    "licenses/openswmm/MUSL-COPYRIGHT.txt",
  ],
  hydra: ["wasmhydra/LICENSE-AGPL-3.0.txt"],
};

const TOP_LEVEL_KEYS = ["schemaVersion", "engines"];
const ENGINE_KEYS = [
  "id",
  "displayName",
  "source",
  "compiler",
  "buildInfo",
  "artifacts",
  "licenseFiles",
  "reportsVersion",
  "fingerprint",
];
const SOURCE_KEYS = [
  "repositoryUrl",
  "branch",
  "commit",
  "status",
  "evidence",
];
const COMPILER_KEYS = ["name", "version", "status", "flags", "evidence"];
const FILE_KEYS = ["path", "bytes", "sha256"];
const FINGERPRINT_KEYS = ["version", "present", "absent"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(value, expected, label, errors, { required = expected } = {}) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expectedSorted = [...expected].sort();
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${label} is missing required key "${key}"`);
    }
  }
  for (const key of actual) {
    if (!expectedSorted.includes(key)) {
      errors.push(`${label} has unknown key "${key}"`);
    }
  }
  return true;
}

function checkString(value, label, errors, { allowNull = false } = {}) {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty string${allowNull ? " or null" : ""}`);
  }
}

function checkSha256(value, label, errors) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    errors.push(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

function checkBytes(value, label, errors) {
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative safe integer`);
  }
}

function checkRelativePath(value, label, errors) {
  checkString(value, label, errors);
  if (typeof value !== "string" || value.length === 0) return;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    errors.push(`${label} must be relative to the public directory`);
    return;
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || value.includes("\\")) {
    errors.push(`${label} must not escape the public directory`);
  }
}

function checkFileDescriptor(value, label, errors) {
  if (!checkKeys(value, FILE_KEYS, label, errors)) return;
  checkRelativePath(value.path, `${label}.path`, errors);
  checkBytes(value.bytes, `${label}.bytes`, errors);
  checkSha256(value.sha256, `${label}.sha256`, errors);
}

function checkSource(source, label, errors) {
  if (!checkKeys(source, SOURCE_KEYS, label, errors)) return;
  if (
    source.repositoryUrl !== null &&
    (typeof source.repositoryUrl !== "string" ||
      !/^https?:\/\/\S+$/.test(source.repositoryUrl))
  ) {
    errors.push(`${label}.repositoryUrl must be an HTTP(S) URL or null`);
  }
  for (const key of ["branch", "commit"]) {
    checkString(source[key], `${label}.${key}`, errors, { allowNull: true });
  }
  if (source.commit !== null && !/^[0-9a-f]{40}$/.test(source.commit)) {
    errors.push(`${label}.commit must be a 40-character lowercase Git SHA or null`);
  }
  checkString(source.status, `${label}.status`, errors);
  if (!["recorded", "unknown"].includes(source.status)) {
    errors.push(`${label}.status must be "recorded" or "unknown"`);
  }
  checkString(source.evidence, `${label}.evidence`, errors);

  const provenanceFields = [source.repositoryUrl, source.branch, source.commit];
  if (source.status === "unknown" && provenanceFields.every((field) => field !== null)) {
    errors.push(`${label} marked unknown but has no unknown provenance field`);
  }
  if (source.status === "recorded" && provenanceFields.some((field) => field === null)) {
    errors.push(`${label} marked recorded but has an unknown provenance field`);
  }
}

function checkCompiler(compiler, label, errors) {
  if (!checkKeys(compiler, COMPILER_KEYS, label, errors)) return;
  checkString(compiler.name, `${label}.name`, errors);
  checkString(compiler.version, `${label}.version`, errors, { allowNull: true });
  checkString(compiler.status, `${label}.status`, errors);
  if (!["recorded", "documented", "unknown"].includes(compiler.status)) {
    errors.push(`${label}.status must be "recorded", "documented", or "unknown"`);
  }
  if (compiler.flags !== null && !Array.isArray(compiler.flags)) {
    errors.push(`${label}.flags must be an array or null`);
  }
  if (Array.isArray(compiler.flags)) {
    compiler.flags.forEach((flag, index) => {
      checkString(flag, `${label}.flags[${index}]`, errors);
    });
  }
  if (compiler.status === "unknown" && compiler.flags !== null) {
    errors.push(`${label} marked unknown must use null flags`);
  }
  if (compiler.status !== "unknown" && compiler.flags === null) {
    errors.push(`${label} must record flags unless compiler status is unknown`);
  }
  checkString(compiler.evidence, `${label}.evidence`, errors);
}

function checkFingerprint(fingerprint, label, errors) {
  if (!checkKeys(fingerprint, FINGERPRINT_KEYS, label, errors)) return;
  checkString(fingerprint.version, `${label}.version`, errors);
  for (const key of ["present", "absent"]) {
    if (!Array.isArray(fingerprint[key])) {
      errors.push(`${label}.${key} must be an array`);
    } else {
      fingerprint[key].forEach((value, index) => {
        checkString(value, `${label}.${key}[${index}]`, errors);
      });
    }
  }
}

function resolvePublicFile(publicDir, relativePath) {
  const publicRoot = path.resolve(publicDir);
  const resolved = path.resolve(publicRoot, ...relativePath.split("/"));
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkWasmFiles(directory, callback) {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    const stats = fs.lstatSync(filePath);
    if (stats.isDirectory()) {
      walkWasmFiles(filePath, callback);
    } else if (stats.isFile() && name.endsWith(".wasm")) {
      callback(filePath);
    }
  }
}

function verifyFiles(manifest, publicDir, errors) {
  const seen = new Map();
  const files = [];
  const wasmDescriptors = [];
  for (const engineId of EXPECTED_ENGINE_IDS) {
    const engine = manifest.engines?.[engineId];
    if (!isObject(engine)) continue;

    if (isObject(engine.buildInfo)) {
      files.push([`${engineId}.buildInfo`, engine.buildInfo]);
    }
    if (isObject(engine.artifacts)) {
      for (const name of Object.keys(EXPECTED_ARTIFACTS[engineId])) {
        if (Object.prototype.hasOwnProperty.call(engine.artifacts, name)) {
          const descriptor = engine.artifacts[name];
          files.push([`${engineId}.artifacts.${name}`, descriptor]);
          if (name === "wasm") wasmDescriptors.push([engineId, descriptor]);
        }
      }
    }
    if (Array.isArray(engine.licenseFiles)) {
      engine.licenseFiles.forEach((descriptor, index) => {
        files.push([`${engineId}.licenseFiles[${index}]`, descriptor]);
      });
    }
  }

  const declaredWasm = new Set();
  for (const [label, descriptor] of files) {
    if (!isObject(descriptor) || typeof descriptor.path !== "string") continue;
    const absolutePath = resolvePublicFile(publicDir, descriptor.path);
    if (!absolutePath) {
      errors.push(`${label}.path escapes the public directory`);
      continue;
    }
    if (descriptor.path.endsWith(".wasm")) declaredWasm.add(descriptor.path);
    if (seen.has(descriptor.path)) {
      const previous = seen.get(descriptor.path);
      if (previous.sha256 !== descriptor.sha256 || previous.bytes !== descriptor.bytes) {
        errors.push(
          `${label} disagrees with ${previous.label} for ${descriptor.path}`,
        );
      }
    } else {
      seen.set(descriptor.path, {
        label,
        sha256: descriptor.sha256,
        bytes: descriptor.bytes,
      });
    }
    if (!fs.existsSync(absolutePath)) {
      errors.push(`${label} file is missing: ${descriptor.path}`);
      continue;
    }
    if (!fs.statSync(absolutePath).isFile()) {
      errors.push(`${label} is not a regular file: ${descriptor.path}`);
      continue;
    }
    const actualBytes = fs.statSync(absolutePath).size;
    const actualHash = sha256(absolutePath);
    if (actualBytes !== descriptor.bytes) {
      errors.push(
        `${label} byte-size mismatch for ${descriptor.path}: expected ${descriptor.bytes}, got ${actualBytes}`,
      );
    }
    if (actualHash !== descriptor.sha256) {
      errors.push(
        `${label} SHA-256 mismatch for ${descriptor.path}: expected ${descriptor.sha256}, got ${actualHash}`,
      );
    }
  }

  walkWasmFiles(publicDir, (absolutePath) => {
    const relativePath = path.relative(publicDir, absolutePath).split(path.sep).join("/");
    if (!declaredWasm.has(relativePath)) {
      errors.push(`undeclared .wasm shipped to the browser: ${relativePath}`);
    }
  });

  for (const [engineId, descriptor] of wasmDescriptors) {
    if (!isObject(descriptor) || typeof descriptor.path !== "string") continue;
    const engine = manifest.engines[engineId];
    const absolutePath = resolvePublicFile(publicDir, descriptor.path);
    if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }
    const binary = fs.readFileSync(absolutePath);
    const has = (needle) => binary.includes(Buffer.from(needle, "latin1"));
    const fingerprint = engine.fingerprint;
    if (typeof engine.reportsVersion === "string" && !has(engine.reportsVersion)) {
      errors.push(
        `${engineId}.reportsVersion is absent from ${descriptor.path}: ${engine.reportsVersion}`,
      );
    }
    if (isObject(fingerprint)) {
      if (!has(fingerprint.version)) {
        errors.push(
          `${engineId}.fingerprint.version is absent from ${descriptor.path}: ${fingerprint.version}`,
        );
      }
      for (const needle of fingerprint.present ?? []) {
        if (!has(needle)) {
          errors.push(`${engineId}.fingerprint expected string is absent: ${needle}`);
        }
      }
      for (const needle of fingerprint.absent ?? []) {
        if (has(needle)) {
          errors.push(`${engineId}.fingerprint forbidden string is present: ${needle}`);
        }
      }
    }
  }
}

/**
 * Validate a parsed engines.json and the files it identifies.
 *
 * This function intentionally validates schema, provenance, measured bytes,
 * fingerprints, and recursive WASM coverage. It is exported so companion
 * repositories can reuse the checks without invoking the CLI.
 */
export function validateManifest(manifest, { publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  const errors = [];
  if (!checkKeys(manifest, TOP_LEVEL_KEYS, "manifest", errors)) {
    return { valid: false, errors };
  }
  if (manifest.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    errors.push(
      `manifest.schemaVersion must be ${EXPECTED_SCHEMA_VERSION}, got ${String(manifest.schemaVersion)}`,
    );
  }
  if (!checkKeys(manifest.engines, EXPECTED_ENGINE_IDS, "manifest.engines", errors)) {
    return { valid: false, errors };
  }

  for (const engineId of EXPECTED_ENGINE_IDS) {
    const engine = manifest.engines[engineId];
    const label = `manifest.engines.${engineId}`;
    if (!checkKeys(engine, ENGINE_KEYS, label, errors)) continue;
    if (engine.id !== engineId) {
      errors.push(`${label}.id must be "${engineId}"`);
    }
    checkString(engine.displayName, `${label}.displayName`, errors);
    checkSource(engine.source, `${label}.source`, errors);
    checkCompiler(engine.compiler, `${label}.compiler`, errors);
    checkString(engine.reportsVersion, `${label}.reportsVersion`, errors);
    checkFingerprint(engine.fingerprint, `${label}.fingerprint`, errors);
    const expectedBuildInfo = EXPECTED_BUILD_INFO[engineId];
    if (expectedBuildInfo === null && engine.buildInfo !== null) {
      errors.push(`${label}.buildInfo must be null for this historical artifact`);
    } else if (expectedBuildInfo !== null && engine.buildInfo === null) {
      errors.push(`${label}.buildInfo is required for this artifact`);
    } else if (engine.buildInfo !== null) {
      if (engine.buildInfo.path !== expectedBuildInfo) {
        errors.push(`${label}.buildInfo.path must be "${expectedBuildInfo}"`);
      }
      checkFileDescriptor(engine.buildInfo, `${label}.buildInfo`, errors);
    }

    const expectedArtifactNames = Object.keys(EXPECTED_ARTIFACTS[engineId]);
    if (!checkKeys(
      engine.artifacts,
      expectedArtifactNames,
      `${label}.artifacts`,
      errors,
      { required: expectedArtifactNames },
    )) {
      continue;
    }
    for (const name of expectedArtifactNames) {
      checkFileDescriptor(engine.artifacts[name], `${label}.artifacts.${name}`, errors);
      if (engine.artifacts[name]?.path !== EXPECTED_ARTIFACTS[engineId][name]) {
        errors.push(
          `${label}.artifacts.${name}.path must be "${EXPECTED_ARTIFACTS[engineId][name]}"`,
        );
      }
    }

    if (!Array.isArray(engine.licenseFiles)) {
      errors.push(`${label}.licenseFiles must be an array`);
    } else {
      engine.licenseFiles.forEach((descriptor, index) => {
        checkFileDescriptor(
          descriptor,
          `${label}.licenseFiles[${index}]`,
          errors,
        );
      });
      const expectedLicensePaths = [...EXPECTED_LICENSE_PATHS[engineId]].sort();
      const actualLicensePaths = engine.licenseFiles
        .map((descriptor) => descriptor?.path)
        .sort();
      if (
        actualLicensePaths.length !== expectedLicensePaths.length ||
        actualLicensePaths.some(
          (filePath, index) => filePath !== expectedLicensePaths[index],
        )
      ) {
        errors.push(
          `${label}.licenseFiles must list exactly the recorded legal files`,
        );
      }
    }
  }

  if (errors.length === 0) verifyFiles(manifest, publicDir, errors);
  return { valid: errors.length === 0, errors };
}

export function validateManifestFile(manifestPath, options = {}) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      errors: [`Unable to read or parse ${manifestPath}: ${error.message}`],
    };
  }
  return validateManifest(manifest, options);
}

function parseArgs(argv) {
  let publicDir = DEFAULT_PUBLIC_DIR;
  let manifestPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--public-dir" || argument === "--manifest") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--public-dir") publicDir = path.resolve(value);
      else manifestPath = path.resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node scripts/validate-engines.mjs [--public-dir DIR] [--manifest FILE]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return {
    publicDir,
    manifestPath: manifestPath ?? path.join(publicDir, "engines.json"),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const { publicDir, manifestPath } = parseArgs(process.argv.slice(2));
    const result = validateManifestFile(manifestPath, { publicDir });
    if (!result.valid) {
      console.error(`Engine manifest validation failed (${manifestPath})`);
      result.errors.forEach((error) => console.error(`- ${error}`));
      process.exitCode = 1;
    } else {
      console.log(
        `Engine manifest valid: ${EXPECTED_ENGINE_IDS.length} engines, artifact, fingerprint, and legal-file hashes verified.`,
      );
    }
  } catch (error) {
    console.error(`Engine manifest validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}