import koffi from 'koffi';
import path from 'path';
import fs from 'fs';

const LIB_PATH = path.join(process.cwd(), 'swmm-engine', 'libswmm5.so');

let lib: koffi.IKoffiLib | null = null;
let apiFunctions: {
  swmm_run: (f1: string, f2: string, f3: string) => number;
  swmm_open: (f1: string, f2: string, f3: string) => number;
  swmm_start: (saveFlag: number) => number;
  swmm_step: (elapsedTime: number[]) => number;
  swmm_stride: (strideStep: number, elapsedTime: number[]) => number;
  swmm_end: () => number;
  swmm_report: () => number;
  swmm_close: () => number;
  swmm_getMassBalErr: (runoffErr: number[], flowErr: number[], qualErr: number[]) => number;
  swmm_getVersion: () => number;
  swmm_getError: (errMsg: Buffer, msgLen: number) => number;
  swmm_getWarnings: () => number;
  swmm_getCount: (objType: number) => number;
  swmm_getName: (objType: number, index: number, name: Buffer, size: number) => void;
  swmm_getIndex: (objType: number, name: string) => number;
  swmm_getValue: (property: number, index: number) => number;
  swmm_setValue: (property: number, index: number, value: number) => void;
  swmm_getSavedValue: (property: number, index: number, period: number) => number;
  swmm_writeLine: (line: string) => void;
} | null = null;

export const SWMM_OBJECT = {
  GAGE: 0,
  SUBCATCH: 1,
  NODE: 2,
  LINK: 3,
  SYSTEM: 100,
} as const;

export const SWMM_NODE_PROPERTY = {
  TYPE: 300,
  ELEV: 301,
  MAXDEPTH: 302,
  DEPTH: 303,
  HEAD: 304,
  VOLUME: 305,
  LATFLOW: 306,
  INFLOW: 307,
  OVERFLOW: 308,
  RPTFLAG: 309,
} as const;

export const SWMM_LINK_PROPERTY = {
  TYPE: 400,
  NODE1: 401,
  NODE2: 402,
  LENGTH: 403,
  SLOPE: 404,
  FULLDEPTH: 405,
  FULLFLOW: 406,
  SETTING: 407,
  TIMEOPEN: 408,
  TIMECLOSED: 409,
  FLOW: 410,
  DEPTH: 411,
  VELOCITY: 412,
  TOPWIDTH: 413,
  RPTFLAG: 414,
} as const;

export const SWMM_SUBCATCH_PROPERTY = {
  AREA: 200,
  RAINGAGE: 201,
  RAINFALL: 202,
  EVAP: 203,
  INFIL: 204,
  RUNOFF: 205,
  RPTFLAG: 206,
} as const;

export const SWMM_SYSTEM_PROPERTY = {
  STARTDATE: 0,
  CURRENTDATE: 1,
  ELAPSEDTIME: 2,
  ROUTESTEP: 3,
  MAXROUTESTEP: 4,
  REPORTSTEP: 5,
  TOTALSTEPS: 6,
  NOREPORT: 7,
  FLOWUNITS: 8,
} as const;

export function isApiAvailable(): boolean {
  return fs.existsSync(LIB_PATH);
}

function loadLibrary(): void {
  if (lib) return;
  if (!fs.existsSync(LIB_PATH)) {
    throw new Error(`SWMM5 shared library not found at ${LIB_PATH}`);
  }
  lib = koffi.load(LIB_PATH);
  apiFunctions = {
    swmm_run: lib.func('int swmm_run(const char*, const char*, const char*)'),
    swmm_open: lib.func('int swmm_open(const char*, const char*, const char*)'),
    swmm_start: lib.func('int swmm_start(int)'),
    swmm_step: lib.func('int swmm_step(_Out_ double*)'),
    swmm_stride: lib.func('int swmm_stride(int, _Out_ double*)'),
    swmm_end: lib.func('int swmm_end()'),
    swmm_report: lib.func('int swmm_report()'),
    swmm_close: lib.func('int swmm_close()'),
    swmm_getMassBalErr: lib.func('int swmm_getMassBalErr(_Out_ float*, _Out_ float*, _Out_ float*)'),
    swmm_getVersion: lib.func('int swmm_getVersion()'),
    swmm_getError: lib.func('int swmm_getError(_Out_ char*, int)'),
    swmm_getWarnings: lib.func('int swmm_getWarnings()'),
    swmm_getCount: lib.func('int swmm_getCount(int)'),
    swmm_getName: lib.func('void swmm_getName(int, int, _Out_ char*, int)'),
    swmm_getIndex: lib.func('int swmm_getIndex(int, const char*)'),
    swmm_getValue: lib.func('double swmm_getValue(int, int)'),
    swmm_setValue: lib.func('void swmm_setValue(int, int, double)'),
    swmm_getSavedValue: lib.func('double swmm_getSavedValue(int, int, int)'),
    swmm_writeLine: lib.func('void swmm_writeLine(const char*)'),
  };
}

function ensureLoaded() {
  if (!apiFunctions) loadLibrary();
  return apiFunctions!;
}

export function getVersion(): number {
  const api = ensureLoaded();
  return api.swmm_getVersion();
}

export function getError(): { code: number; message: string } {
  const api = ensureLoaded();
  const buf = Buffer.alloc(256);
  const code = api.swmm_getError(buf, 256);
  return { code, message: buf.toString('utf-8').replace(/\0/g, '').trim() };
}

export function getCount(objType: number): number {
  const api = ensureLoaded();
  return api.swmm_getCount(objType);
}

export function getName(objType: number, index: number): string {
  const api = ensureLoaded();
  const buf = Buffer.alloc(256);
  api.swmm_getName(objType, index, buf, 256);
  return buf.toString('utf-8').replace(/\0/g, '').trim();
}

export function getIndex(objType: number, name: string): number {
  const api = ensureLoaded();
  return api.swmm_getIndex(objType, name);
}

export function getValue(property: number, index: number): number {
  const api = ensureLoaded();
  return api.swmm_getValue(property, index);
}

export function setValue(property: number, index: number, value: number): void {
  const api = ensureLoaded();
  api.swmm_setValue(property, index, value);
}

export interface StepCallbackData {
  elapsedTime: number;
  percentComplete: number;
  stepCount: number;
  nodeSnapshots?: Array<{ name: string; depth: number; head: number; inflow: number }>;
  linkSnapshots?: Array<{ name: string; flow: number; depth: number; velocity: number }>;
}

export interface ApiRunResult {
  success: boolean;
  error?: string;
  version: number;
  totalSteps: number;
  massBalErr?: { runoff: number; flow: number; quality: number };
  warnings: number;
}

export async function runWithApi(
  inputPath: string,
  reportPath: string,
  outputPath: string,
  onStep?: (data: StepCallbackData) => void,
  snapshotInterval: number = 10
): Promise<ApiRunResult> {
  const api = ensureLoaded();
  const version = api.swmm_getVersion();

  let err = api.swmm_open(inputPath, reportPath, outputPath);
  if (err !== 0) {
    const errInfo = getError();
    api.swmm_close();
    return { success: false, error: `swmm_open failed (code ${err}): ${errInfo.message}`, version, totalSteps: 0, warnings: 0 };
  }

  err = api.swmm_start(1);
  if (err !== 0) {
    const errInfo = getError();
    api.swmm_close();
    return { success: false, error: `swmm_start failed (code ${err}): ${errInfo.message}`, version, totalSteps: 0, warnings: 0 };
  }

  const totalStepsVal = api.swmm_getValue(SWMM_SYSTEM_PROPERTY.TOTALSTEPS, 0);
  const nNodes = api.swmm_getCount(SWMM_OBJECT.NODE);
  const nLinks = api.swmm_getCount(SWMM_OBJECT.LINK);

  const snapshotNodeCount = Math.min(nNodes, 5);
  const snapshotLinkCount = Math.min(nLinks, 5);

  let stepCount = 0;
  const elapsedArr = [0.0];

  while (true) {
    err = api.swmm_step(elapsedArr);
    if (err !== 0) break;
    if (elapsedArr[0] <= 0) break;
    stepCount++;

    if (onStep && stepCount % snapshotInterval === 0) {
      const percentComplete = totalStepsVal > 0
        ? Math.min(100, Math.round((stepCount / totalStepsVal) * 100))
        : Math.min(99, stepCount);

      const nodeSnapshots: StepCallbackData['nodeSnapshots'] = [];
      for (let i = 0; i < snapshotNodeCount; i++) {
        const name = getName(SWMM_OBJECT.NODE, i);
        nodeSnapshots.push({
          name,
          depth: api.swmm_getValue(SWMM_NODE_PROPERTY.DEPTH, i),
          head: api.swmm_getValue(SWMM_NODE_PROPERTY.HEAD, i),
          inflow: api.swmm_getValue(SWMM_NODE_PROPERTY.INFLOW, i),
        });
      }

      const linkSnapshots: StepCallbackData['linkSnapshots'] = [];
      for (let i = 0; i < snapshotLinkCount; i++) {
        const name = getName(SWMM_OBJECT.LINK, i);
        linkSnapshots.push({
          name,
          flow: api.swmm_getValue(SWMM_LINK_PROPERTY.FLOW, i),
          depth: api.swmm_getValue(SWMM_LINK_PROPERTY.DEPTH, i),
          velocity: api.swmm_getValue(SWMM_LINK_PROPERTY.VELOCITY, i),
        });
      }

      onStep({
        elapsedTime: elapsedArr[0],
        percentComplete,
        stepCount,
        nodeSnapshots,
        linkSnapshots,
      });
    }
  }

  const runoffErr = [0.0];
  const flowErr = [0.0];
  const qualErr = [0.0];
  api.swmm_getMassBalErr(runoffErr, flowErr, qualErr);

  const warnings = api.swmm_getWarnings();

  api.swmm_end();
  api.swmm_report();
  api.swmm_close();

  const lastErr = getError();
  if (lastErr.code !== 0) {
    return {
      success: false,
      error: `Simulation error (code ${lastErr.code}): ${lastErr.message}`,
      version,
      totalSteps: stepCount,
      massBalErr: { runoff: runoffErr[0], flow: flowErr[0], quality: qualErr[0] },
      warnings,
    };
  }

  return {
    success: true,
    version,
    totalSteps: stepCount,
    massBalErr: { runoff: runoffErr[0], flow: flowErr[0], quality: qualErr[0] },
    warnings,
  };
}
