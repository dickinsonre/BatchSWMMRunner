import { describe, it, expect, beforeEach } from "vitest";
import {
  canExecuteDirectly,
  resolveSwmmInvocation,
  loaderChoiceCache,
  BUNDLED_LOADER,
  BUNDLED_LIB_DIR,
  type InvocationDeps,
} from "../server/swmmInvocation";

const BIN = "/fake/swmm-engine/runswmm";

function errnoError(code: string): NodeJS.ErrnoException {
  const e = new Error(`spawn ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

function deps(overrides: Partial<InvocationDeps> & { errorCode?: string | null; loader?: boolean }): InvocationDeps {
  return {
    probe: overrides.probe ?? (() => (overrides.errorCode ? { error: errnoError(overrides.errorCode) } : {})),
    loaderExists: overrides.loaderExists ?? (() => overrides.loader ?? true),
  };
}

beforeEach(() => {
  loaderChoiceCache.clear();
});

describe("canExecuteDirectly", () => {
  it("treats a non-zero exit with no spawn error as executable", () => {
    // e.g. "Not Enough Arguments" — the binary ran fine.
    expect(canExecuteDirectly(BIN, deps({ errorCode: null }))).toBe(true);
  });

  it("treats ENOENT (missing ELF interpreter / glibc loader) as NOT executable", () => {
    expect(canExecuteDirectly(BIN, deps({ errorCode: "ENOENT" }))).toBe(false);
  });

  it("treats EACCES as NOT executable", () => {
    expect(canExecuteDirectly(BIN, deps({ errorCode: "EACCES" }))).toBe(false);
  });

  it("treats ETIMEDOUT as executable (the process actually started)", () => {
    expect(canExecuteDirectly(BIN, deps({ errorCode: "ETIMEDOUT" }))).toBe(true);
  });
});

describe("resolveSwmmInvocation", () => {
  it("runs the binary directly when the probe succeeds", () => {
    const inv = resolveSwmmInvocation(BIN, deps({ errorCode: null }));
    expect(inv).toEqual({ cmd: BIN, argsPrefix: [] });
    expect(loaderChoiceCache.get(BIN)).toBe(false);
  });

  it("falls back to the bundled loader on ENOENT when the loader exists", () => {
    const inv = resolveSwmmInvocation(BIN, deps({ errorCode: "ENOENT", loader: true }));
    expect(inv).toEqual({
      cmd: BUNDLED_LOADER,
      argsPrefix: ["--library-path", BUNDLED_LIB_DIR, BIN],
    });
    expect(loaderChoiceCache.get(BIN)).toBe(true);
  });

  it("falls back to the bundled loader on EACCES when the loader exists", () => {
    const inv = resolveSwmmInvocation(BIN, deps({ errorCode: "EACCES", loader: true }));
    expect(inv?.cmd).toBe(BUNDLED_LOADER);
  });

  it("returns null and does NOT cache when direct execution fails and no loader exists", () => {
    const inv = resolveSwmmInvocation(BIN, deps({ errorCode: "ENOENT", loader: false }));
    expect(inv).toBeNull();
    // Caching false here would mean "run direct" on retry — must stay uncached.
    expect(loaderChoiceCache.has(BIN)).toBe(false);

    // A retry after the loader becomes available must pick the loader.
    const retry = resolveSwmmInvocation(BIN, deps({ errorCode: "ENOENT", loader: true }));
    expect(retry?.cmd).toBe(BUNDLED_LOADER);
    expect(loaderChoiceCache.get(BIN)).toBe(true);
  });

  it("uses the cached decision without re-probing", () => {
    let probeCalls = 0;
    const d: InvocationDeps = {
      probe: () => { probeCalls++; return { error: errnoError("ENOENT") }; },
      loaderExists: () => true,
    };
    resolveSwmmInvocation(BIN, d);
    resolveSwmmInvocation(BIN, d);
    expect(probeCalls).toBe(1);
  });

  it("treats ETIMEDOUT as direct execution (never the loader)", () => {
    const inv = resolveSwmmInvocation(BIN, deps({ errorCode: "ETIMEDOUT" }));
    expect(inv).toEqual({ cmd: BIN, argsPrefix: [] });
  });
});
