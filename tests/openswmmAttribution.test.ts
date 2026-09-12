import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "client", "public");
const licenseDir = path.join(publicDir, "licenses", "openswmm");

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

describe("OpenSWMM redistribution attribution", () => {
  it("bundles the complete upstream Apache-2.0 license", () => {
    const bytes = fs.readFileSync(path.join(licenseDir, "LICENSE.txt"));
    const license = bytes.toString("utf8");

    expect(license).toContain("Copyright 2026 HydroCouple Developers");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(sha256(bytes)).toBe(
      "94fcde3f05aad351a969a65f5c87b25ee3893ee7297549d6a3217bf29ccbc3aa",
    );
  });

  it("bundles the verbatim swmm6_rel upstream NOTICE", () => {
    const bytes = fs.readFileSync(path.join(licenseDir, "NOTICE.txt"));
    const notice = bytes.toString("utf8");

    expect(notice).toContain("OpenSWMM Engine");
    expect(notice).toContain("Copyright 2026 HydroCouple Developers");
    expect(notice).toContain("PUBLIC DOMAIN MATERIAL");
    expect(notice).toContain("The USEPA does not endorse this product");
    expect(notice).toContain("THIRD-PARTY COMPONENTS");
    expect(sha256(bytes)).toBe(
      "83a3c0524ba9dd6929a5d5e110f959d318ce142ffbc2cce74616bf5866b1d5cb",
    );
  });

  it("bundles the exact develop-branch MIT license", () => {
    const license = fs.readFileSync(
      path.join(licenseDir, "LICENSE-DEVELOP-MIT.txt"),
      "utf8",
    );

    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright 2026 Caleb Buahin");
    expect(license).toContain(
      "The above copyright notice and this permission notice shall be included",
    );
  });

  it("bundles the exact OWA MIT license and preserves its public-domain boundary", () => {
    const bytes = fs.readFileSync(path.join(publicDir, "licenses", "MIT-OWA-SWMM.txt"));
    const license = bytes.toString("utf8");

    expect(license).toContain("https://github.com/OpenWaterAnalytics/");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2020-2021 see CONTRIBUTORS");
    expect(license).toContain("Original material residing in the public");
    expect(license).toContain("Third-Party Libraries");
    expect(sha256(bytes)).toBe(
      "dadc02439364fbb190308ea38dea3f5f71ebf5383c54262f2f803bc88240f15c",
    );
  });

  it("serves the application NOTICE byte-for-byte in the browser package", () => {
    expect(fs.readFileSync(path.join(publicDir, "NOTICE.txt"))).toEqual(
      fs.readFileSync(path.join(root, "NOTICE")),
    );
  });

  it.each([
    [
      "wasm6",
      "swmm6_rel",
      "137e65e4e25e9425a489b99d5b7365c8355f8f6b",
      "License: Apache-2.0",
      "Upstream NOTICE: /licenses/openswmm/NOTICE.txt",
    ],
    [
      "wasm6dev",
      "develop",
      "19a1bc42074eac8cdf46e2edafe6fc5849adf6da",
      "License: MIT",
      "Upstream NOTICE: none at recorded commit",
    ],
  ])("records provenance and modifications for %s", (directory, branch, commit, license, notice) => {
    const manifest = fs.readFileSync(
      path.join(publicDir, directory, "BUILD_INFO.txt"),
      "utf8",
    );

    expect(manifest).toContain(`Branch: ${branch}`);
    expect(manifest).toContain(`Commit: ${commit}`);
    expect(manifest).toContain(license);
    expect(manifest).toContain(notice);
    expect(manifest).toContain("Dependency license audit:");
    expect(manifest).toContain(directory === "wasm6" ? "Local build patch" : "Local modifications to upstream source");
    expect(manifest).toContain("__EMSCRIPTEN__");
  });

  it("records why optional dependency licenses are not redistributed", () => {
    const audit = fs.readFileSync(
      path.join(licenseDir, "DEPENDENCY_AUDIT.md"),
      "utf8",
    );

    for (const dependency of ["SQLite", "HDF5", "Kokkos", "GoogleTest", "Google Benchmark"]) {
      expect(audit).toContain(dependency);
    }
    expect(audit).toContain("No separately licensed optional OpenSWMM dependency is linked");
    expect(audit).toContain("redistributed with either browser build");
    expect(audit).toContain("OPENSWMM_WITH_GEOPACKAGE=OFF");
    expect(audit).toContain("OPENSWMM_BUILD_2D=OFF");
    expect(audit).toContain("OPENSWMM_BUILD_GPU_PLUGIN=OFF");
    expect(audit).toContain("LLVM Exceptions");
    expect(audit).toContain("do not prove whether Emscripten selected");
    expect(audit).toContain("dlmalloc or");
    expect(audit).toContain("final linker");
    expect(audit).toContain("/wasm6/openswmm6.link.map");
    expect(audit).toContain("/wasm6/openswmm6.link-command.txt");
    expect(fs.statSync(path.join(publicDir, "wasm6", "openswmm6.link.map")).size).toBeGreaterThan(0);
  });

  it("bundles the compiler runtime notices used by both WASM builds", () => {
    const emscripten = fs.readFileSync(
      path.join(licenseDir, "EMSCRIPTEN-LICENSE.txt"),
      "utf8",
    );
    const musl = fs.readFileSync(
      path.join(licenseDir, "MUSL-COPYRIGHT.txt"),
      "utf8",
    );

    expect(emscripten).toContain("Copyright (c) 2010-2014 Emscripten authors");
    expect(emscripten).toContain("University of Illinois/NCSA Open Source License");
    expect(musl).toContain("Copyright © 2005-2020 Rich Felker, et al.");
    expect(musl).toContain("TRE regular expression implementation");
  });

  it("exposes license links and non-endorsement in the in-app documentation", () => {
    const documentation = fs.readFileSync(
      path.join(root, "client", "src", "pages", "Documentation.tsx"),
      "utf8",
    );

    expect(documentation).toContain("/licenses/openswmm/LICENSE.txt");
    expect(documentation).toContain("/licenses/openswmm/NOTICE.txt");
    expect(documentation).toContain("/licenses/openswmm/LICENSE-DEVELOP-MIT.txt");
    expect(documentation).toContain("/licenses/openswmm/PROVENANCE.md");
    expect(documentation).toContain("/licenses/openswmm/DEPENDENCY_AUDIT.md");
    expect(documentation).toContain("/licenses/openswmm/EMSCRIPTEN-LICENSE.txt");
    expect(documentation).toContain("/licenses/openswmm/MUSL-COPYRIGHT.txt");
    expect(documentation).toContain("do not license BatchSWMM56 as a whole");
    expect(documentation).toContain("nor the OpenSWMM authors endorse BatchSWMM56");
  });
});