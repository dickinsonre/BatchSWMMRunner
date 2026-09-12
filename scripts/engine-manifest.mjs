#!/usr/bin/env node
// Verify or refresh the canonical browser-engine manifest.
//
// The manifest served to browsers is client/public/engines.json. This CLI
// deliberately does not maintain a second root-level copy: every path in the
// manifest is relative to client/public and every measured value comes from
// the bytes currently on disk.
//
//   node scripts/engine-manifest.mjs
//   node scripts/engine-manifest.mjs --list
//   node scripts/engine-manifest.mjs --update
//
// --update changes only descriptor.bytes and descriptor.sha256. Source
// provenance, compiler claims, fingerprints, and legal attribution are never
// inferred from a binary or rewritten by this command. It validates a complete
// candidate before atomically replacing the manifest, so a missing file or
// undeclared WASM cannot leave a partial update behind.

import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifestFile } from "./validate-engines.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PUBLIC_DIR = join(ROOT, "client", "public");

function usage() {
  console.log(`Usage: node scripts/engine-manifest.mjs [--list|--update]

Options:
  --list                  print recorded engine identity and measurements
  --update                refresh measured byte sizes and SHA-256 values
  --public-dir DIR        use a public directory (test/verification helper)
  --manifest FILE         use a manifest (defaults to DIR/engines.json)
  --help                  show this help`);
}

function parseArgs(argv) {
  let mode = "verify";
  let publicDir = DEFAULT_PUBLIC_DIR;
  let manifestPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list" || argument === "--update") {
      if (mode !== "verify") {
        throw new Error("--list and --update cannot be combined");
      }
      mode = argument.slice(2);
    } else if (argument === "--public-dir" || argument === "--manifest") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--public-dir") publicDir = resolve(value);
      else manifestPath = resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return {
    mode,
    publicDir,
    manifestPath: manifestPath ?? join(publicDir, "engines.json"),
  };
}

function descriptorEntries(manifest) {
  const entries = [];
  for (const [engineId, engine] of Object.entries(manifest.engines ?? {})) {
    if (engine?.buildInfo && typeof engine.buildInfo === "object") {
      entries.push([`${engineId}.buildInfo`, engine.buildInfo]);
    }
    for (const [name, descriptor] of Object.entries(engine?.artifacts ?? {})) {
      entries.push([`${engineId}.artifacts.${name}`, descriptor]);
    }
    for (const [index, descriptor] of (engine?.licenseFiles ?? []).entries()) {
      entries.push([`${engineId}.licenseFiles[${index}]`, descriptor]);
    }
  }
  return entries;
}

function measure(publicDir, descriptor, label) {
  if (!descriptor || typeof descriptor.path !== "string") {
    throw new Error(`${label} has no usable path`);
  }
  const filePath = resolve(publicDir, ...descriptor.path.split("/"));
  const publicRoot = resolve(publicDir);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}/`)) {
    throw new Error(`${label} path escapes the public directory: ${descriptor.path}`);
  }
  if (!existsSync(filePath)) {
    throw new Error(`${label} file is missing: ${descriptor.path}`);
  }
  if (!statSync(filePath).isFile()) {
    throw new Error(`${label} is not a regular file: ${descriptor.path}`);
  }
  const bytes = readFileSync(filePath);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function cloneManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}

function printList(manifest) {
  for (const [engineId, engine] of Object.entries(manifest.engines ?? {})) {
    const source = engine.source ?? {};
    console.log(`${engineId.padEnd(11)} ${engine.displayName ?? ""}`);
    for (const [name, descriptor] of Object.entries(engine.artifacts ?? {})) {
      console.log(
        `            ${descriptor.path}  ${descriptor.bytes ?? "?"} B`,
      );
      console.log(`            ${name} sha256 ${(descriptor.sha256 ?? "").slice(0, 16)}...`);
    }
    console.log(
      `            ${source.repositoryUrl ?? "?"} @ ${source.branch ?? "?"} commit ${source.commit ?? "UNRECORDED"}`,
    );
    console.log(`            version ${engine.fingerprint?.version ?? "?"}`);
    console.log();
  }
}

function run() {
  const { mode, publicDir, manifestPath } = parseArgs(process.argv.slice(2));
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read or parse ${manifestPath}: ${error.message}`);
  }

  if (mode === "list") {
    printList(manifest);
    return;
  }

  if (mode === "update") {
    const candidate = cloneManifest(manifest);
    try {
      for (const [label, descriptor] of descriptorEntries(candidate)) {
        Object.assign(descriptor, measure(publicDir, descriptor, label));
      }
    } catch (error) {
      throw new Error(`update aborted; manifest was not changed: ${error.message}`);
    }

    const candidatePath = `${manifestPath}.candidate-${process.pid}`;
    try {
      writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      const candidateResult = validateManifestFile(candidatePath, { publicDir });
      if (!candidateResult.valid) {
        throw new Error(
          "updated measurements do not validate:\n" +
            candidateResult.errors.map((error) => `- ${error}`).join("\n"),
        );
      }
      renameSync(candidatePath, manifestPath);
    } catch (error) {
      try {
        if (existsSync(candidatePath)) unlinkSync(candidatePath);
      } catch {
        // Keep the validation/write error as the actionable failure.
      }
      throw new Error(`update aborted; manifest was not changed: ${error.message}`);
    }
    console.log("client/public/engines.json: measured byte sizes and SHA-256 values refreshed.");
    console.log("Source provenance, fingerprints, compiler data, and legal attribution were preserved.");
    return;
  }

  const result = validateManifestFile(manifestPath, { publicDir });
  if (!result.valid) {
    console.error(`Engine manifest validation failed (${manifestPath})`);
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `engine manifest OK - ${Object.keys(manifest.engines ?? {}).length} engines, byte sizes, hashes, fingerprints, and recursive WASM coverage match.`,
  );
}

try {
  run();
} catch (error) {
  console.error(`Engine manifest command failed: ${error.message}`);
  process.exitCode = 1;
}