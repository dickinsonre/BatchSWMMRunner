import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const publicDir = path.join(root, "client", "public");
const manifestPath = path.join(publicDir, "engines.json");
const validatorPath = path.join(root, "scripts", "validate-engines.mjs");
const manifestScriptPath = path.join(root, "scripts", "engine-manifest.mjs");

function validate(publicRoot: string, manifest = path.join(publicRoot, "engines.json")) {
  return spawnSync(
    process.execPath,
    [validatorPath, "--public-dir", publicRoot, "--manifest", manifest],
    { cwd: root, encoding: "utf8" },
  );
}

function runManifest(
  publicRoot: string,
  args: string[] = [],
  manifest = path.join(publicRoot, "engines.json"),
) {
  return spawnSync(
    process.execPath,
    [
      manifestScriptPath,
      ...args,
      "--public-dir",
      publicRoot,
      "--manifest",
      manifest,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

function copyPublicDirectory(prefix: string) {
  const temporaryPublicDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(publicDir, temporaryPublicDir, { recursive: true });
  return temporaryPublicDir;
}

describe("browser engine manifest", () => {
  it("validates the checked-in schema, provenance, and artifact hashes", () => {
    const result = validate(publicDir, manifestPath);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("keeps the root NOTICE in the browser package and ships the OWA license", () => {
    const rootNotice = fs.readFileSync(path.join(root, "NOTICE"));
    const publicNotice = fs.readFileSync(path.join(publicDir, "NOTICE.txt"));
    expect(publicNotice).toEqual(rootNotice);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const owaLicense = manifest.engines["swmm5-owa"].licenseFiles.find(
      (descriptor: { path: string }) => descriptor.path === "licenses/MIT-OWA-SWMM.txt",
    );
    expect(owaLicense).toBeDefined();
    const licensePath = path.join(publicDir, owaLicense.path);
    expect(fs.statSync(licensePath).isFile()).toBe(true);
    const licenseBytes = fs.readFileSync(licensePath);
    expect(owaLicense.bytes).toBe(licenseBytes.length);
    expect(owaLicense.sha256).toBe(createHash("sha256").update(licenseBytes).digest("hex"));
  });

  it("fails when a bundled artifact is tampered with", () => {
    const temporaryPublicDir = copyPublicDirectory("batchswmm-engine-manifest-");
    try {
      fs.cpSync(publicDir, temporaryPublicDir, { recursive: true });
      const artifactPath = path.join(temporaryPublicDir, "wasm", "swmm5.js");
      const artifact = fs.readFileSync(artifactPath);
      artifact[0] ^= 0xff;
      fs.writeFileSync(artifactPath, artifact);

      const result = validate(temporaryPublicDir);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/SHA-256 mismatch/);
    } finally {
      fs.rmSync(temporaryPublicDir, { recursive: true, force: true });
    }
  });

  it("fails when the manifest schema version drifts", () => {
    const temporaryDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "batchswmm-engine-schema-"),
    );
    const temporaryManifest = path.join(temporaryDir, "engines.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        schemaVersion: number;
      };
      manifest.schemaVersion = 2;
      fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest)}\n`);

      const result = validate(publicDir, temporaryManifest);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/schemaVersion/);
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
  });

  it("fails when a declared artifact is missing", () => {
    const temporaryPublicDir = copyPublicDirectory("batchswmm-engine-missing-");
    const temporaryManifest = path.join(temporaryPublicDir, "engines.json");
    const before = fs.readFileSync(temporaryManifest, "utf8");
    try {
      fs.rmSync(path.join(temporaryPublicDir, "wasmhydra", "hydra_bg.wasm"));
      const result = runManifest(temporaryPublicDir);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/file is missing/);
      expect(fs.readFileSync(temporaryManifest, "utf8")).toBe(before);
    } finally {
      fs.rmSync(temporaryPublicDir, { recursive: true, force: true });
    }
  });

  it("fails when a browser WASM file is not declared", () => {
    const temporaryPublicDir = copyPublicDirectory("batchswmm-engine-undeclared-");
    const temporaryManifest = path.join(temporaryPublicDir, "engines.json");
    const before = fs.readFileSync(temporaryManifest, "utf8");
    try {
      fs.writeFileSync(
        path.join(temporaryPublicDir, "wasmhydra", "unlisted.wasm"),
        Buffer.from("not an engine"),
      );
      const result = runManifest(temporaryPublicDir);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/undeclared \.wasm/);
      expect(fs.readFileSync(temporaryManifest, "utf8")).toBe(before);
    } finally {
      fs.rmSync(temporaryPublicDir, { recursive: true, force: true });
    }
  });

  it("catches a fingerprint mismatch even when measured hashes are changed", () => {
    const temporaryPublicDir = copyPublicDirectory("batchswmm-engine-fingerprint-");
    const temporaryManifest = path.join(temporaryPublicDir, "engines.json");
    try {
      const artifactPath = path.join(temporaryPublicDir, "wasm6", "openswmm6.wasm");
      const artifact = fs.readFileSync(artifactPath);
      const marker = Buffer.from("6.0.0-alpha.4");
      const replacement = Buffer.from("6.0.0-alpha.X");
      const offset = artifact.indexOf(marker);
      expect(offset).toBeGreaterThanOrEqual(0);
      replacement.copy(artifact, offset);
      fs.writeFileSync(artifactPath, artifact);

      const manifest = JSON.parse(fs.readFileSync(temporaryManifest, "utf8"));
      const wasm = manifest.engines.wasm6.artifacts.wasm;
      wasm.bytes = artifact.length;
      wasm.sha256 = createHash("sha256").update(artifact).digest("hex");
      fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest)}\n`);

      const result = runManifest(temporaryPublicDir);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/fingerprint/);
    } finally {
      fs.rmSync(temporaryPublicDir, { recursive: true, force: true });
    }
  });

  it("updates measured metadata without changing provenance or attribution", () => {
    const temporaryPublicDir = copyPublicDirectory("batchswmm-engine-update-");
    const temporaryManifest = path.join(temporaryPublicDir, "engines.json");
    try {
      const before = JSON.parse(fs.readFileSync(temporaryManifest, "utf8"));
      const result = runManifest(temporaryPublicDir, ["--update"]);
      expect(result.status).toBe(0);
      const after = JSON.parse(fs.readFileSync(temporaryManifest, "utf8"));

      for (const [id, engine] of Object.entries(before.engines) as [
        string,
        any,
      ][]) {
        expect(after.engines[id].source).toEqual(engine.source);
        expect(after.engines[id].compiler).toEqual(engine.compiler);
        expect(after.engines[id].reportsVersion).toBe(engine.reportsVersion);
        expect(after.engines[id].fingerprint).toEqual(engine.fingerprint);
        expect(after.engines[id].licenseFiles).toEqual(engine.licenseFiles);
      }
      expect(after.engines.wasm6.source.commit).toBe(
        "137e65e4e25e9425a489b99d5b7365c8355f8f6b",
      );
      expect(after.engines.hydra.source.commit).toBe(
        "2a75372531b981c3a8f6668cbb846a0366cf062d",
      );
      for (const engine of Object.values(after.engines) as any[]) {
        for (const descriptor of [
          ...(engine.buildInfo ? [engine.buildInfo] : []),
          ...Object.values(engine.artifacts),
          ...engine.licenseFiles,
        ] as any[]) {
          const bytes = fs.readFileSync(path.join(temporaryPublicDir, descriptor.path));
          expect(descriptor.bytes).toBe(bytes.length);
          expect(descriptor.sha256).toBe(
            createHash("sha256").update(bytes).digest("hex"),
          );
        }
      }
    } finally {
      fs.rmSync(temporaryPublicDir, { recursive: true, force: true });
    }
  });
});