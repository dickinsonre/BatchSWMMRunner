import { describe, it, expect } from "vitest";
import { normalizeInpNameCase } from "../shared/inpCaseNormalize";

const model = `[TITLE]
BOUNDARY@1020 mentioned here should not change

[OPTIONS]
FLOW_ROUTING         DYNWAVE

[JUNCTIONS]
J1               100        4          0          0          0

[OUTFALLS]
OF1020           87.00      TIMESERIES BOUNDARY@1020    NO
O2               95         FREE                        NO

[CONDUITS]
C1               J1               OF1020           400        0.013      0          0          0          0

[TIMESERIES]
Boundary@1020    0:00       97.3
Boundary@1020    12:00      97.5
`;

describe("normalizeInpNameCase", () => {
  it("rewrites case-variant references to the defined spelling", () => {
    const res = normalizeInpNameCase(model);
    expect(res.content).toContain("TIMESERIES Boundary@1020");
    expect(res.content).not.toContain("BOUNDARY@1020    NO");
    expect(res.fixes).toEqual(["BOUNDARY@1020 -> Boundary@1020"]);
  });

  it("leaves TITLE and OPTIONS sections untouched", () => {
    const res = normalizeInpNameCase(model);
    expect(res.content).toContain("BOUNDARY@1020 mentioned here should not change");
    expect(res.content).toContain("FLOW_ROUTING         DYNWAVE");
  });

  it("returns identical content and no fixes when everything matches", () => {
    const clean = model.replaceAll("BOUNDARY@1020", "Boundary@1020");
    const res = normalizeInpNameCase(clean);
    expect(res.fixes).toEqual([]);
    expect(res.content).toBe(clean);
  });

  it("preserves column alignment (case-only changes keep length)", () => {
    const res = normalizeInpNameCase(model);
    const before = model.split("\n").find((l) => l.startsWith("OF1020"))!;
    const after = res.content.split("\n").find((l) => l.startsWith("OF1020"))!;
    expect(after.length).toBe(before.length);
  });

  it("does not touch trailing comments", () => {
    const withComment = model.replace(
      "OF1020           87.00      TIMESERIES BOUNDARY@1020    NO",
      "OF1020           87.00      TIMESERIES BOUNDARY@1020    NO ; keep BOUNDARY@1020 text",
    );
    const res = normalizeInpNameCase(withComment);
    expect(res.content).toContain("; keep BOUNDARY@1020 text");
  });

  it("counts multiple rewrites of the same name", () => {
    const twice = model + "\n[INFLOWS]\nJ1  FLOW  BOUNDARY@1020  FLOW  1.0  1.0\n";
    const res = normalizeInpNameCase(twice);
    expect(res.fixes).toEqual(["BOUNDARY@1020 -> Boundary@1020 (2 places)"]);
  });

  it("keeps per-type namespaces: a node sharing a series' folded name is untouched", () => {
    const collide = `[JUNCTIONS]
BOUNDARY@1020    100        4          0          0          0

[OUTFALLS]
OF1              87.00      TIMESERIES BOUNDARY@1020    NO

[CONDUITS]
C1               BOUNDARY@1020    OF1    400   0.013  0  0  0  0

[TIMESERIES]
Boundary@1020    0:00       97.3
`;
    const res = normalizeInpNameCase(collide);
    // Node definition and its conduit reference keep their own spelling…
    expect(res.content).toContain("BOUNDARY@1020    100");
    expect(res.content).toContain("C1               BOUNDARY@1020");
    // …while the time-series reference is fixed.
    expect(res.content).toContain("TIMESERIES Boundary@1020");
  });

  it("does not rewrite FILE paths in raingages or timeseries data", () => {
    const withFile = `[RAINGAGES]
RG1    INTENSITY 1:00  1.0  FILE  RAIN.DAT  STA1  IN

[TIMESERIES]
rain.dat  FILE  "other.dat"
`;
    const res = normalizeInpNameCase(withFile);
    expect(res.content).toContain("FILE  RAIN.DAT");
  });

  it("fixes tidal curve, pump curve, and DWF pattern references", () => {
    const multi = `[OUTFALLS]
OF1   87.0   TIDAL   TIDECURVE   NO

[PUMPS]
P1    N1     N2      pump1   ON

[DWF]
N1    FLOW   1.0     WEEKDAY

[CURVES]
TideCurve   Tidal   0   97
Pump1       Pump1   0   5

[PATTERNS]
Weekday     HOURLY  1 1 1 1 1 1
`;
    const res = normalizeInpNameCase(multi);
    expect(res.content).toContain("TIDAL   TideCurve");
    expect(res.content).toContain("N2      Pump1");
    expect(res.content).toContain("1.0     Weekday");
  });

  it("unifies mixed-case definition lines of the same series", () => {
    const mixed = `[TIMESERIES]
TS1    0:00   1.0
ts1    1:00   2.0
`;
    const res = normalizeInpNameCase(mixed);
    expect(res.content).toContain("TS1    0:00");
    expect(res.content).toContain("TS1    1:00");
    expect(res.content).not.toContain("ts1");
  });
});
