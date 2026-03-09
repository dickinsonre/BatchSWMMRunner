export interface ConduitData {
  name: string;
  from: string;
  to: string;
  length: number;
  roughness: number;
  inOffset: number;
  outOffset: number;
  initFlow: number;
  maxFlow: number;
}

export interface JunctionData {
  name: string;
  elevation: number;
  maxDepth: number;
  initDepth: number;
  surDepth: number;
  aponded: number;
}

export interface OutfallData {
  name: string;
  elevation: number;
  type: string;
}

export interface StorageData {
  name: string;
  elevation: number;
  maxDepth: number;
  initDepth: number;
  shape: string;
}

export interface SubcatchmentData {
  name: string;
  rainGage: string;
  outlet: string;
  area: number;
  percentImperv: number;
}

export interface RainGageData {
  name: string;
  format: string;
  interval: string;
  scf: number;
}

export interface XSectionData {
  link: string;
  shape: string;
  geom1: string;
  geom2: number;
  geom3: number;
  geom4: number;
  barrels: number;
}

export interface CoordinateData {
  node: string;
  x: number;
  y: number;
}

export interface PolygonData {
  subcatchment: string;
  vertices: { x: number; y: number }[];
}

export interface LossData {
  link: string;
  entry: number;
  exit: number;
  average: number;
}

export interface PumpData {
  name: string;
  from: string;
  to: string;
  curve: string;
}

export interface WeirData {
  name: string;
  from: string;
  to: string;
  type: string;
  crestHeight: number;
}

export interface OrificeData {
  name: string;
  from: string;
  to: string;
  type: string;
}

export interface InpOptions {
  flowUnits: string;
  routingMethod: string;
  infiltrationMethod: string;
}

export interface SectionCounts {
  junctions: number;
  outfalls: number;
  storage: number;
  conduits: number;
  pumps: number;
  orifices: number;
  weirs: number;
  subcatchments: number;
  raingages: number;
}

export interface ParsedInpFile {
  title: string;
  options: InpOptions;
  counts: SectionCounts;
  junctions: JunctionData[];
  outfalls: OutfallData[];
  storage: StorageData[];
  conduits: ConduitData[];
  pumps: PumpData[];
  orifices: OrificeData[];
  weirs: WeirData[];
  subcatchments: SubcatchmentData[];
  raingages: RainGageData[];
  xsections: XSectionData[];
  coordinates: CoordinateData[];
  polygons: PolygonData[];
  losses: LossData[];
}

function splitIntoSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection = '';
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toUpperCase();
      sections.set(currentSection, []);
      continue;
    }
    if (currentSection && trimmed && !trimmed.startsWith(';;')) {
      sections.get(currentSection)!.push(trimmed);
    }
  }

  return sections;
}

function parseDataLines(lines: string[]): string[][] {
  return lines
    .filter(line => !line.startsWith(';'))
    .map(line => line.split(/\s+/).filter(Boolean));
}

function parseTitle(sections: Map<string, string[]>): string {
  const lines = sections.get('TITLE');
  if (!lines) return '';
  return lines.filter(l => !l.startsWith(';')).join(' ').trim();
}

function parseOptions(sections: Map<string, string[]>): InpOptions {
  const result: InpOptions = {
    flowUnits: '',
    routingMethod: '',
    infiltrationMethod: '',
  };
  const lines = sections.get('OPTIONS');
  if (!lines) return result;

  for (const line of lines) {
    if (line.startsWith(';')) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const key = parts[0].toUpperCase();
    const value = parts[1];
    if (key === 'FLOW_UNITS') result.flowUnits = value;
    else if (key === 'FLOW_ROUTING') result.routingMethod = value;
    else if (key === 'INFILTRATION') result.infiltrationMethod = value;
  }

  return result;
}

function parseJunctions(sections: Map<string, string[]>): JunctionData[] {
  const lines = sections.get('JUNCTIONS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 2)
    .map(parts => ({
      name: parts[0],
      elevation: parseFloat(parts[1]) || 0,
      maxDepth: parseFloat(parts[2]) || 0,
      initDepth: parseFloat(parts[3]) || 0,
      surDepth: parseFloat(parts[4]) || 0,
      aponded: parseFloat(parts[5]) || 0,
    }));
}

function parseOutfalls(sections: Map<string, string[]>): OutfallData[] {
  const lines = sections.get('OUTFALLS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 3)
    .map(parts => ({
      name: parts[0],
      elevation: parseFloat(parts[1]) || 0,
      type: parts[2],
    }));
}

function parseStorage(sections: Map<string, string[]>): StorageData[] {
  const lines = sections.get('STORAGE');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 4)
    .map(parts => ({
      name: parts[0],
      elevation: parseFloat(parts[1]) || 0,
      maxDepth: parseFloat(parts[2]) || 0,
      initDepth: parseFloat(parts[3]) || 0,
      shape: parts[4] || '',
    }));
}

function parseConduits(sections: Map<string, string[]>): ConduitData[] {
  const lines = sections.get('CONDUITS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 6)
    .map(parts => ({
      name: parts[0],
      from: parts[1],
      to: parts[2],
      length: parseFloat(parts[3]) || 0,
      roughness: parseFloat(parts[4]) || 0,
      inOffset: parseFloat(parts[5]) || 0,
      outOffset: parseFloat(parts[6]) || 0,
      initFlow: parseFloat(parts[7]) || 0,
      maxFlow: parseFloat(parts[8]) || 0,
    }));
}

function parsePumps(sections: Map<string, string[]>): PumpData[] {
  const lines = sections.get('PUMPS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 4)
    .map(parts => ({
      name: parts[0],
      from: parts[1],
      to: parts[2],
      curve: parts[3],
    }));
}

function parseOrifices(sections: Map<string, string[]>): OrificeData[] {
  const lines = sections.get('ORIFICES');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 4)
    .map(parts => ({
      name: parts[0],
      from: parts[1],
      to: parts[2],
      type: parts[3],
    }));
}

function parseWeirs(sections: Map<string, string[]>): WeirData[] {
  const lines = sections.get('WEIRS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 5)
    .map(parts => ({
      name: parts[0],
      from: parts[1],
      to: parts[2],
      type: parts[3],
      crestHeight: parseFloat(parts[4]) || 0,
    }));
}

function parseSubcatchments(sections: Map<string, string[]>): SubcatchmentData[] {
  const lines = sections.get('SUBCATCHMENTS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 5)
    .map(parts => ({
      name: parts[0],
      rainGage: parts[1],
      outlet: parts[2],
      area: parseFloat(parts[3]) || 0,
      percentImperv: parseFloat(parts[4]) || 0,
    }));
}

function parseRaingages(sections: Map<string, string[]>): RainGageData[] {
  const lines = sections.get('RAINGAGES');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 4)
    .map(parts => ({
      name: parts[0],
      format: parts[1],
      interval: parts[2],
      scf: parseFloat(parts[3]) || 0,
    }));
}

function parseXSections(sections: Map<string, string[]>): XSectionData[] {
  const lines = sections.get('XSECTIONS');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 3)
    .map(parts => ({
      link: parts[0],
      shape: parts[1],
      geom1: parts[2] || '0',
      geom2: parseFloat(parts[3]) || 0,
      geom3: parseFloat(parts[4]) || 0,
      geom4: parseFloat(parts[5]) || 0,
      barrels: parseFloat(parts[6]) || 1,
    }));
}

function parseCoordinates(sections: Map<string, string[]>): CoordinateData[] {
  const lines = sections.get('COORDINATES');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 3)
    .map(parts => ({
      node: parts[0],
      x: parseFloat(parts[1]) || 0,
      y: parseFloat(parts[2]) || 0,
    }));
}

function parsePolygons(sections: Map<string, string[]>): PolygonData[] {
  const lines = sections.get('POLYGONS');
  if (!lines) return [];
  const vertexMap = new Map<string, { x: number; y: number }[]>();
  for (const line of lines) {
    if (line.startsWith(';')) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 3) continue;
    const name = parts[0];
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    if (isNaN(x) || isNaN(y)) continue;
    if (!vertexMap.has(name)) vertexMap.set(name, []);
    vertexMap.get(name)!.push({ x, y });
  }
  return Array.from(vertexMap.entries()).map(([subcatchment, vertices]) => ({
    subcatchment,
    vertices,
  }));
}

function parseLosses(sections: Map<string, string[]>): LossData[] {
  const lines = sections.get('LOSSES');
  if (!lines) return [];
  return parseDataLines(lines)
    .filter(parts => parts.length >= 4)
    .map(parts => ({
      link: parts[0],
      entry: parseFloat(parts[1]) || 0,
      exit: parseFloat(parts[2]) || 0,
      average: parseFloat(parts[3]) || 0,
    }));
}

export function parseInpFile(content: string): ParsedInpFile {
  const sections = splitIntoSections(content);

  const junctions = parseJunctions(sections);
  const outfalls = parseOutfalls(sections);
  const storage = parseStorage(sections);
  const conduits = parseConduits(sections);
  const pumps = parsePumps(sections);
  const orifices = parseOrifices(sections);
  const weirs = parseWeirs(sections);
  const subcatchments = parseSubcatchments(sections);
  const raingages = parseRaingages(sections);
  const xsections = parseXSections(sections);
  const coordinates = parseCoordinates(sections);
  const polygons = parsePolygons(sections);
  const losses = parseLosses(sections);

  return {
    title: parseTitle(sections),
    options: parseOptions(sections),
    counts: {
      junctions: junctions.length,
      outfalls: outfalls.length,
      storage: storage.length,
      conduits: conduits.length,
      pumps: pumps.length,
      orifices: orifices.length,
      weirs: weirs.length,
      subcatchments: subcatchments.length,
      raingages: raingages.length,
    },
    junctions,
    outfalls,
    storage,
    conduits,
    pumps,
    orifices,
    weirs,
    subcatchments,
    raingages,
    xsections,
    coordinates,
    polygons,
    losses,
  };
}
