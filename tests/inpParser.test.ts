import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseInpFile } from "../client/src/lib/inpParser";

const validInp = fs.readFileSync(path.join(__dirname, "fixtures", "valid-model.inp"), "utf-8");

describe("parseInpFile", () => {
  it("parses title and options", () => {
    const p = parseInpFile(validInp);
    expect(p.title).toBe("Minimal valid test model");
    expect(p.options.flowUnits).toBe("CFS");
    expect(p.options.routingMethod).toBe("KINWAVE");
    expect(p.options.infiltrationMethod).toBe("HORTON");
  });

  it("parses element sections and counts", () => {
    const p = parseInpFile(validInp);
    expect(p.counts.junctions).toBe(1);
    expect(p.counts.outfalls).toBe(1);
    expect(p.counts.conduits).toBe(1);
    expect(p.counts.subcatchments).toBe(1);
    expect(p.counts.raingages).toBe(1);

    expect(p.junctions[0]).toMatchObject({ name: "J1", elevation: 100, maxDepth: 4 });
    expect(p.outfalls[0]).toMatchObject({ name: "O1", elevation: 95, type: "FREE" });
    expect(p.conduits[0]).toMatchObject({ name: "C1", from: "J1", to: "O1", length: 400, roughness: 0.013 });
    expect(p.subcatchments[0]).toMatchObject({ name: "S1", rainGage: "RG1", outlet: "J1", area: 5, percentImperv: 50 });
  });

  it("parses xsections keeping geom1 as a string", () => {
    const p = parseInpFile(validInp);
    expect(p.xsections[0]).toEqual({
      link: "C1",
      shape: "CIRCULAR",
      geom1: "1.5",
      geom2: 0,
      geom3: 0,
      geom4: 0,
      barrels: 1,
    });
  });

  it("parses coordinates", () => {
    const p = parseInpFile(validInp);
    expect(p.coordinates).toEqual([
      { node: "J1", x: 0, y: 0 },
      { node: "O1", x: 100, y: 0 },
    ]);
  });

  it("skips comment lines and handles missing sections", () => {
    const p = parseInpFile("[JUNCTIONS]\n;;comment line\nJ9 10 2\n");
    expect(p.junctions).toHaveLength(1);
    expect(p.junctions[0].name).toBe("J9");
    expect(p.outfalls).toEqual([]);
    expect(p.title).toBe("");
    expect(p.options.flowUnits).toBe("");
  });

  it("groups polygon vertices by subcatchment", () => {
    const p = parseInpFile("[POLYGONS]\nS1 0 0\nS1 10 0\nS1 10 10\nS2 5 5\n");
    expect(p.polygons).toHaveLength(2);
    expect(p.polygons[0].subcatchment).toBe("S1");
    expect(p.polygons[0].vertices).toHaveLength(3);
    expect(p.polygons[1].vertices).toEqual([{ x: 5, y: 5 }]);
  });
});
