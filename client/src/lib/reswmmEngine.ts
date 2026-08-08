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
  /** SWMM6 only: emit generated split junctions as [VIRTUAL_JUNCTIONS]. */
  virtualJunctions: boolean;
  vjMomentum: 'FULL' | 'BASIC';
}

export const DEFAULT_RESWMM_CONFIG: ReswmmConfig = {
  method: 'fixed_interval',
  fixedMinLength: 50,
  fixedMaxLength: 200,
  dxDRatio: 5,
  mnsa: 12.566,
  lengtheningEnabled: false,
  lengtheningStep: 0,
  virtualJunctions: false,
  vjMomentum: 'FULL',
};

export interface DiscretizationStats {
  originalConduitCount: number;
  newConduitCount: number;
  splitCount: number;
  newJunctionCount: number;
  method: string;
  lengtheningCount: number;
  lengtheningTotalAdded: number;
  virtualJunctionCount: number;
}

export interface DiscretizedResult {
  newConduits: ConduitData[];
  newJunctions: JunctionData[];
  newXSections: XSectionData[];
  newCoordinates: CoordinateData[];
  newLosses: LossData[];
  /** Names of generated split junctions to emit as [VIRTUAL_JUNCTIONS] (SWMM6 only). */
  virtualJunctionNames: string[];
  stats: DiscretizationStats;
}

export interface CflAnalysis {
  conduitName: string;
  length: number;
  diameter: number;
  standardTimeStep: number;
  conservativeTimeStep: number;
}

/**
 * Effective hydraulic depth used for wave celerity (sqrt(g*D)) and dx/D sizing.
 * For circular pipes this is the diameter (geom1). For non-circular shapes we
 * use the full-flow hydraulic diameter Dh = 4A/P (or standard SWMM full-flow
 * hydraulic radius factors), instead of naively treating geom1 as a diameter.
 */
export function hydraulicDiameter(xs: XSectionData | undefined): number {
  if (!xs) return 1;
  const g1 = parseFloat(xs.geom1) || 0;
  const g2 = Number(xs.geom2) || 0;
  const shape = (xs.shape || '').toUpperCase();

  switch (shape) {
    case 'CIRCULAR':
    case 'FORCE_MAIN':
    case 'FILLED_CIRCULAR':
      return g1 > 0 ? g1 : 1;
    case 'RECT_CLOSED': {
      // geom1 = full height, geom2 = top width; Dh = 4A/P = 2HW/(H+W)
      if (g1 > 0 && g2 > 0) return (2 * g1 * g2) / (g1 + g2);
      return g1 > 0 ? g1 : 1;
    }
    case 'RECT_OPEN': {
      // Open channel at full depth: A = H*W, P = W + 2H, Dh = 4A/P
      if (g1 > 0 && g2 > 0) return (4 * g1 * g2) / (g2 + 2 * g1);
      return g1 > 0 ? g1 : 1;
    }
    case 'EGG':
      // SWMM full-flow hydraulic radius Rfull = 0.1931*H → Dh = 4R
      return g1 > 0 ? 4 * 0.1931 * g1 : 1;
    case 'HORSESHOE':
      // Rfull = 0.2538*H → Dh = 4R
      return g1 > 0 ? 4 * 0.2538 * g1 : 1;
    case 'GOTHIC':
      return g1 > 0 ? 4 * 0.2269 * g1 : 1;
    case 'CATENARY':
      return g1 > 0 ? 4 * 0.2337 * g1 : 1;
    case 'BASKETHANDLE':
      return g1 > 0 ? 4 * 0.2464 * g1 : 1;
    case 'SEMIELLIPTICAL':
      return g1 > 0 ? 4 * 0.2420 * g1 : 1;
    case 'SEMICIRCULAR':
      return g1 > 0 ? 4 * 0.2944 * g1 : 1;
    case 'ARCH': {
      // Approximate full-flow: A ≈ 0.7879*H*W, P ≈ perimeter of rounded-top box.
      // Use Dh = 4A/P with P approximated as W + 2H (conservative).
      if (g1 > 0 && g2 > 0) return (4 * 0.7879 * g1 * g2) / (g2 + 2 * g1);
      return g1 > 0 ? g1 : 1;
    }
    case 'HORIZ_ELLIPSE':
    case 'VERT_ELLIPSE': {
      // Ellipse: A = pi*a*b/... use Dh = 4A/P with Ramanujan perimeter approx
      if (g1 > 0 && g2 > 0) {
        const a = g1 / 2;
        const b = g2 / 2;
        const area = Math.PI * a * b;
        const h = ((a - b) ** 2) / ((a + b) ** 2);
        const perim = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
        return (4 * area) / perim;
      }
      return g1 > 0 ? g1 : 1;
    }
    default:
      // TRAPEZOIDAL, TRIANGULAR, PARABOLIC, POWER, IRREGULAR, DUMMY, etc.
      // fall back to full depth (geom1) as the characteristic depth.
      return g1 > 0 ? g1 : 1;
  }
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
    const diameter = hydraulicDiameter(xs);
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
      const diameter = hydraulicDiameter(xs);
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
  const virtualJunctionNames: string[] = [];
  const unsplittableShapes = new Set(['DUMMY', 'IRREGULAR']);

  for (const conduit of workingConduits) {
    const xs = xsMap.get(conduit.name);
    const diameter = hydraulicDiameter(xs);

    let targetLen: number;
    if (config.method === 'fixed_interval') {
      targetLen = Math.min(config.fixedMaxLength, Math.max(config.fixedMinLength, conduit.length));
    } else {
      targetLen = Math.max(1, diameter * config.dxDRatio);
    }

    const nSeg = Math.max(1, Math.ceil(conduit.length / targetLen));
    if (nSeg <= 1 || (xs && unsplittableShapes.has(xs.shape.toUpperCase()))) {
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
        // Generated split nodes always connect exactly two conduits and carry
        // no inflows/DWF — the SWMM6 virtual-junction eligibility criteria.
        if (config.virtualJunctions) virtualJunctionNames.push(nextNodeName);

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
    virtualJunctionNames,
    stats: {
      originalConduitCount: parsed.conduits.length,
      newConduitCount: newConduits.length,
      splitCount,
      newJunctionCount,
      method: config.method,
      lengtheningCount,
      lengtheningTotalAdded: +lengtheningTotalAdded.toFixed(2),
      virtualJunctionCount: virtualJunctionNames.length,
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

  const vjNames = new Set(config.virtualJunctions ? result.virtualJunctionNames : []);

  function buildJunctionLines(): string[] {
    const out: string[] = [];
    out.push('[JUNCTIONS]');
    out.push(';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded   ');
    out.push(';;-------------- ---------- ---------- ---------- ---------- ----------');
    for (const j of parsed.junctions) {
      out.push(`${padField(j.name, 17)}${padField(j.elevation, 17)}${padField(j.maxDepth, 11)}${padField(j.initDepth || 0, 11)}${padField(j.surDepth || 0, 11)}${j.aponded || 0}`);
    }
    for (const j of result.newJunctions) {
      if (vjNames.has(j.name)) continue;
      out.push(`${padField(j.name, 17)}${padField(j.elevation, 17)}${padField(j.maxDepth, 11)}${padField(j.initDepth || 0, 11)}${padField(j.surDepth || 0, 11)}${j.aponded || 0}`);
    }
    out.push('');
    // SWMM6 virtual junctions must be declared before the conduits that
    // reference them, so the section goes directly after [JUNCTIONS].
    // Format is name + invert ONLY — extra tokens are a parse error.
    if (vjNames.size > 0) {
      out.push('[VIRTUAL_JUNCTIONS]');
      out.push(';;Name           Elevation ');
      out.push(';;-------------- ----------');
      for (const j of result.newJunctions) {
        if (!vjNames.has(j.name)) continue;
        out.push(`${padField(j.name, 17)}${j.elevation}`);
      }
      out.push('');
    }
    return out;
  }

  function padField(val: string | number, width: number): string {
    const s = val.toString();
    return s.length >= width ? s + ' ' : s.padEnd(width);
  }

  function buildConduitLines(): string[] {
    const out: string[] = [];
    out.push('[CONDUITS]');
    out.push(';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow   ');
    out.push(';;-------------- ---------------- ---------------- ---------- ---------- ---------- ---------- ---------- ----------');
    for (const c of result.newConduits) {
      out.push(`${padField(c.name, 17)}${padField(c.from, 17)}${padField(c.to, 17)}${padField(c.length, 17)}${padField(c.roughness, 11)}${padField(c.inOffset, 11)}${padField(c.outOffset, 11)}${padField(c.initFlow, 11)}${c.maxFlow}`);
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
      out.push(`${padField(xs.link, 17)}${padField(xs.shape, Math.max(13, xs.shape.length + 1))}${padField(xs.geom1, 17)}${padField(xs.geom2, 11)}${padField(xs.geom3, 11)}${padField(xs.geom4, 11)}${xs.barrels}`);
    }
    for (const xs of nonConduitXSections) {
      out.push(`${padField(xs.link, 17)}${padField(xs.shape, Math.max(13, xs.shape.length + 1))}${padField(xs.geom1, 17)}${padField(xs.geom2, 11)}${padField(xs.geom3, 11)}${padField(xs.geom4, 11)}${xs.barrels}`);
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
      out.push(`${padField(c.node, 17)}${padField(c.x, 19)}${c.y}`);
    }
    for (const c of result.newCoordinates) {
      out.push(`${padField(c.node, 17)}${padField(c.x, 19)}${c.y}`);
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
      out.push(`${padField(l.link, 17)}${padField(l.entry, 11)}${padField(l.exit, 11)}${l.average}`);
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
        if (vjNames.size > 0) {
          const vjRe = /^\s*VIRTUAL_JUNCTION_MOMENTUM\b/i;
          const vjLine = `VIRTUAL_JUNCTION_MOMENTUM ${config.vjMomentum}`;
          const existing = optionLines.findIndex(l => vjRe.test(l.split(';')[0]));
          if (existing >= 0) optionLines[existing] = vjLine;
          else optionLines.push(vjLine);
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
        // Models without a [JUNCTIONS] section (e.g. all storage/outfall
        // endpoints) still get generated split junctions — declare them
        // before the conduits that reference them.
        if (!sectionMap.has('JUNCTIONS') && result.newJunctions.length > 0) {
          outputLines.push(...buildJunctionLines());
        }
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
