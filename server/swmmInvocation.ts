import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";

export const BUNDLED_LOADER = path.join(process.cwd(), "swmm-engine", "libs", "ld-linux-x86-64.so.2");
export const BUNDLED_LIB_DIR = path.join(process.cwd(), "swmm-engine", "libs");

export interface ProbeResult {
  error?: NodeJS.ErrnoException;
}

export interface InvocationDeps {
  probe: (binPath: string) => ProbeResult;
  loaderExists: () => boolean;
}

const defaultDeps: InvocationDeps = {
  // Use spawnSync WITHOUT a shell so a missing ELF interpreter (glibc loader)
  // surfaces as error.code === 'ENOENT', exactly like the real spawn() call
  // later. A shell-based probe (execSync) reports exit code 127 instead of
  // ENOENT, which made deployments wrongly believe the binary runs directly.
  probe: (binPath) => spawnSync(binPath, [], { timeout: 10000, stdio: "pipe" }),
  loaderExists: () => fs.existsSync(BUNDLED_LOADER),
};

export const loaderChoiceCache = new Map<string, boolean>();

export function canExecuteDirectly(binPath: string, deps: InvocationDeps = defaultDeps): boolean {
  const result = deps.probe(binPath);
  if (result.error) {
    const code = result.error.code;
    // A timeout means the process actually started and ran — it executes fine.
    if (code === "ETIMEDOUT") return true;
    // ENOENT (missing ELF interpreter) or EACCES: cannot run directly.
    return false;
  }
  // Non-zero exit (e.g. "Not Enough Arguments") still means it executed fine.
  return true;
}

// Returns the command + argument prefix needed to run the SWMM binary.
// If the binary's dynamic loader is missing (common in deployments where the
// dev-time /nix/store glibc path doesn't exist), fall back to the glibc
// loader + libs bundled in swmm-engine/libs/.
export function resolveSwmmInvocation(
  binPath: string,
  deps: InvocationDeps = defaultDeps,
): { cmd: string; argsPrefix: string[] } | null {
  let useLoader = loaderChoiceCache.get(binPath);
  if (useLoader === undefined) {
    if (canExecuteDirectly(binPath, deps)) {
      useLoader = false;
    } else if (deps.loaderExists()) {
      useLoader = true;
    } else {
      // Do NOT cache: caching false would mean "run direct" on retry, but we
      // just proved the binary can't run directly and no loader is available.
      return null;
    }
    loaderChoiceCache.set(binPath, useLoader);
    if (useLoader) {
      console.log(`SWMM binary ${binPath} needs bundled glibc loader (${BUNDLED_LOADER})`);
    }
  }
  if (useLoader) {
    return { cmd: BUNDLED_LOADER, argsPrefix: ["--library-path", BUNDLED_LIB_DIR, binPath] };
  }
  return { cmd: binPath, argsPrefix: [] };
}
