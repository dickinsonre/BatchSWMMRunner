import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { spawnSync } from "child_process";
import { resolveSwmmInvocation } from "../server/swmmInvocation";
import { parseSwmmOutputBinary, reportHasTimeSeries } from "../server/swmmOutParser";
import {
  parseTimeSeries,
  parseTimeSeriesTruncation,
} from "../client/src/lib/parseTimeSeries";
import { calculateBillJamesModelScore } from "../client/src/lib/billJamesModelScore";

const RUNSWMM = path.join(process.cwd(), "swmm-engine", "runswmm");
const SAMPLE_INP = path.join(process.cwd(), "attached_assets", "extran2_1785798280496.inp");

function makePollutantOut(): Buffer {
  const chunks: Buffer[] = [];
  const int = (value: number) => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value);
    chunks.push(buf);
  };
  const float = (value: number) => {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value);
    chunks.push(buf);
  };
  const double = (value: number) => {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value);
    chunks.push(buf);
  };
  const id = (value: string) => {
    const buf = Buffer.from(value);
    int(buf.length);
    chunks.push(buf);
  };
  const offset = () => chunks.reduce((total, chunk) => total + chunk.length, 0);

  // Fixed header: magic, version, flow units, object counts, pollutant count.
  [516114522, 52000, 0, 1, 1, 1, 3].forEach(int);
  ["S1", "N1", "L1", "TSS", "Lead", "Bacteria"].forEach(id);
  [0, 1, 2].forEach(int); // mg/L, ug/L, counts/L

  const propStart = offset();
  // No input properties; variable-code arrays are present but not needed to
  // locate the values. Each object has its hydraulic columns plus 3 pollutants.
  [0, 0, 0].forEach(int);
  for (const count of [11, 9, 8, 0]) {
    int(count);
    for (let i = 0; i < count; i++) int(i);
  }
  double(43831);
  int(3600);
  const resultStart = offset();

  double(43831);
  for (let i = 1; i <= 28; i++) float(i);

  const idStart = 7 * 4;
  [idStart, propStart, resultStart, 1, 0, 516114522].forEach(int);
  return Buffer.concat(chunks);
}

function makeLongOut(numPeriods: number): Buffer {
  const chunks: Buffer[] = [];
  const int = (value: number) => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value);
    chunks.push(buf);
  };
  const float = (value: number) => {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value);
    chunks.push(buf);
  };
  const double = (value: number) => {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value);
    chunks.push(buf);
  };
  const offset = () => chunks.reduce((total, chunk) => total + chunk.length, 0);

  [516114522, 52000, 0, 0, 0, 1, 0].forEach(int);
  const idStart = offset();
  const linkId = Buffer.from("L1");
  int(linkId.length);
  chunks.push(linkId);

  const propStart = offset();
  [0, 0, 0].forEach(int);
  int(0);
  int(0);
  int(2);
  int(0);
  int(1);
  int(0);
  double(43831);
  int(900);
  const resultStart = offset();

  for (let period = 0; period < numPeriods; period++) {
    double(43831 + period / 96);
    float(period + 1);
    float((period + 1) / 10);
  }

  [idStart, propStart, resultStart, numPeriods, 0, 516114522].forEach(int);
  return Buffer.concat(chunks);
}

describe("swmmOutParser", () => {
  let outPath = "";
  let rptPath = "";
  let metricOutPath = "";

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

    const metricInp = path.join(dir, "metric-model.inp");
    metricOutPath = metricInp + ".out";
    fs.writeFileSync(
      metricInp,
      fs.readFileSync(SAMPLE_INP, "utf-8").replace(/FLOW_UNITS\s+CFS/, "FLOW_UNITS            CMS"),
    );
    const metric = spawnSync(inv.cmd, [...inv.argsPrefix, metricInp, metricInp + ".rpt", metricOutPath], { timeout: 60000 });
    expect(metric.status).toBe(0);
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

  it("preserves US-native flow, depth, velocity, and storage units from the binary header", () => {
    const parsed = parseTimeSeries(parseSwmmOutputBinary(outPath));
    const link = parsed.find(item => item.title.startsWith("Link"))!;
    const system = parsed.find(item => item.title.startsWith("System"))!;
    expect(link.units.slice(0, 4)).toEqual(["CFS", "ft", "ft/sec", "ft3"]);
    expect(system.units[system.columns.indexOf("Storage Volume")]).toBe("ft3");
  });

  it("preserves SI-native flow, depth, velocity, and storage units from the binary header", () => {
    const parsed = parseTimeSeries(parseSwmmOutputBinary(metricOutPath));
    const link = parsed.find(item => item.title.startsWith("Link"))!;
    const system = parsed.find(item => item.title.startsWith("System"))!;
    expect(link.units.slice(0, 4)).toEqual(["CMS", "m", "m/sec", "m3"]);
    expect(system.units[system.columns.indexOf("Storage Volume")]).toBe("m3");
  });

  it("uses pollutant names and native concentration units without shifting hydraulic columns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swmm-pollutants-"));
    const pollutantOut = path.join(dir, "pollutants.out");
    fs.writeFileSync(pollutantOut, makePollutantOut());

    const parsed = parseTimeSeries(parseSwmmOutputBinary(pollutantOut));
    for (const title of ["Subcatchment", "Node", "Link"]) {
      const series = parsed.find(item => item.title.startsWith(title))!;
      const pollutantStart = title === "Subcatchment" ? 8 : title === "Node" ? 6 : 5;
      expect(series.columns.slice(pollutantStart)).toEqual(["TSS", "Lead", "Bacteria"]);
      expect(series.units.slice(pollutantStart)).toEqual(["mg/L", "ug/L", "counts/L"]);
      expect(series.data[0].values).toHaveLength(series.columns.length);
      const expectedValues = title === "Subcatchment"
        ? [9, 10, 11]
        : title === "Node"
          ? [18, 19, 20]
          : [26, 27, 28];
      expect(series.data[0].values.slice(pollutantStart)).toEqual(expectedValues);
    }
  });

  it("withholds whole-model scoring when binary output exceeds the 2,000-period graph window", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swmm-long-output-"));
    const longOut = path.join(dir, "long.out");
    fs.writeFileSync(longOut, makeLongOut(2001));

    const report = parseSwmmOutputBinary(longOut);
    const truncation = parseTimeSeriesTruncation(report);
    expect(truncation).toEqual({ displayedPeriods: 2000, totalPeriods: 2001 });
    expect(parseTimeSeries(report)[0].data).toHaveLength(2000);

    const run = {
      status: "success",
      series: parseTimeSeries(report),
      seriesTruncation: truncation,
    };
    const result = calculateBillJamesModelScore(run, run);
    expect(result.score).toBeUndefined();
    expect(result.gateReasons[0]).toMatch(/truncated to 2000 of 2001 report periods/i);
  });

  it("returns empty string for missing or invalid files", () => {
    expect(parseSwmmOutputBinary("/nonexistent/file.out")).toBe("");
    const bad = path.join(os.tmpdir(), "bad.out");
    fs.writeFileSync(bad, Buffer.alloc(100));
    expect(parseSwmmOutputBinary(bad)).toBe("");
  });
});
