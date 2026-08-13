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

  it("fixes case-variant transect references in [XSECTIONS] IRREGULAR", () => {
    const inp = `[XSECTIONS]
C1    IRREGULAR    FLOODWAY1    0  0  0
C2    CUSTOM       10   ShapeC   0

[TRANSECTS]
NC 0.015 0.015 0.015
X1 Floodway1  8  100  200
GR 10 0  8 50  6 100  8 150  10 200

[CURVES]
ShapeC   Shape   0.0  1.0
`;
    const res = normalizeInpNameCase(inp);
    expect(res.content).toContain("C1    IRREGULAR    Floodway1");
    expect(res.fixes).toEqual(["FLOODWAY1 -> Floodway1"]);
    // The transect definition itself stays untouched.
    expect(res.content).toContain("X1 Floodway1  8  100  200");
  });

  it("fixes node and link names in [CONTROLS] rules without touching anything else", () => {
    const inp = `[JUNCTIONS]
Node@A     100   4   0   0   0

[PUMPS]
Pump1      Node@A   OF1   PCURVE1   ON

[CONTROLS]
RULE R1
IF NODE NODE@A DEPTH > 3.5
AND LINK pump1 FLOW > 0
THEN PUMP PUMP1 STATUS = ON
PRIORITY 1

[CURVES]
PCurve1   Pump1   0   5
`;
    const res = normalizeInpNameCase(inp);
    expect(res.content).toContain("IF NODE Node@A DEPTH > 3.5");
    expect(res.content).toContain("AND LINK Pump1 FLOW > 0");
    expect(res.content).toContain("THEN PUMP Pump1 STATUS = ON");
    // Rule name, keywords, values untouched.
    expect(res.content).toContain("RULE R1");
    expect(res.content).toContain("PRIORITY 1");
    // The pump's own curve reference is fixed too (per-type namespaces).
    expect(res.content).toContain("Node@A   OF1   PCurve1");
    // Definitions untouched.
    expect(res.content).toContain("Node@A     100");
    expect(res.content).toContain("Pump1      Node@A");
  });

  it("keeps node/link/curve namespaces separate in CONTROLS", () => {
    const inp = `[JUNCTIONS]
Shared     100   4   0   0   0

[CONDUITS]
SHARED     Shared   OF1   400   0.013  0  0  0  0

[CONTROLS]
RULE R1
IF NODE shared DEPTH > 1
AND LINK shared FLOW > 0
THEN CONDUIT SHARED STATUS = CLOSED
`;
    const res = normalizeInpNameCase(inp);
    // NODE ref takes the junction spelling; LINK/CONDUIT refs take the conduit spelling.
    expect(res.content).toContain("IF NODE Shared DEPTH > 1");
    expect(res.content).toContain("AND LINK SHARED FLOW > 0");
    expect(res.content).toContain("THEN CONDUIT SHARED STATUS = CLOSED");
  });

  it("fixes hydrograph, snow pack, LID, and aquifer references", () => {
    const inp = `[SUBCATCHMENTS]
S1   RG1   J1   5   25   500   0.5   0   SNOWPLOW

[RDII]
J1   uh1   12500

[GROUNDWATER]
S1   AQ1   J1   90   0   0   0   0   0   0

[LID_USAGE]
S1   raingarden   1   500   100   0   0   0

[HYDROGRAPHS]
UH1   RG1
UH1   JAN  SHORT  0.033  1.0  2.0

[SNOWPACKS]
SnowPlow   PLOWABLE   0.005  0.007  32  0.10  0.00  0.0  0.2

[LID_CONTROLS]
RainGarden   BC
RainGarden   SURFACE   6  0.25  0.1  1.0  5

[AQUIFERS]
Aq1   0.5  0.28  0.23  0.05  10  2.0  0.001  0.05  4.0  3.0
`;
    const res = normalizeInpNameCase(inp);
    expect(res.content).toContain("500   0.5   0   SnowPlow");
    expect(res.content).toContain("J1   UH1   12500");
    expect(res.content).toContain("S1   Aq1   J1");
    expect(res.content).toContain("S1   RainGarden   1");
    // Definitions keep their first-seen spelling.
    expect(res.content).toContain("SnowPlow   PLOWABLE");
    expect(res.content).toContain("Aq1   0.5");
  });

  it("does not corrupt subcatchment lines without a snow pack column", () => {
    const inp = `[SUBCATCHMENTS]
S1   RG1   J1   5   25   500   0.5   0

[SNOWPACKS]
s1   PLOWABLE   0.005  0.007  32  0.10  0.00  0.0  0.2
`;
    const res = normalizeInpNameCase(inp);
    // No 9th column: nothing to rewrite even though a snowpack folds to "S1".
    expect(res.content).toContain("S1   RG1   J1   5   25   500   0.5   0");
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
