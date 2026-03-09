import type { ParsedInpFile, ConduitData, JunctionData, XSectionData, CoordinateData, LossData } from './inpParser';

export type DiscretizationMethod = 'fixed_interval' | 'dx_d_ratio';

export interface ReswmmConfig {
  method: DiscretizationMethod;
  fixedMinLength: number;
  fixedMaxLength: number;
  dxDRatio: number;
  mnsa: number;
  lengtheningEnabled: boolean;
  lengtheningStep: number;
}

export const DEFAULT_RESWMM_CONFIG: ReswmmConfig = {
  method: 'fixed_interval',
  fixedMinLength: 50,
  fixedMaxLength: 200,
  dxDRatio: 5,
  mnsa: 12.566,
  lengtheningEnabled: false,
  lengtheningStep: 0,
};

export interface DiscretizationStats {
  originalConduitCount: number;
  newConduitCount: number;
  splitCount: number;
  newJunctionCount: number;
  method: string;
  lengtheningCount: number;
  lengtheningTotalAdded: number;
}

export interface DiscretizedResult {
  newConduits: ConduitData[];
  newJunctions: JunctionData[];
  newXSections: XSectionData[];
  newCoordinates: CoordinateData[];
  newLosses: LossData[];
  stats: DiscretizationStats;
}

export interface CflAnalysis {
  conduitName: string;
  length: number;
  diameter: number;
  standardTimeStep: number;
  conservativeTimeStep: number;
}

export function computeCflAnalysis(parsed: ParsedInpFile): CflAnalysis[] {
  const xsMap = new Map<string, XSectionData>();
  for (const xs of parsed.xsections) {
    xsMap.set(xs.link, xs);
  }

  const isUS = parsed.options.flowUnits === 'CFS' || parsed.options.flowUnits === 'GPM' || parsed.options.flowUnits === 'MGD';
  const g = isUS ? 32.174 : 9.81;

  return parsed.conduits.map(c => {
    const xs = xsMap.get(c.name);
    const diameter = xs ? (parseFloat(xs.geom1) || 1) : 1;
    const celerity = Math.sqrt(g * diameter);
    const standardTs = celerity > 0 ? c.length / celerity : 999;
    return {
      conduitName: c.name,
      length: c.length,
      diameter,
      standardTimeStep: standardTs,
      conservativeTimeStep: standardTs * 0.10,
    };
  });
}

export function discretizeConduits(parsed: ParsedInpFile, config: ReswmmConfig): DiscretizedResult {
  const xsMap = new Map<string, XSectionData>();
  for (const xs of parsed.xsections) {
    xsMap.set(xs.link, xs);
  }

  const coordMap = new Map<string, CoordinateData>();
  for (const c of parsed.coordinates) {
    coordMap.set(c.node, c);
  }

  const junctionMap = new Map<string, JunctionData>();
  for (const j of parsed.junctions) {
    junctionMap.set(j.name, j);
  }
  for (const o of parsed.outfalls) {
    junctionMap.set(o.name, { name: o.name, elevation: o.elevation, maxDepth: 0, initDepth: 0, surDepth: 0, aponded: 0 });
  }
  for (const s of parsed.storage) {
    junctionMap.set(s.name, { name: s.name, elevation: s.elevation, maxDepth: s.maxDepth, initDepth: s.initDepth, surDepth: 0, aponded: 0 });
  }

  const lossMap = new Map<string, LossData>();
  for (const l of parsed.losses) {
    lossMap.set(l.link, l);
  }

  let lengtheningCount = 0;
  let lengtheningTotalAdded = 0;

  const isUS = parsed.options.flowUnits === 'CFS' || parsed.options.flowUnits === 'GPM' || parsed.options.flowUnits === 'MGD';
  const g = isUS ? 32.174 : 9.81;

  const workingConduits: ConduitData[] = parsed.conduits.map(c => ({ ...c }));

  if (config.lengtheningEnabled && config.lengtheningStep > 0) {
    for (const conduit of workingConduits) {
      const xs = xsMap.get(conduit.name);
      const diameter = xs ? (parseFloat(xs.geom1) || 1) : 1;
      const celerity = Math.sqrt(g * diameter);
      const minLength = +(celerity * config.lengtheningStep).toFixed(2);
      if (conduit.length < minLength) {
        const added = minLength - conduit.length;
        lengtheningTotalAdded += added;
        conduit.length = minLength;
        lengtheningCount++;
      }
    }
  }

  const newConduits: ConduitData[] = [];
  const newJunctions: JunctionData[] = [];
  const newXSections: XSectionData[] = [];
  const newCoordinates: CoordinateData[] = [];
  const newLosses: LossData[] = [];
  let splitCount = 0;
  let newJunctionCount = 0;

  for (const conduit of workingConduits) {
    const xs = xsMap.get(conduit.name);
    const diameter = xs ? (parseFloat(xs.geom1) || 1) : 1;

    let targetLen: number;
    if (config.method === 'fixed_interval') {
      targetLen = Math.min(config.fixedMaxLength, Math.max(config.fixedMinLength, conduit.length));
    } else {
      targetLen = Math.max(1, diameter * config.dxDRatio);
    }

    const nSeg = Math.max(1, Math.ceil(conduit.length / targetLen));

    if (nSeg <= 1) {
      newConduits.push(conduit);
      if (xs) newXSections.push(xs);
      const loss = lossMap.get(conduit.name);
      if (loss) newLosses.push(loss);
      continue;
    }

    splitCount++;
    const segLen = +(conduit.length / nSeg).toFixed(2);

    const fromNode = junctionMap.get(conduit.from);
    const toNode = junctionMap.get(conduit.to);
    const fromCoord = coordMap.get(conduit.from);
    const toCoord = coordMap.get(conduit.to);
    const loss = lossMap.get(conduit.name);

    if (!fromNode || !toNode) {
      newConduits.push(conduit);
      if (xs) newXSections.push(xs);
      if (loss) newLosses.push(loss);
      continue;
    }

    const fromElev = fromNode.elevation;
    const toElev = toNode.elevation;
    let prevNodeName = conduit.from;

    for (let s = 0; s < nSeg; s++) {
      const isLast = s === nSeg - 1;
      let nextNodeName: string;

      if (isLast) {
        nextNodeName = conduit.to;
      } else {
        const frac = (s + 1) / nSeg;
        nextNodeName = `${conduit.name}_N${s + 1}`;

        const interpElev = +(fromElev + (toElev - fromElev) * frac).toFixed(3);
        const maxD = fromNode.maxDepth || 6;
        const mnsaPonded = Math.round(config.mnsa);

        const newJunction: JunctionData = {
          name: nextNodeName,
          elevation: interpElev,
          maxDepth: +maxD.toFixed(2),
          initDepth: 0,
          surDepth: 0,
          aponded: mnsaPonded,
        };
        newJunctions.push(newJunction);
        junctionMap.set(nextNodeName, newJunction);

        if (fromCoord && toCoord) {
          const interpX = +(fromCoord.x + (toCoord.x - fromCoord.x) * frac).toFixed(2);
          const interpY = +(fromCoord.y + (toCoord.y - fromCoord.y) * frac).toFixed(2);
          newCoordinates.push({ node: nextNodeName, x: interpX, y: interpY });
          coordMap.set(nextNodeName, { node: nextNodeName, x: interpX, y: interpY });
        }

        newJunctionCount++;
      }

      const segName = `${conduit.name}_${s + 1}`;
      newConduits.push({
        name: segName,
        from: prevNodeName,
        to: nextNodeName,
        length: segLen,
        roughness: conduit.roughness,
        inOffset: s === 0 ? conduit.inOffset : 0,
        outOffset: isLast ? conduit.outOffset : 0,
        initFlow: 0,
        maxFlow: 0,
      });

      if (xs) {
        newXSections.push({
          link: segName,
          shape: xs.shape,
          geom1: xs.geom1,
          geom2: xs.geom2,
          geom3: xs.geom3,
          geom4: xs.geom4,
          barrels: xs.barrels,
        });
      }

      if (loss) {
        newLosses.push({
          link: segName,
          entry: s === 0 ? loss.entry : 0,
          exit: isLast ? loss.exit : 0,
          average: loss.average / nSeg,
        });
      }

      prevNodeName = nextNodeName;
    }
  }

  return {
    newConduits,
    newJunctions,
    newXSections,
    newCoordinates,
    newLosses,
    stats: {
      originalConduitCount: parsed.conduits.length,
      newConduitCount: newConduits.length,
      splitCount,
      newJunctionCount,
      method: config.method,
      lengtheningCount,
      lengtheningTotalAdded: +lengtheningTotalAdded.toFixed(2),
    },
  };
}

export function rebuildInpFile(originalContent: string, parsed: ParsedInpFile, result: DiscretizedResult, config: ReswmmConfig): string {
  const lines = originalContent.split('\n');
  const sections: { name: string; startLine: number; endLine: number }[] = [];
  let currentSection: { name: string; startLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      if (currentSection) {
        sections.push({ ...currentSection, endLine: i });
      }
      currentSection = { name: sectionMatch[1].toUpperCase(), startLine: i };
    }
  }
  if (currentSection) {
    sections.push({ ...currentSection, endLine: lines.length });
  }

  const sectionMap = new Map<string, { startLine: number; endLine: number }>();
  for (const s of sections) {
    sectionMap.set(s.name, { startLine: s.startLine, endLine: s.endLine });
  }

  const methodDesc = config.method === 'fixed_interval'
    ? `Fixed Interval (${config.fixedMinLength}-${config.fixedMaxLength})`
    : `dx/D Ratio (${config.dxDRatio})`;

  function buildJunctionLines(): string[] {
    const out: string[] = [];
    out.push('[JUNCTIONS]');
    out.push(';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded   ');
    out.push(';;-------------- ---------- ---------- ---------- ---------- ----------');
    for (const j of parsed.junctions) {
      out.push(`${j.name.padEnd(17)}${j.elevation.toString().padEnd(11)}${j.maxDepth.toString().padEnd(11)}${(j.initDepth || 0).toString().padEnd(11)}${(j.surDepth || 0).toString().padEnd(11)}${j.aponded || 0}`);
    }
    for (const j of result.newJunctions) {
      out.push(`${j.name.padEnd(17)}${j.elevation.toString().padEnd(11)}${j.maxDepth.toString().padEnd(11)}${(j.initDepth || 0).toString().padEnd(11)}${(j.surDepth || 0).toString().padEnd(11)}${j.aponded || 0}`);
    }
    out.push('');
    return out;
  }

  function buildConduitLines(): string[] {
    const out: string[] = [];
    out.push('[CONDUITS]');
    out.push(';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow   ');
    out.push(';;-------------- ---------------- ---------------- ---------- ---------- ---------- ---------- ---------- ----------');
    for (const c of result.newConduits) {
      out.push(`${c.name.padEnd(17)}${c.from.padEnd(17)}${c.to.padEnd(17)}${c.length.toString().padEnd(11)}${c.roughness.toString().padEnd(11)}${c.inOffset.toString().padEnd(11)}${c.outOffset.toString().padEnd(11)}${c.initFlow.toString().padEnd(11)}${c.maxFlow}`);
    }
    out.push('');
    return out;
  }

  function buildXSectionLines(): string[] {
    const conduitNames = new Set(result.newConduits.map(c => c.name));
    const originalConduitNames = new Set(parsed.conduits.map(c => c.name));
    const nonConduitXSections = parsed.xsections.filter(xs =>
      !conduitNames.has(xs.link) && !originalConduitNames.has(xs.link)
    );

    const out: string[] = [];
    out.push('[XSECTIONS]');
    out.push(';;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels    Culvert   ');
    out.push(';;-------------- ------------ ---------------- ---------- ---------- ---------- ---------- ----------');
    for (const xs of result.newXSections) {
      const shapePad = Math.max(13, xs.shape.length + 1);
      out.push(`${xs.link.padEnd(17)}${xs.shape.padEnd(shapePad)}${xs.geom1.toString().padEnd(17)}${xs.geom2.toString().padEnd(11)}${xs.geom3.toString().padEnd(11)}${xs.geom4.toString().padEnd(11)}${xs.barrels}`);
    }
    for (const xs of nonConduitXSections) {
      const shapePad = Math.max(13, xs.shape.length + 1);
      out.push(`${xs.link.padEnd(17)}${xs.shape.padEnd(shapePad)}${xs.geom1.toString().padEnd(17)}${xs.geom2.toString().padEnd(11)}${xs.geom3.toString().padEnd(11)}${xs.geom4.toString().padEnd(11)}${xs.barrels}`);
    }
    out.push('');
    return out;
  }

  function buildCoordinateLines(): string[] {
    const out: string[] = [];
    out.push('[COORDINATES]');
    out.push(';;Node           X-Coord            Y-Coord           ');
    out.push(';;-------------- ------------------ ------------------');
    for (const c of parsed.coordinates) {
      out.push(`${c.node.padEnd(17)}${c.x.toString().padEnd(19)}${c.y}`);
    }
    for (const c of result.newCoordinates) {
      out.push(`${c.node.padEnd(17)}${c.x.toString().padEnd(19)}${c.y}`);
    }
    out.push('');
    return out;
  }

  function buildLossLines(): string[] {
    const out: string[] = [];
    out.push('[LOSSES]');
    out.push(';;Link           Kentry     Kexit      Kavg       Flap Gate  Seepage   ');
    out.push(';;-------------- ---------- ---------- ---------- ---------- ----------');
    for (const l of result.newLosses) {
      out.push(`${l.link.padEnd(17)}${l.entry.toString().padEnd(11)}${l.exit.toString().padEnd(11)}${l.average}`);
    }
    out.push('');
    return out;
  }

  const outputLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      const sName = sectionMatch[1].toUpperCase();
      const sInfo = sectionMap.get(sName);

      if (sName === 'TITLE') {
        outputLines.push(lines[i]);
        i++;
        outputLines.push(`;;ReSWMM Discretization: ${methodDesc}, MNSA=${config.mnsa}`);
        while (i < (sInfo?.endLine || lines.length)) {
          const nextTrimmed = lines[i].trim();
          if (nextTrimmed.match(/^\[/)) break;
          outputLines.push(lines[i]);
          i++;
        }
        continue;
      }

      if (sName === 'OPTIONS' && sInfo) {
        const optionLines: string[] = [];
        let hasLengthening = false;
        for (let li = sInfo.startLine; li < sInfo.endLine; li++) {
          const optLine = lines[li];
          const optParts = optLine.trim().split(/\s+/).filter(Boolean);
          if (optParts.length >= 1 && optParts[0].toUpperCase() === 'LENGTHENING_STEP') {
            hasLengthening = true;
            if (config.lengtheningEnabled && config.lengtheningStep > 0) {
              optionLines.push(`LENGTHENING_STEP  ${config.lengtheningStep}`);
            }
          } else {
            optionLines.push(optLine);
          }
        }
        if (!hasLengthening && config.lengtheningEnabled && config.lengtheningStep > 0) {
          const insertIdx = optionLines.length;
          optionLines.splice(insertIdx, 0, `LENGTHENING_STEP  ${config.lengtheningStep}`);
        }
        outputLines.push(...optionLines);
        i = sInfo.endLine;
        continue;
      }

      if (sName === 'JUNCTIONS' && sInfo) {
        outputLines.push(...buildJunctionLines());
        i = sInfo.endLine;
        continue;
      }

      if (sName === 'CONDUITS' && sInfo) {
        outputLines.push(...buildConduitLines());
        i = sInfo.endLine;
        continue;
      }

      if (sName === 'XSECTIONS' && sInfo) {
        outputLines.push(...buildXSectionLines());
        i = sInfo.endLine;
        continue;
      }

      if (sName === 'COORDINATES' && sInfo) {
        outputLines.push(...buildCoordinateLines());
        i = sInfo.endLine;
        continue;
      }

      if (sName === 'LOSSES' && sInfo) {
        outputLines.push(...buildLossLines());
        i = sInfo.endLine;
        continue;
      }
    }

    outputLines.push(lines[i]);
    i++;
  }

  return outputLines.join('\n');
}
