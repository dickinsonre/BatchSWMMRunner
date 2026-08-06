import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { spawnSync } from "child_process";
import { resolveSwmmInvocation } from "../server/swmmInvocation";
import { parseSwmmOutputBinary, reportHasTimeSeries } from "../server/swmmOutParser";

const RUNSWMM = path.join(process.cwd(), "swmm-engine", "runswmm");
const SAMPLE_INP = path.join(process.cwd(), "attached_assets", "extran2_1785798280496.inp");

describe("swmmOutParser", () => {
  let outPath = "";
  let rptPath = "";

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swmm-out-"));
    const inp = path.join(dir, "model.inp");
    fs.copyFileSync(SAMPLE_INP, inp);
    rptPath = inp + ".rpt";
    outPath = inp + ".out";
    const inv = resolveSwmmInvocation(RUNSWMM);
    if (!inv) throw new Error("SWMM executable cannot run in this environment");
    const r = spawnSync(inv.cmd, [...inv.argsPrefix, inp, rptPath, outPath], { timeout: 60000 });
    expect(r.status).toBe(0);
  });

  it("executable-mode rpt has no time series (the bug this fixes)", () => {
    const rpt = fs.readFileSync(rptPath, "utf-8");
    expect(reportHasTimeSeries(rpt)).toBe(false);
  });

  it("parses the binary .out into rpt-style time-series sections", () => {
    const ts = parseSwmmOutputBinary(outPath);
    expect(ts.length).toBeGreaterThan(1000);
    expect(ts).toContain("Node Results Time Series");
    expect(ts).toContain("Link Results Time Series");
    expect(ts).toContain("System Results Time Series");
    expect(ts).toContain("<<<");
    expect(reportHasTimeSeries(ts)).toBe(true);
  });

  it("emits headers whose columns split on 2+ spaces and match data-row width", () => {
    const ts = parseSwmmOutputBinary(outPath);
    const lines = ts.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/<<<\s*(.*?)\s*>>>/.test(lines[i])) continue;
      // element marker; skip blanks to header
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const header = lines[j];
      expect(/\bDate\b/.test(header)).toBe(true);
      const cols = header.trim().split(/\s{2,}/).filter((c) => c && c !== "Date" && c !== "Time");
      // units line
      const units = lines[j + 1].trim().split(/\s{2,}/).filter((u) => u && u !== "Day" && u !== "Hour:Min");
      expect(units.length).toBe(cols.length);
      // first data row after dashed line
      let k = j + 2;
      while (k < lines.length && /^\s*-{3,}/.test(lines[k])) k++;
      const parts = lines[k].trim().split(/\s+/);
      // Date + Time + one value per column
      expect(parts.length).toBe(cols.length + 2);
    }
  });

  it("long System column names stay separated (no merged headers)", () => {
    const ts = parseSwmmOutputBinary(outPath);
    const sysIdx = ts.indexOf("System Results Time Series");
    const section = ts.slice(sysIdx);
    const headerLine = section.split("\n").find((l) => /\bDate\b/.test(l))!;
    const cols = headerLine.trim().split(/\s{2,}/);
    expect(cols).toContain("Dry Weather Inflow");
    expect(cols).toContain("Total Lateral Inflow");
    expect(cols).toContain("Flooding");
  });

  it("returns empty string for missing or invalid files", () => {
    expect(parseSwmmOutputBinary("/nonexistent/file.out")).toBe("");
    const bad = path.join(os.tmpdir(), "bad.out");
    fs.writeFileSync(bad, Buffer.alloc(100));
    expect(parseSwmmOutputBinary(bad)).toBe("");
  });
});
