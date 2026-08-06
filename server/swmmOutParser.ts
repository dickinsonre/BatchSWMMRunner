import fs from "fs";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

// Canonical parser is a plain-JS UMD file shared with the browser WASM worker.
// In development it lives in client/public/wasm; production builds copy the
// public dir to dist/public.
function resolveParserPath(): string {
  const candidates = [
    path.join(process.cwd(), "client", "public", "wasm", "swmm-out-parser.js"),
    path.join(process.cwd(), "dist", "public", "wasm", "swmm-out-parser.js"),
    path.join(process.cwd(), "public", "wasm", "swmm-out-parser.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("swmm-out-parser.js not found in any known location");
}

const loaded = require(resolveParserPath());
const { parseSwmmOutBinary, reportHasTimeSeries } = (loaded && loaded.parseSwmmOutBinary
  ? loaded
  : (globalThis as any).SwmmOutParser) as {
  parseSwmmOutBinary: (bytes: Uint8Array) => string;
  reportHasTimeSeries: (rptText: string) => boolean;
};

export { reportHasTimeSeries };

/**
 * Parse a SWMM binary .out file into rpt-style time-series text sections.
 * Returns '' when the file is missing, invalid, or contains no results.
 */
export function parseSwmmOutputBinary(outPath: string): string {
  try {
    if (!fs.existsSync(outPath)) return "";
    const buf = fs.readFileSync(outPath);
    return parseSwmmOutBinary(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  } catch (e) {
    console.warn(`Could not parse SWMM output binary: ${outPath}`, e);
    return "";
  }
}
