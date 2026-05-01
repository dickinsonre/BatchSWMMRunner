import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import AppHeader from "@/components/AppHeader";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import swmm5ApiDiagramPath from "@assets/image_1773083934176.png";
import swmm5ApiRoadmapPath from "@assets/image_1773085062886.png";

const SWMM_INTEGRATION_CODE = `import { spawn } from "child_process";
import fs from "fs";

async function processSingleFile(
  file: { id: string; name: string; path: string }
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Look for runswmm.exe via environment variable or default name
    const runswmmPath = process.env.RUNSWMM_PATH || 'runswmm.exe';
    const inputPath = file.path;
    const reportPath = inputPath.replace('.inp', '.rpt');
    const outputPath = inputPath.replace('.inp', '.out');

    // SIMULATION MODE — when runswmm.exe is not found
    if (!fs.existsSync(runswmmPath)) {
      const simulatedTime = 1000 + Math.random() * 2000;
      setTimeout(() => {
        const success = Math.random() > 0.2;
        const processingTime = (Date.now() - startTime) / 1000;
        const peakFlow = Math.random() * 100 + 10;
        const totalVolume = Math.random() * 50 + 5;
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: success ? 'success' : 'failed',
          error: success ? undefined : 'Error 110: cannot open rainfall data file',
          processingTime,
          reportContent: success
            ? generateSimulatedReport(file.name, peakFlow, totalVolume, processingTime)
            : undefined,
          results: success ? { peakFlow, totalVolume } : undefined,
        });
      }, simulatedTime);
      return;
    }

    // REAL SWMM EXECUTION
    // Command: runswmm.exe <input.inp> <report.rpt> <output.out>
    const childProcess = spawn(runswmmPath, [inputPath, reportPath, outputPath]);

    let errorOutput = '';

    childProcess.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    childProcess.on('close', (code: number | null) => {
      const processingTime = (Date.now() - startTime) / 1000;
      if (code === 0) {
        let reportContent: string | undefined;
        try {
          if (fs.existsSync(reportPath)) {
            reportContent = fs.readFileSync(reportPath, 'utf-8');
          }
        } catch (e) {
          console.warn(\`Could not read report file: \${reportPath}\`);
        }
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'success',
          processingTime,
          reportContent,
          results: { peakFlow: undefined, totalVolume: undefined },
        });
      } else {
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'failed',
          error: errorOutput || \`Process exited with code \${code}\`,
          processingTime,
        });
      }
    });

    childProcess.on('error', (err: Error) => {
      const processingTime = (Date.now() - startTime) / 1000;
      resolve({
        id: file.id,
        fileName: file.name,
        filePath: file.path,
        status: 'failed',
        error: err.message,
        processingTime,
      });
    });
  });
}`;

const BATCH_LOOP_CODE = `async function processFilesSequentially(
  jobId: string,
  files: Array<{ id: string; name: string; path: string }>
) {
  const job = await storage.getBatchJob(jobId);
  if (!job) return;

  for (let i = 0; i < files.length; i++) {
    // Check for cancellation before each file
    const currentJob = await storage.getBatchJob(jobId);
    if (currentJob?.status === 'cancelled') {
      sendProgressUpdate(jobId, { type: 'cancelled' });
      return;
    }

    const file = files[i];
    await storage.updateBatchJob(jobId, { currentFile: i + 1 });

    // Tell the browser which file is being processed
    sendProgressUpdate(jobId, {
      type: 'progress',
      currentFile: i + 1,
      total: files.length,
      fileName: file.name,
    });

    // Process the file (real SWMM or simulation)
    const result = await processSingleFile(file);

    // Store result and send to browser
    const updatedJob = await storage.getBatchJob(jobId);
    if (updatedJob) {
      await storage.updateBatchJob(jobId, {
        results: [...updatedJob.results, result],
      });
    }

    sendProgressUpdate(jobId, { type: 'result', result });
  }

  await storage.updateBatchJob(jobId, { status: 'completed' });
  sendProgressUpdate(jobId, { type: 'completed' });
}`;

const WEBSOCKET_CODE = `import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({
  server: httpServer,
  path: '/api/ws'
});

const clients = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, \`http://\${req.headers.host}\`);
  const jobId = url.searchParams.get('jobId');
  if (jobId) {
    clients.set(jobId, ws);
  }
  ws.on('close', () => {
    if (jobId) clients.delete(jobId);
  });
});

function sendProgressUpdate(jobId: string, data: any) {
  const client = clients.get(jobId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}`;

const UPLOAD_CODE = `import multer from "multer";
import path from "path";

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.inp') {
      cb(null, true);
    } else {
      cb(new Error('Only .inp files are allowed'));
    }
  },
});

app.post('/api/upload', upload.array('files'), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const uploadedFiles = files.map((file, index) => ({
    id: \`\${Date.now()}-\${index}\`,
    name: file.originalname,
    path: file.path,
  }));

  const batchJob = await storage.createBatchJob(uploadedFiles);
  res.json(batchJob);
});`;

const SCHEMA_CODE = `import { z } from "zod";

export const processResultSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  status: z.enum(['success', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().optional(),
  reportContent: z.string().optional(),
  results: z.object({
    peakFlow: z.number().optional(),
    totalVolume: z.number().optional(),
  }).optional(),
});

export type ProcessResult = z.infer<typeof processResultSchema>;

export const batchJobSchema = z.object({
  id: z.string(),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  })),
  status: z.enum(['idle', 'processing', 'completed', 'cancelled']),
  currentFile: z.number(),
  results: z.array(processResultSchema),
});

export type BatchJob = z.infer<typeof batchJobSchema>;`;

const SWMM5_C_REFERENCE = `/*
 * EPA SWMM5 — Storm Water Management Model
 * Version 5.2
 *
 * SWMM5 is written in C and maintained by the US EPA.
 * BatchSWMM does NOT embed or compile the SWMM5 C source code.
 * Instead, it calls the pre-compiled runswmm.exe executable
 * as an external process using Node.js child_process.spawn().
 *
 * The SWMM5 command-line interface accepts three arguments:
 *
 *   runswmm.exe  <input_file.inp>  <report_file.rpt>  <output_file.out>
 *
 * This maps to the C entry point in swmm5.c:
 */

// ── swmm5.c (EPA source) ──────────────────────────────────────
//
// int main(int argc, char *argv[])
// {
//     // argv[1] = input file  (.inp)
//     // argv[2] = report file (.rpt)
//     // argv[3] = output file (.out)
//
//     swmm_run(argv[1], argv[2], argv[3]);
//     return 0;
// }

// ── swmm5.h (EPA public API) ──────────────────────────────────
//
// int  swmm_run(char* f1, char* f2, char* f3);
// int  swmm_open(char* f1, char* f2, char* f3);
// int  swmm_start(int saveResults);
// int  swmm_step(double* elapsedTime);
// int  swmm_end(void);
// int  swmm_report(void);
// int  swmm_close(void);
// int  swmm_getMassBalErr(float* runoffErr, float* flowErr, float* qualErr);
// int  swmm_getVersion(void);

// ── How BatchSWMM calls it (TypeScript) ───────────────────────
//
// const childProcess = spawn(runswmmPath, [
//   inputPath,    // .inp file
//   reportPath,   // .rpt file (created by SWMM)
//   outputPath,   // .out file (created by SWMM)
// ]);

/*
 * SWMM5 C Source Code Modules (for reference):
 *
 * Core Engine:
 *   swmm5.c        — Main entry point, swmm_run() orchestration
 *   project.c      — Project data management
 *   input.c        — Input file (.inp) parser
 *   report.c       — Report file (.rpt) generator
 *   output.c       — Binary output file (.out) writer
 *
 * Hydrology:
 *   runoff.c       — Surface runoff calculations
 *   rain.c         — Rainfall data processing
 *   subcatch.c     — Subcatchment modeling
 *   infil.c        — Infiltration (Horton, Green-Ampt, CN)
 *   groundwater.c  — Groundwater flow
 *   snowmelt.c     — Snowmelt routines
 *   rdii.c         — Rainfall-dependent infiltration/inflow
 *
 * Hydraulics:
 *   routing.c      — Flow routing controller
 *   flowrout.c     — Flow routing calculations
 *   kinwave.c      — Kinematic wave routing
 *   dynwave.c      — Dynamic wave routing (Saint-Venant)
 *   forcmain.c     — Force main (pressurized pipe) routing
 *
 * Network Elements:
 *   node.c         — Junction/outfall/storage nodes
 *   link.c         — Conduit/pump/orifice/weir links
 *   xsect.c        — Cross-section geometry
 *
 * Water Quality:
 *   qualrout.c     — Water quality routing
 *   treatmnt.c     — Treatment functions
 *
 * Utilities:
 *   table.c        — Curve/time series lookup tables
 *   datetime.c     — Date/time calculations
 *   hash.c         — Hash table for object lookup
 *   mathexpr.c     — Mathematical expression parser
 *   mempool.c      — Memory pool management
 *   toposort.c     — Topological sorting of network
 *
 * EPA SWMM5 C source code is available at:
 *   https://github.com/USEPA/Stormwater-Management-Model
 *
 * Pre-compiled executables (runswmm.exe) available at:
 *   https://www.epa.gov/water-research/storm-water-management-model-swmm
 */`;

const RESWMM_LENGTHENING_DOC = `ReSWMM Conduit Lengthening
═══════════════════════════════════════════════════════════

OVERVIEW
────────
ReSWMM applies conduit lengthening as a pre-processing step BEFORE
discretization (splitting). This ensures that short conduits meet the
Courant-Friedrichs-Lewy (CFL) stability criterion for dynamic wave
routing in EPA SWMM5.

The processing order is:
  1. Lengthen short conduits  (if enabled)
  2. Discretize long conduits (split into segments)
  3. Write LENGTHENING_STEP to [OPTIONS] in the output .inp

═══════════════════════════════════════════════════════════

HOW THE MINIMUM LENGTH IS CALCULATED
─────────────────────────────────────
For each conduit, ReSWMM computes the gravity wave celerity from
the conduit diameter (Geom1 in the [XSECTIONS] table):

    celerity = sqrt(g × D)

where:
    g = gravitational acceleration
        32.174 ft/s²  (US Customary: CFS, GPM, MGD)
         9.810 m/s²   (SI: CMS, LPS, MLD)
    D = conduit diameter or height (Geom1)

The minimum allowable conduit length is then:

    L_min = celerity × LENGTHENING_STEP

where LENGTHENING_STEP is the user-specified time step (seconds).

═══════════════════════════════════════════════════════════

EXAMPLE
───────
Given:
    Conduit diameter   D = 2.0 ft
    LENGTHENING_STEP       = 5 s
    Flow units             = CFS (US Customary)

    celerity = sqrt(32.174 × 2.0) = 8.02 ft/s
    L_min    = 8.02 × 5           = 40.1 ft

Any conduit with length < 40.1 ft will be lengthened to 40.1 ft.

═══════════════════════════════════════════════════════════

WHAT HAPPENS TO LENGTHENED CONDUITS
────────────────────────────────────
• The conduit length is increased in the [CONDUITS] section.
• Node coordinates, elevations, and cross-sections are unchanged.
• The geometric distance between nodes stays the same — only the
  hydraulic length used by the routing engine increases.
• This is identical to how SWMM5's built-in LENGTHENING_STEP
  option works at runtime (see link.c in the EPA source).

═══════════════════════════════════════════════════════════

SWMM5 INTERNAL REFERENCE
─────────────────────────
In the EPA SWMM5 C source code, automatic conduit lengthening
is implemented in link.c:

    // link.c — link_setParams()
    //
    // if (LengtheningStep > 0.0)
    // {
    //     celerity = sqrt(GRAVITY * xsect->yFull);
    //     lengthFactor = celerity * LengtheningStep;
    //     if (link->length < lengthFactor)
    //         link->length = lengthFactor;
    // }

ReSWMM replicates this logic client-side so you can:
  • See the effect before running SWMM
  • Combine with discretization in a single step
  • Review before/after stats and network maps

═══════════════════════════════════════════════════════════

RELATIONSHIP TO DISCRETIZATION
──────────────────────────────
Lengthening runs FIRST. This means:

  1. A 10 ft conduit might be lengthened to 40 ft.
  2. If the max discretization length is 200 ft, the 40 ft
     conduit is now within range and will NOT be split further.
  3. A 5000 ft conduit is already long enough — lengthening
     does nothing, but discretization splits it into segments.

This two-step approach ensures ALL conduits in the output model
satisfy the CFL condition from both directions:
  • Too short → lengthened
  • Too long  → split

═══════════════════════════════════════════════════════════

OUTPUT .INP FILE
────────────────
When lengthening is enabled, ReSWMM also writes the LENGTHENING_STEP
value into the [OPTIONS] section of the output .inp file:

    [OPTIONS]
    ...
    LENGTHENING_STEP  5

This tells SWMM5 to also apply its own runtime lengthening as a
safety net, in case any conduits were added or modified after
ReSWMM processing.`;

const SWMM5_API_DOC = {
  overview: `The SWMM 5 Application Programming Interface (API) allows external programs to run 
SWMM simulations, control them step-by-step, and access model data during runtime. 
The API is exported from the swmm5.dll (Windows) or libswmm5.so (Linux) shared library.

The API supports three languages out of the box:
  - C/C++ via swmm5.h
  - Object Pascal (Delphi/Free Pascal) via swmm5.pas
  - Python via swmm5.py (ctypes wrapper)

Version: 5.2 (Build 5.2.0)
Author: L. Rossman, US EPA
License: Public Domain`,

  cHeader: `//-----------------------------------------------------------------------------
//   swmm5.h — Prototypes for SWMM5 API functions
//   Project: EPA SWMM5   Version: 5.2   Date: 11/01/21
//   Author:  L. Rossman
//-----------------------------------------------------------------------------

// ── Object Type Enumerations ────────────────────────────────

typedef enum {
    swmm_GAGE     = 0,    // Rain gage
    swmm_SUBCATCH = 1,    // Subcatchment
    swmm_NODE     = 2,    // Node (junction, outfall, storage, divider)
    swmm_LINK     = 3,    // Link (conduit, pump, orifice, weir, outlet)
    swmm_SYSTEM   = 100   // System-wide properties
} swmm_Object;

typedef enum {
    swmm_JUNCTION = 0,    // Junction node
    swmm_OUTFALL  = 1,    // Outfall node
    swmm_STORAGE  = 2,    // Storage unit node
    swmm_DIVIDER  = 3     // Flow divider node
} swmm_NodeType;

typedef enum {
    swmm_CONDUIT = 0,     // Conduit link
    swmm_PUMP    = 1,     // Pump link
    swmm_ORIFICE = 2,     // Orifice link
    swmm_WEIR    = 3,     // Weir link
    swmm_OUTLET  = 4      // Outlet link
} swmm_LinkType;

// ── Property Enumerations ───────────────────────────────────

// Rain Gage Properties (100+)
swmm_GAGE_RAINFALL = 100    // Current rainfall rate

// Subcatchment Properties (200+)
swmm_SUBCATCH_AREA      = 200   // Area
swmm_SUBCATCH_RAINGAGE  = 201   // Assigned rain gage index
swmm_SUBCATCH_RAINFALL  = 202   // Current rainfall
swmm_SUBCATCH_EVAP      = 203   // Current evaporation
swmm_SUBCATCH_INFIL     = 204   // Current infiltration
swmm_SUBCATCH_RUNOFF    = 205   // Current runoff rate
swmm_SUBCATCH_RPTFLAG   = 206   // Reporting flag

// Node Properties (300+)
swmm_NODE_TYPE     = 300   // Node type (junction/outfall/storage/divider)
swmm_NODE_ELEV     = 301   // Invert elevation
swmm_NODE_MAXDEPTH = 302   // Maximum depth
swmm_NODE_DEPTH    = 303   // Current water depth
swmm_NODE_HEAD     = 304   // Current hydraulic head
swmm_NODE_VOLUME   = 305   // Current stored volume
swmm_NODE_LATFLOW  = 306   // Current lateral inflow
swmm_NODE_INFLOW   = 307   // Current total inflow
swmm_NODE_OVERFLOW = 308   // Current overflow rate
swmm_NODE_RPTFLAG  = 309   // Reporting flag

// Link Properties (400+)
swmm_LINK_TYPE       = 400   // Link type (conduit/pump/orifice/weir/outlet)
swmm_LINK_NODE1      = 401   // Upstream node index
swmm_LINK_NODE2      = 402   // Downstream node index
swmm_LINK_LENGTH     = 403   // Conduit length
swmm_LINK_SLOPE      = 404   // Conduit slope
swmm_LINK_FULLDEPTH  = 405   // Full (max) depth
swmm_LINK_FULLFLOW   = 406   // Full (max) flow
swmm_LINK_SETTING    = 407   // Current setting (pump speed, gate opening)
swmm_LINK_TIMEOPEN   = 408   // Fraction of time open
swmm_LINK_TIMECLOSED = 409   // Fraction of time closed
swmm_LINK_FLOW       = 410   // Current flow rate
swmm_LINK_DEPTH      = 411   // Current flow depth
swmm_LINK_VELOCITY   = 412   // Current flow velocity
swmm_LINK_TOPWIDTH   = 413   // Current top width
swmm_LINK_RPTFLAG    = 414   // Reporting flag

// System Properties
swmm_STARTDATE    = 0   // Simulation start date (DateTime)
swmm_CURRENTDATE  = 1   // Current date (DateTime)
swmm_ELAPSEDTIME  = 2   // Elapsed time (days)
swmm_ROUTESTEP    = 3   // Current routing time step (sec)
swmm_MAXROUTESTEP = 4   // Maximum routing time step (sec)
swmm_REPORTSTEP   = 5   // Reporting time step (sec)
swmm_TOTALSTEPS   = 6   // Total routing steps taken
swmm_NOREPORT     = 7   // No-report flag
swmm_FLOWUNITS    = 8   // Flow units code

// Flow Units
swmm_CFS = 0   // cubic feet per second
swmm_GPM = 1   // gallons per minute
swmm_MGD = 2   // million gallons per day
swmm_CMS = 3   // cubic meters per second
swmm_LPS = 4   // liters per second
swmm_MLD = 5   // million liters per day

// ── Core Simulation Functions ───────────────────────────────

int swmm_run(const char *f1, const char *f2, const char *f3);
    // Runs a complete simulation.
    // f1 = input file, f2 = report file, f3 = output file
    // Returns 0 on success, error code on failure.

int swmm_open(const char *f1, const char *f2, const char *f3);
    // Opens the input file and reads in network data.
    // Must be called before swmm_start().

int swmm_start(int saveFlag);
    // Starts the simulation. saveFlag = 1 to save results.
    // Must be called after swmm_open().

int swmm_step(double *elapsedTime);
    // Advances the simulation by one routing time step.
    // elapsedTime receives total elapsed time in milliseconds.
    // Returns 0 when simulation is not yet complete.

int swmm_stride(int strideStep, double *elapsedTime);
    // Advances the simulation by strideStep routing time steps.
    // More efficient than calling swmm_step() repeatedly.

int swmm_end(void);
    // Ends the simulation and writes results.

int swmm_report(void);
    // Writes simulation results to the report file.

int swmm_close(void);
    // Closes all files and frees memory.
    // Must be the last API call.

// ── Query Functions ─────────────────────────────────────────

int    swmm_getMassBalErr(float *runoffErr, float *flowErr, float *qualErr);
    // Returns mass balance errors (%) for runoff, flow routing, and quality.

int    swmm_getVersion(void);
    // Returns version number (e.g. 52004 for v5.2.4).

int    swmm_getError(char *errMsg, int msgLen);
    // Retrieves the text of the last error message.

int    swmm_getWarnings(void);
    // Returns the number of warning messages generated.

int    swmm_getCount(int objType);
    // Returns the number of objects of a given type.
    // objType: swmm_GAGE, swmm_SUBCATCH, swmm_NODE, swmm_LINK

void   swmm_getName(int objType, int index, char *name, int size);
    // Gets the ID name of an object given its type and index.

int    swmm_getIndex(int objType, const char *name);
    // Gets the index of an object given its type and ID name.

double swmm_getValue(int property, int index);
    // Gets the current value of an object's property.
    // Use during a step loop for runtime values.

void   swmm_setValue(int property, int index, double value);
    // Sets the value of an object's property during runtime.
    // Allows real-time control (e.g., adjust pump speed).

double swmm_getSavedValue(int property, int index, int period);
    // Gets a saved value from a completed simulation.
    // period = reporting period index (0-based).

void   swmm_writeLine(const char *line);
    // Writes a line of text to the report file.

void   swmm_decodeDate(double date, int *year, int *month, int *day,
         int *hour, int *minute, int *second, int *dayOfWeek);
    // Converts a SWMM DateTime value into its components.`,

  pythonWrapper: `"""Python SWMM5 Interface (swmm5.py)"""
"""Uses ctypes to call the SWMM5 shared library (swmm5.dll / libswmm5.so)"""

import ctypes
import platform
import datetime

# ── Library Loading ──────────────────────────────────────────

_plat = platform.system()
if _plat == 'Linux':
    _lib = ctypes.CDLL("libswmm5.so")
elif _plat == 'Windows':
    _lib = ctypes.WinDLL(".\\\\swmm5.dll")
else:
    raise Exception('Platform ' + _plat + ' unsupported')

# ── Core Simulation Functions ────────────────────────────────

def getVersion():
    """Returns SWMM version number (e.g., 52004)."""
    return _lib.swmm_getVersion()

def run(f1, f2, f3=''):
    """Runs a complete simulation.
    f1: input file (.inp)
    f2: report file (.rpt)
    f3: output file (.out), optional
    """
    return _lib.swmm_run(
        ctypes.c_char_p(f1.encode()),
        ctypes.c_char_p(f2.encode()),
        ctypes.c_char_p(f3.encode()))

def open(f1, f2, f3=''):
    """Opens input file and reads network data."""
    return _lib.swmm_open(
        ctypes.c_char_p(f1.encode()),
        ctypes.c_char_p(f2.encode()),
        ctypes.c_char_p(f3.encode()))

def start(saveFlag):
    """Starts the simulation. saveFlag=1 to save results."""
    return _lib.swmm_start(ctypes.c_int(saveFlag))

def step():
    """Advances by one routing step. Returns elapsed time (ms)."""
    elapsed_time = ctypes.c_double()
    _lib.swmm_step(ctypes.byref(elapsed_time))
    return elapsed_time.value

def stride(strideStep):
    """Advances by strideStep routing steps. Returns elapsed time."""
    elapsed_time = ctypes.c_double()
    _lib.swmm_stride(ctypes.c_int(strideStep),
                     ctypes.byref(elapsed_time))
    return elapsed_time.value

def end():
    """Ends the simulation."""
    _lib.swmm_end()

def report():
    """Writes results to the report file."""
    return _lib.swmm_report()

def close():
    """Closes all files and frees memory."""
    _lib.swmm_close()

# ── Query Functions ──────────────────────────────────────────

def getMassBalErr():
    """Returns (runoffErr, flowErr, qualErr) as percentages."""
    runoff = ctypes.c_float()
    flow = ctypes.c_float()
    qual = ctypes.c_float()
    _lib.swmm_getMassBalErr(
        ctypes.byref(runoff),
        ctypes.byref(flow),
        ctypes.byref(qual))
    return runoff.value, flow.value, qual.value

def getWarnings():
    """Returns number of warning messages."""
    return _lib.swmm_getWarnings()

def getError():
    """Returns the last error message as a string."""
    errmsg = ctypes.create_string_buffer(240)
    _lib.swmm_getError(ctypes.byref(errmsg), ctypes.c_int(240))
    return errmsg.value.decode()

def getCount(objtype):
    """Returns count of objects of given type."""
    return _lib.swmm_getCount(ctypes.c_int(objtype))

def getName(objtype, index, size):
    """Returns ID name of object at given index."""
    name = ctypes.create_string_buffer(size)
    _lib.swmm_getName(
        ctypes.c_int(objtype), ctypes.c_int(index),
        ctypes.byref(name), ctypes.c_int(size))
    return name.value.decode()

def getIndex(objtype, name):
    """Returns index of object with given ID name."""
    return _lib.swmm_getIndex(
        ctypes.c_int(objtype),
        ctypes.c_char_p(name.encode()))

def getValue(property, index):
    """Gets current runtime value of a property."""
    _lib.swmm_getValue.restype = ctypes.c_double
    return _lib.swmm_getValue(
        ctypes.c_int(property), ctypes.c_int(index))

def getSavedValue(property, index, period):
    """Gets saved value from completed simulation."""
    _lib.swmm_getSavedValue.restype = ctypes.c_double
    return _lib.swmm_getSavedValue(
        ctypes.c_int(property),
        ctypes.c_int(index),
        ctypes.c_int(period))

def setValue(property, index, value):
    """Sets a property value during runtime (real-time control)."""
    _lib.swmm_setValue(
        ctypes.c_int(property),
        ctypes.c_int(index),
        ctypes.c_double(value))

def writeLine(line):
    """Writes a line of text to the report file."""
    _lib.swmm_writeLine(ctypes.c_char_p(line.encode()))

def decodeDate(date):
    """Converts SWMM DateTime to Python datetime."""
    year = ctypes.c_int()
    month = ctypes.c_int()
    day = ctypes.c_int()
    hour = ctypes.c_int()
    minute = ctypes.c_int()
    second = ctypes.c_int()
    dayofweek = ctypes.c_int()
    _lib.swmm_decodeDate(
        ctypes.c_double(date),
        ctypes.byref(year), ctypes.byref(month),
        ctypes.byref(day), ctypes.byref(hour),
        ctypes.byref(minute), ctypes.byref(second),
        ctypes.byref(dayofweek))
    return datetime.datetime(
        year.value, month.value, day.value,
        hour.value, minute.value, second.value)

# ── Constants ────────────────────────────────────────────────

GAGE = 0;  SUBCATCH = 1;  NODE = 2;  LINK = 3;  SYSTEM = 100

JUNCTION = 0; OUTFALL = 1; STORAGE = 2; DIVIDER = 3
CONDUIT = 0; PUMP = 1; ORIFICE = 2; WEIR = 3; OUTLET = 4

GAGE_RAINFALL = 100

SUBCATCH_AREA = 200;  SUBCATCH_RAINGAGE = 201
SUBCATCH_RAINFALL = 202;  SUBCATCH_EVAP = 203
SUBCATCH_INFIL = 204;  SUBCATCH_RUNOFF = 205
SUBCATCH_RPTFLAG = 206

NODE_TYPE = 300; NODE_ELEV = 301; NODE_MAXDEPTH = 302
NODE_DEPTH = 303; NODE_HEAD = 304; NODE_VOLUME = 305
NODE_LATFLOW = 306; NODE_INFLOW = 307
NODE_OVERFLOW = 308; NODE_RPTFLAG = 309

LINK_TYPE = 400; LINK_NODE1 = 401; LINK_NODE2 = 402
LINK_LENGTH = 403; LINK_SLOPE = 404
LINK_FULLDEPTH = 405; LINK_FULLFLOW = 406
LINK_SETTING = 407; LINK_TIMEOPEN = 408
LINK_TIMECLOSED = 409; LINK_FLOW = 410
LINK_DEPTH = 411; LINK_VELOCITY = 412
LINK_TOPWIDTH = 413; LINK_RPTFLAG = 414

CFS = 0; GPM = 1; MGD = 2; CMS = 3; LPS = 4; MLD = 5`,

  pascalUnit: `unit swmm5;
{ Object Pascal (Delphi/Free Pascal) SWMM 5 Interface }

interface

const
  Swmm5Lib = 'swmm5.dll';

  // Object types
  swmm_GAGE     = 0;   swmm_SUBCATCH = 1;
  swmm_NODE     = 2;   swmm_LINK     = 3;
  swmm_SYSTEM   = 100;

  // Node types
  swmm_JUNCTION = 0;   swmm_OUTFALL  = 1;
  swmm_STORAGE  = 2;   swmm_DIVIDER  = 3;

  // Link types
  swmm_CONDUIT = 0;  swmm_PUMP    = 1;
  swmm_ORIFICE = 2;  swmm_WEIR    = 3;  swmm_OUTLET  = 4;

  // Flow units
  swmm_CFS = 0;  swmm_GPM = 1;  swmm_MGD = 2;
  swmm_CMS = 3;  swmm_LPS = 4;  swmm_MLD = 5;

// ── Core Simulation Functions ───────────────────────────────

function  swmm_run(F1, F2, F3: PAnsiChar): Integer;
function  swmm_open(F1, F2, F3: PAnsiChar): Integer;
function  swmm_start(SaveFlag: Integer): Integer;
function  swmm_step(var ElapsedTime: Double): Integer;
function  swmm_stride(StrideStep: Integer;
                      var ElapsedTime: Double): Integer;
function  swmm_end: Integer;
function  swmm_report: Integer;
function  swmm_close: Integer;

// ── Query Functions ─────────────────────────────────────────

function  swmm_getMassBalErr(var Erunoff, Eflow, Equal: Single): Integer;
function  swmm_getVersion: Integer;
function  swmm_getError(ErrMsg: PAnsiChar; MsgLen: Integer): Integer;
function  swmm_getWarnings: Integer;

function  swmm_getCount(ObjType: Integer): Integer;
procedure swmm_getName(ObjType, Index: Integer;
                       Name: PAnsiChar; Size: Integer);
function  swmm_getIndex(ObjType: Integer; Name: PAnsiChar): Integer;
function  swmm_getValue(aProperty, Index: Integer): Double;
procedure swmm_setValue(aProperty, Index: Integer; Value: Double);
function  swmm_getSavedValue(aProperty, Index, Period: Integer): Double;
procedure swmm_writeLine(Line: PAnsiChar);
procedure swmm_decodeDate(Date: Double;
            var Year, Month, Day, Hour, Minute, Second,
            DayOfWeek: Integer);

// All functions are stdcall, imported from swmm5.dll
implementation
end.`,

  usageExamples: `// ═══════════════════════════════════════════════════════════
//  SWMM5 API Usage Examples
// ═══════════════════════════════════════════════════════════

// ── Example 1: Simple Complete Run ──────────────────────────
// The simplest way to run a simulation (all languages)

// C:
int err = swmm_run("model.inp", "model.rpt", "model.out");
if (err) printf("Error code: %d\\n", err);

// Python:
import swmm5
err = swmm5.run("model.inp", "model.rpt", "model.out")
if err: print(f"Error code: {err}")

// Pascal:
err := swmm_run('model.inp', 'model.rpt', 'model.out');

// ── Example 2: Step-by-Step Simulation ──────────────────────
// Run one routing step at a time for real-time monitoring

// Python:
import swmm5

swmm5.open("model.inp", "model.rpt", "model.out")
swmm5.start(1)  # 1 = save results

elapsed = 0.0
while elapsed == 0.0 or elapsed > 0.0:
    elapsed = swmm5.step()
    if elapsed <= 0:
        break

    # Read runtime values at each step
    n_nodes = swmm5.getCount(swmm5.NODE)
    for i in range(n_nodes):
        depth = swmm5.getValue(swmm5.NODE_DEPTH, i)
        flow_in = swmm5.getValue(swmm5.NODE_INFLOW, i)
        overflow = swmm5.getValue(swmm5.NODE_OVERFLOW, i)

        if overflow > 0:
            name = swmm5.getName(swmm5.NODE, i, 64)
            print(f"  Flooding at {name}: {overflow:.3f}")

swmm5.end()
swmm5.report()
swmm5.close()

# Check mass balance errors
runoff_err, flow_err, qual_err = swmm5.getMassBalErr()
print(f"Runoff error: {runoff_err:.3f}%")
print(f"Flow error:   {flow_err:.3f}%")
print(f"Quality error:{qual_err:.3f}%")

// ── Example 3: Real-Time Control ────────────────────────────
// Adjust pump speed based on upstream node depth

// Python:
import swmm5

swmm5.open("model.inp", "model.rpt", "model.out")
swmm5.start(1)

pump_index = swmm5.getIndex(swmm5.LINK, "PUMP-1")
wet_well   = swmm5.getIndex(swmm5.NODE, "WET-WELL")

while True:
    elapsed = swmm5.step()
    if elapsed <= 0:
        break

    # Read wet well depth
    depth = swmm5.getValue(swmm5.NODE_DEPTH, wet_well)

    # Simple on/off control
    if depth > 4.0:    # High water: pump on
        swmm5.setValue(swmm5.LINK_SETTING, pump_index, 1.0)
    elif depth < 1.0:  # Low water: pump off
        swmm5.setValue(swmm5.LINK_SETTING, pump_index, 0.0)

swmm5.end()
swmm5.report()
swmm5.close()

// ── Example 4: Post-Simulation Analysis ─────────────────────
// Read saved results after simulation completes

// Python:
import swmm5

# Run the simulation first
swmm5.run("model.inp", "model.rpt", "model.out")

# Reopen to access saved results
swmm5.open("model.inp", "model.rpt", "model.out")
swmm5.start(0)  # 0 = don't re-run, just load

total_steps = int(swmm5.getValue(swmm5.TOTALSTEPS, 0))
link_idx = swmm5.getIndex(swmm5.LINK, "C1")

print("Period | Flow     | Depth    | Velocity")
print("-------|----------|----------|----------")
for t in range(total_steps):
    flow = swmm5.getSavedValue(swmm5.LINK_FLOW, link_idx, t)
    depth = swmm5.getSavedValue(swmm5.LINK_DEPTH, link_idx, t)
    vel = swmm5.getSavedValue(swmm5.LINK_VELOCITY, link_idx, t)
    print(f"  {t:4d} | {flow:8.3f} | {depth:8.3f} | {vel:8.3f}")

swmm5.end()
swmm5.close()

// ── Example 5: Network Inventory ────────────────────────────
// List all objects in the model

// Python:
import swmm5

swmm5.open("model.inp", "model.rpt", "")

obj_types = [
    ("Rain Gages",    swmm5.GAGE),
    ("Subcatchments", swmm5.SUBCATCH),
    ("Nodes",         swmm5.NODE),
    ("Links",         swmm5.LINK),
]

for label, obj_type in obj_types:
    count = swmm5.getCount(obj_type)
    print(f"\\n{label} ({count}):")
    for i in range(count):
        name = swmm5.getName(obj_type, i, 64)
        print(f"  [{i}] {name}")

# Node details
n_nodes = swmm5.getCount(swmm5.NODE)
for i in range(n_nodes):
    name = swmm5.getName(swmm5.NODE, i, 64)
    elev = swmm5.getValue(swmm5.NODE_ELEV, i)
    maxd = swmm5.getValue(swmm5.NODE_MAXDEPTH, i)
    ntype = int(swmm5.getValue(swmm5.NODE_TYPE, i))
    type_names = ["Junction", "Outfall", "Storage", "Divider"]
    print(f"  {name}: {type_names[ntype]}, "
          f"Elev={elev:.2f}, MaxDepth={maxd:.2f}")

swmm5.close()

// ═══════════════════════════════════════════════════════════
//  Call Sequence Summary
// ═══════════════════════════════════════════════════════════
//
//  Simple run:     swmm_run(f1, f2, f3)
//
//  Step-by-step:   swmm_open(f1, f2, f3)
//                  swmm_start(saveFlag)
//                  loop { swmm_step(&t) } until t <= 0
//                  swmm_end()
//                  swmm_report()
//                  swmm_close()
//
//  With stride:    swmm_open(f1, f2, f3)
//                  swmm_start(saveFlag)
//                  loop { swmm_stride(n, &t) } until t <= 0
//                  swmm_end()
//                  swmm_report()
//                  swmm_close()
//
// ═══════════════════════════════════════════════════════════`,
};

function FaqItem({ question, answer, testId }: { question: string; answer: string; testId: string }) {
  return (
    <div className="border-b pb-4 last:border-b-0 last:pb-0" data-testid={testId}>
      <h3 className="font-medium text-sm mb-2">{question}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{answer}</p>
    </div>
  );
}

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  return (
    <ScrollArea className="h-[500px] rounded border">
      <pre className="text-xs p-4 font-mono whitespace-pre overflow-x-auto bg-muted">
        <code>{code}</code>
      </pre>
    </ScrollArea>
  );
}

interface GuideSection {
  heading: string;
  level: number;
  content: string;
}

function parseIntoSections(markdown: string): GuideSection[] {
  const lines = markdown.split("\n");
  const sections: GuideSection[] = [];
  let currentHeading = "Introduction";
  let currentLevel = 1;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, level: currentLevel, content: currentLines.join("\n") });
      }
      currentHeading = headingMatch[2];
      currentLevel = headingMatch[1].length;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, level: currentLevel, content: currentLines.join("\n") });
  }
  return sections;
}

function FullApiGuide() {
  const [guideContent, setGuideContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/swmm5-api-guide")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        setGuideContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(`Failed to load API guide: ${err.message}`);
        setLoading(false);
      });
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 200);
  }, []);

  const sections = useMemo(() => parseIntoSections(guideContent), [guideContent]);

  const { filteredContent, matchCount } = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return { filteredContent: guideContent, matchCount: 0 };

    const matched = sections.filter((s) => s.content.toLowerCase().includes(term) || s.heading.toLowerCase().includes(term));
    return {
      filteredContent: matched.map((s) => s.content).join("\n\n---\n\n") || "",
      matchCount: matched.length,
    };
  }, [debouncedSearch, sections, guideContent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground" data-testid="loading-api-guide">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading SWMM5 API Guide...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-destructive text-sm" data-testid="error-api-guide">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search the API guide..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-api-guide"
        />
      </div>
      {debouncedSearch && (
        <p className="text-xs text-muted-foreground" data-testid="text-search-results">
          {matchCount > 0 ? `Found ${matchCount} section${matchCount !== 1 ? "s" : ""} matching` : "No sections matching"} "{debouncedSearch}" &mdash;{" "}
          <button className="underline" onClick={() => { setSearchTerm(""); setDebouncedSearch(""); }} data-testid="button-clear-search">
            clear search
          </button>
        </p>
      )}
      <ScrollArea className="h-[70vh]">
        <div className="prose prose-sm dark:prose-invert max-w-none px-1" data-testid="content-api-guide">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {filteredContent || "No matching content found."}
          </ReactMarkdown>
        </div>
      </ScrollArea>
    </div>
  );
}

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="container max-w-6xl mx-auto px-3 sm:px-6 md:px-8 py-4 md:py-8 flex-1">
        <div className="space-y-6 md:space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-2" data-testid="text-docs-title">
              SWMM5 Integration Documentation
            </h2>
            <p className="text-sm text-muted-foreground mb-6" data-testid="text-docs-subtitle">
              Complete source code showing how BatchSWMM integrates with EPA SWMM5.
              The app calls the pre-compiled <code className="font-mono bg-muted px-1 rounded">runswmm.exe</code> as
              an external process — it does not embed or compile the SWMM5 C engine directly.
            </p>
          </div>

          <Tabs defaultValue="faq" data-testid="tabs-documentation">
            <TabsList className="flex flex-wrap gap-1 h-auto" data-testid="tablist-documentation">
              <TabsTrigger value="faq" data-testid="tab-faq">FAQ</TabsTrigger>
              <TabsTrigger value="swmm5-api" data-testid="tab-swmm5-api">SWMM5 API</TabsTrigger>
              <TabsTrigger value="reswmm" data-testid="tab-reswmm">ReSWMM Lengthening</TabsTrigger>
              <TabsTrigger value="swmm5-c" data-testid="tab-swmm5-c">SWMM5 C Reference</TabsTrigger>
              <TabsTrigger value="integration" data-testid="tab-integration">SWMM Integration</TabsTrigger>
              <TabsTrigger value="batch" data-testid="tab-batch">Batch Processing</TabsTrigger>
              <TabsTrigger value="websocket" data-testid="tab-websocket">WebSocket</TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-upload">File Upload</TabsTrigger>
              <TabsTrigger value="schema" data-testid="tab-schema">Data Schema</TabsTrigger>
            </TabsList>

            <TabsContent value="faq">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base" data-testid="text-faq-title">Frequently Asked Questions</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Common questions about BatchSWMM, EPA SWMM, and how to get the most out of the application.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <FaqItem
                      question="Do I need EPA SWMM installed to use BatchSWMM?"
                      answer="No. BatchSWMM ships with a built-in EPA SWMM 5.2.4 engine (a compiled Linux binary) that runs automatically on the server. You do not need to install SWMM separately. If the engine is not found for any reason, the app falls back to Simulation Mode, which generates realistic mock reports so you can still explore the interface and features."
                      testId="faq-swmm-required"
                    />
                    <FaqItem
                      question="What is Simulation Mode?"
                      answer="Simulation Mode activates automatically when the SWMM engine binary is not detected. In this mode, BatchSWMM generates realistic but synthetic report data with randomized metrics, continuity errors, and element results. This lets you test the upload workflow, view reports, explore charts and histograms, and use the AI Report Builder without running actual hydraulic simulations."
                      testId="faq-simulation-mode"
                    />
                    <FaqItem
                      question="What file types does BatchSWMM accept?"
                      answer="BatchSWMM accepts only EPA SWMM .inp (input) files. These are plain-text files that define the drainage network, rainfall data, simulation parameters, and all other model inputs. You can upload multiple .inp files at once for batch processing."
                      testId="faq-file-types"
                    />
                    <FaqItem
                      question="What output files does a SWMM simulation produce?"
                      answer="Each simulation produces two output files: a .rpt (report) file containing human-readable summary tables, continuity checks, and element-by-element results; and a .out (binary output) file containing time series data for all nodes, links, subcatchments, and system variables. BatchSWMM parses both files to populate the RPT Text, RPT Graphs, RPT Histograms, and RPT HTML tabs."
                      testId="faq-output-files"
                    />
                    <FaqItem
                      question="What is ReSWMM?"
                      answer="ReSWMM is a conduit discretization tool built into BatchSWMM. It splits long conduits into smaller segments using either a fixed interval or a dx/D ratio method. It also includes automatic conduit lengthening to satisfy the Courant-Friedrichs-Lewy (CFL) stability criterion for dynamic wave routing. ReSWMM processes .inp files client-side and produces a modified .inp file ready for simulation."
                      testId="faq-reswmm"
                    />
                    <FaqItem
                      question="How does batch processing work?"
                      answer="Upload one or more .inp files, then click Process. BatchSWMM processes each file sequentially through the SWMM engine, streaming real-time progress updates to your browser via WebSocket. Each file gets its own progress bar showing the simulation percentage. Results appear as each file completes, with full report viewing, charts, and download options."
                      testId="faq-batch-processing"
                    />
                    <FaqItem
                      question="What is the AI Report Builder?"
                      answer="The AI Report Builder is a chat interface available in the results view (under the AI Report tab). You describe the kind of HTML report you want, and the AI generates a complete, standalone HTML document using your actual simulation data. You can iterate on the design through conversation, preview the result live, and download the final HTML file."
                      testId="faq-ai-report"
                    />
                    <FaqItem
                      question="Can I compare simulation results?"
                      answer="Yes. The ReSWMM page includes a simulation comparison feature. After running SWMM on both the original and discretized .inp files, BatchSWMM displays a side-by-side comparison table and grouped bar charts showing differences in peak flows, total volumes, and other key metrics."
                      testId="faq-comparison"
                    />
                    <FaqItem
                      question="What do the continuity errors mean?"
                      answer="Continuity errors measure how well the simulation conserved mass (water volume). SWMM reports both runoff and flow routing continuity errors as percentages. Errors below 1% (green) are excellent, 1-5% (yellow) are acceptable, and above 5% (red) may indicate model issues like instability, short conduits, or overly large time steps."
                      testId="faq-continuity"
                    />
                    <FaqItem
                      question="What version of EPA SWMM does BatchSWMM use?"
                      answer="BatchSWMM uses EPA SWMM version 5.2.4 (version code 52004). The engine is compiled from the official EPA source code available at github.com/USEPA/Stormwater-Management-Model. EPA SWMM 5 is public domain software that may be freely copied and distributed."
                      testId="faq-version"
                    />
                    <FaqItem
                      question="Where can I get .inp files to test with?"
                      answer="EPA provides several sample projects with the SWMM installation. Each sample includes an .inp file and a description. You can also find example models in the EPA SWMM documentation, university course materials, or create your own using the EPA SWMM 5.2 desktop application (available at epa.gov/water-research/storm-water-management-model-swmm)."
                      testId="faq-sample-files"
                    />
                    <FaqItem
                      question="Is my data stored on the server?"
                      answer="Uploaded .inp files are stored temporarily in the server's uploads folder during processing. They are not persisted to a database. Report results are held in memory for the duration of your session. No simulation data is stored permanently or shared with third parties."
                      testId="faq-data-storage"
                    />
                    <FaqItem
                      question="Can I use BatchSWMM on Windows or Mac?"
                      answer="BatchSWMM runs as a web application, so you access it through your browser on any operating system. The SWMM engine runs on the server (Linux). If you deploy BatchSWMM locally on Windows, it will look for runswmm.exe in standard EPA SWMM installation paths automatically."
                      testId="faq-platforms"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="swmm5-api">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between gap-4 flex-wrap">
                    <span>SWMM5 Application Programming Interface (API)</span>
                    <a
                      href="https://github.com/USEPA/Stormwater-Management-Model"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary flex items-center gap-1 font-normal"
                      data-testid="link-swmm5-api-github"
                    >
                      <ExternalLink className="h-3 w-3" />
                      EPA SWMM5 Source
                    </a>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    The SWMM 5 API allows external programs to run simulations, control them step-by-step,
                    and read/write model data at runtime. Supports C/C++, Python, and Object Pascal.
                    Version 5.2 by L. Rossman, US EPA.
                  </p>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="api-overview" data-testid="tabs-swmm5-api-inner">
                    <TabsList className="flex flex-wrap gap-1 mb-4" data-testid="tablist-swmm5-api-inner">
                      <TabsTrigger value="api-full-guide" data-testid="tab-api-full-guide">Full API Guide</TabsTrigger>
                      <TabsTrigger value="api-overview" data-testid="tab-api-overview">Overview</TabsTrigger>
                      <TabsTrigger value="api-c" data-testid="tab-api-c">C Header</TabsTrigger>
                      <TabsTrigger value="api-python" data-testid="tab-api-python">Python</TabsTrigger>
                      <TabsTrigger value="api-pascal" data-testid="tab-api-pascal">Pascal</TabsTrigger>
                      <TabsTrigger value="api-examples" data-testid="tab-api-examples">Usage Examples</TabsTrigger>
                      <TabsTrigger value="api-batchswmm" data-testid="tab-api-batchswmm">BatchSWMM API Mode</TabsTrigger>
                    </TabsList>

                    <TabsContent value="api-full-guide">
                      <FullApiGuide />
                    </TabsContent>

                    <TabsContent value="api-overview">
                      <div className="space-y-6">
                        <div className="rounded border overflow-hidden" data-testid="img-swmm5-api-diagram">
                          <img
                            src={swmm5ApiDiagramPath}
                            alt="EPA SWMM5 API Header File Overview — Object models, workflow, properties, and utility functions"
                            className="w-full h-auto"
                          />
                        </div>

                        <div className="bg-muted/40 rounded p-4">
                          <pre className="text-xs font-mono whitespace-pre-wrap">{SWMM5_API_DOC.overview}</pre>
                        </div>

                        <div className="space-y-4">
                          <h3 className="font-medium text-sm" data-testid="text-api-function-groups">API Function Groups</h3>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Core Simulation</CardTitle>
                              </CardHeader>
                              <CardContent className="text-xs text-muted-foreground space-y-1 font-mono">
                                <div><Badge variant="secondary" className="text-[10px] mr-2">run</Badge>swmm_run(f1, f2, f3) — Complete simulation</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">init</Badge>swmm_open(f1, f2, f3) — Open and read network</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">start</Badge>swmm_start(saveFlag) — Begin simulation</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">step</Badge>swmm_step(&amp;t) — Advance one routing step</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">stride</Badge>swmm_stride(n, &amp;t) — Advance n steps</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">end</Badge>swmm_end() — End simulation</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">rpt</Badge>swmm_report() — Write report file</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">close</Badge>swmm_close() — Free memory</div>
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Data Access</CardTitle>
                              </CardHeader>
                              <CardContent className="text-xs text-muted-foreground space-y-1 font-mono">
                                <div><Badge variant="secondary" className="text-[10px] mr-2">count</Badge>swmm_getCount(objType) — Object count</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">name</Badge>swmm_getName(type, idx, ...) — Object ID</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">index</Badge>swmm_getIndex(type, name) — Object index</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">get</Badge>swmm_getValue(prop, idx) — Runtime value</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">set</Badge>swmm_setValue(prop, idx, val) — Modify value</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">saved</Badge>swmm_getSavedValue(prop, idx, t) — Saved result</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">err</Badge>swmm_getMassBalErr(...) — Continuity errors</div>
                                <div><Badge variant="secondary" className="text-[10px] mr-2">ver</Badge>swmm_getVersion() — Version number</div>
                              </CardContent>
                            </Card>
                          </div>

                          <h3 className="font-medium text-sm mt-4" data-testid="text-api-call-sequence">Call Sequence</h3>
                          <div className="bg-muted/40 rounded p-4">
                            <pre className="text-xs font-mono whitespace-pre">{`Simple run:     swmm_run(f1, f2, f3)

Step-by-step:   swmm_open(f1, f2, f3)
                swmm_start(saveFlag)
                loop { swmm_step(&t) } until t <= 0
                swmm_end()
                swmm_report()
                swmm_close()

With stride:    swmm_open(f1, f2, f3)
                swmm_start(saveFlag)
                loop { swmm_stride(n, &t) } until t <= 0
                swmm_end()
                swmm_report()
                swmm_close()`}</pre>
                          </div>

                          <h3 className="font-medium text-sm mt-4" data-testid="text-api-property-table">Property Enum Ranges</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs" data-testid="table-api-properties">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1.5 pr-4 text-muted-foreground font-medium">Object</th>
                                  <th className="text-left py-1.5 px-4 text-muted-foreground font-medium">Enum Range</th>
                                  <th className="text-left py-1.5 px-4 text-muted-foreground font-medium">Key Properties</th>
                                </tr>
                              </thead>
                              <tbody className="text-muted-foreground">
                                <tr className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono">GAGE</td>
                                  <td className="py-1.5 px-4">100</td>
                                  <td className="py-1.5 px-4">RAINFALL</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono">SUBCATCH</td>
                                  <td className="py-1.5 px-4">200-206</td>
                                  <td className="py-1.5 px-4">AREA, RAINFALL, EVAP, INFIL, RUNOFF</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono">NODE</td>
                                  <td className="py-1.5 px-4">300-309</td>
                                  <td className="py-1.5 px-4">TYPE, ELEV, DEPTH, HEAD, VOLUME, INFLOW, OVERFLOW</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono">LINK</td>
                                  <td className="py-1.5 px-4">400-414</td>
                                  <td className="py-1.5 px-4">TYPE, NODES, LENGTH, SLOPE, FLOW, DEPTH, VELOCITY</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono">SYSTEM</td>
                                  <td className="py-1.5 px-4">0-8</td>
                                  <td className="py-1.5 px-4">STARTDATE, ELAPSEDTIME, ROUTESTEP, FLOWUNITS</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="api-c">
                      <CodeBlock code={SWMM5_API_DOC.cHeader} language="c" />
                    </TabsContent>

                    <TabsContent value="api-python">
                      <CodeBlock code={SWMM5_API_DOC.pythonWrapper} language="python" />
                    </TabsContent>

                    <TabsContent value="api-pascal">
                      <CodeBlock code={SWMM5_API_DOC.pascalUnit} language="pascal" />
                    </TabsContent>

                    <TabsContent value="api-examples">
                      <CodeBlock code={SWMM5_API_DOC.usageExamples} />
                    </TabsContent>

                    <TabsContent value="api-batchswmm">
                      <div className="space-y-6">
                        <div className="rounded border overflow-hidden" data-testid="img-swmm5-api-roadmap">
                          <img
                            src={swmm5ApiRoadmapPath}
                            alt="Unlocking SWMM5 API Control: Implementation Roadmap — compile shared library, FFI bindings, step mode with live monitoring and real-time control"
                            className="w-full h-auto"
                          />
                        </div>

                        <div className="bg-muted/40 rounded p-4">
                          <h3 className="font-medium text-sm mb-3" data-testid="text-batchswmm-api-mode-title">BatchSWMM API Mode</h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            BatchSWMM offers two engine modes for running SWMM simulations. Users can toggle between
                            them on the Home page before starting a batch run.
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Executable Mode (Default)</CardTitle>
                              </CardHeader>
                              <CardContent className="text-xs text-muted-foreground space-y-1">
                                <p>Spawns <code>runswmm</code> as a child process via <code>child_process.spawn()</code>.</p>
                                <p>Equivalent to running <code>runswmm input.inp report.rpt output.out</code> from the command line.</p>
                                <p>Progress parsed from stdout percentage output.</p>
                                <p>Simple, reliable, no library linking needed.</p>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">API Mode (SWMM5 Shared Library)</CardTitle>
                              </CardHeader>
                              <CardContent className="text-xs text-muted-foreground space-y-1">
                                <p>Loads <code>libswmm5.so</code> via Node.js FFI (koffi) and calls API functions directly.</p>
                                <p>Uses step-by-step execution: <code>swmm_open → swmm_start → swmm_step (loop) → swmm_end → swmm_report → swmm_close</code></p>
                                <p>Streams live node/link data during simulation (depth, flow, velocity).</p>
                                <p>Enables future real-time control (adjusting pump settings mid-simulation).</p>
                              </CardContent>
                            </Card>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Architecture</h4>
                          <pre className="text-xs font-mono bg-muted/40 p-4 rounded whitespace-pre-wrap">{`BatchSWMM API Mode Architecture
================================

Source:   EPA SWMM 5.2.4 (github.com/USEPA/Stormwater-Management-Model)
Compiled: gcc -shared -fPIC -O2 → libswmm5.so (54 C source files)
Bridge:   server/swmm5api.ts (koffi FFI bindings)
Route:    POST /api/batch/:jobId/start { engineMode: 'api' }

Step-by-Step Flow:
─────────────────
1. swmm_open(inp, rpt, out)    — Parse input file, allocate objects
2. swmm_start(1)               — Initialize simulation (saveFlag=1 for .out)
3. swmm_step(&elapsed) [loop]  — Advance one routing time step
   ├─ swmm_getValue(NODE_DEPTH, i)  — Read live node depths
   ├─ swmm_getValue(LINK_FLOW, i)   — Read live link flows
   └─ WebSocket → api_snapshot      — Stream to browser
4. swmm_getMassBalErr(...)     — Get continuity errors
5. swmm_end()                  — Finalize results
6. swmm_report()               — Write .rpt file
7. swmm_close()                — Free memory

Output: Same .rpt and .out files as Executable mode
        → Fully compatible with existing Results Dashboard

API Functions Wrapped (20 total):
─────────────────────────────────
Core:     swmm_run, swmm_open, swmm_start, swmm_step, swmm_stride,
          swmm_end, swmm_report, swmm_close
Query:    swmm_getCount, swmm_getName, swmm_getIndex
Runtime:  swmm_getValue, swmm_setValue, swmm_getSavedValue
Status:   swmm_getMassBalErr, swmm_getVersion, swmm_getError,
          swmm_getWarnings, swmm_writeLine, swmm_decodeDate

WebSocket Message Types (API Mode):
────────────────────────────────────
file_progress  — Step count and percentage
api_snapshot   — Live node/link data (depth, flow, velocity)
log            — [API Mode] prefix messages with version/step/error info`}</pre>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Key Files</h4>
                          <div className="text-xs font-mono text-muted-foreground space-y-1 bg-muted/40 p-3 rounded">
                            <div><code>swmm-engine/libswmm5.so</code> — Compiled SWMM5 shared library (EPA SWMM 5.2.4)</div>
                            <div><code>swmm-engine/runswmm</code> — Standalone executable (used in Executable mode)</div>
                            <div><code>swmm-source/</code> — EPA SWMM source code (54 solver .c files + headers)</div>
                            <div><code>server/swmm5api.ts</code> — Node.js FFI bridge wrapping all 20 API functions</div>
                            <div><code>server/routes.ts</code> — processSingleFileApi() for API-mode batch runs</div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Future Capabilities (Enabled by API Mode)</h4>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>The step-by-step API opens the door to features not possible with the executable:</p>
                            <ul className="list-disc pl-5 space-y-1 mt-1">
                              <li><strong>Real-Time Control (RTC):</strong> Use <code>swmm_setValue()</code> to adjust pump speeds, gate openings, or orifice settings mid-simulation based on live conditions.</li>
                              <li><strong>Live Dashboards:</strong> Stream node depths and link flows to the browser in real time during simulation.</li>
                              <li><strong>Conditional Early Termination:</strong> Stop a simulation early if flooding thresholds are exceeded.</li>
                              <li><strong>Parameter Modification:</strong> Change subcatchment properties or inflow patterns between steps without restarting.</li>
                              <li><strong>Custom Reporting:</strong> Use <code>swmm_writeLine()</code> to inject custom annotations into the .rpt file during simulation.</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reswmm">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ReSWMM Conduit Lengthening</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    How ReSWMM automatically lengthens short conduits before discretization
                    to satisfy the CFL stability criterion. Includes the calculation method,
                    a worked example, and the corresponding SWMM5 C source reference.
                  </p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={RESWMM_LENGTHENING_DOC} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="swmm5-c">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between gap-4 flex-wrap">
                    <span>EPA SWMM5 C Engine Reference</span>
                    <a
                      href="https://github.com/USEPA/Stormwater-Management-Model"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary flex items-center gap-1 font-normal"
                      data-testid="link-swmm5-github"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View EPA SWMM5 Source on GitHub
                    </a>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    SWMM5 is written in C by the US EPA. BatchSWMM calls the compiled executable
                    (<code className="font-mono bg-muted px-1 rounded">runswmm.exe</code>) via
                    Node.js <code className="font-mono bg-muted px-1 rounded">child_process.spawn()</code>.
                    Below is a reference guide to the SWMM5 C API, module structure, and how
                    BatchSWMM interfaces with it.
                  </p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={SWMM5_C_REFERENCE} language="c" />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="integration">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">SWMM Executable Invocation</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    The core function that processes a single .inp file. Checks for runswmm.exe,
                    falls back to simulation mode if not found, and reads the .rpt report on success.
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">server/routes.ts</p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={SWMM_INTEGRATION_CODE} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="batch">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Batch Processing Loop</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Files are processed sequentially. After each file, the result is sent to the
                    browser via WebSocket. Processing stops early if the user cancels.
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">server/routes.ts</p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={BATCH_LOOP_CODE} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="websocket">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">WebSocket Progress Updates</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Real-time progress is delivered via WebSocket. Each browser session opens one
                    WebSocket connection per job for isolated progress streams.
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">server/routes.ts</p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={WEBSOCKET_CODE} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upload">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">File Upload Handling</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Files are uploaded via multipart form data using Multer. Only .inp files are accepted.
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">server/routes.ts</p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={UPLOAD_CODE} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="schema">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Data Schema (Shared Types)</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Zod schemas shared between frontend and backend for type-safe data contracts.
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">shared/schema.ts</p>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={SCHEMA_CODE} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Architecture Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div className="space-y-3">
                  <h3 className="font-medium">How BatchSWMM Uses SWMM5</h3>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>User uploads .inp files through the browser</li>
                    <li>Backend stores files temporarily in uploads/ folder</li>
                    <li>For each file, spawns: <code className="font-mono bg-muted px-1 rounded">runswmm.exe input.inp output.rpt output.out</code></li>
                    <li>Captures exit code and stderr for error handling</li>
                    <li>Reads generated .rpt file for report viewer</li>
                    <li>Streams progress to browser via WebSocket</li>
                    <li>Displays results with Text/HTML report tabs</li>
                  </ol>
                </div>
                <div className="space-y-3">
                  <h3 className="font-medium">SWMM5 Output Files</h3>
                  <div className="space-y-2 text-muted-foreground">
                    <div className="flex gap-2">
                      <Badge variant="secondary">.rpt</Badge>
                      <span>Human-readable report with summaries, continuity checks, node/link results</span>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">.out</Badge>
                      <span>Binary output file with time series data for post-processing</span>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">.inp</Badge>
                      <span>Input file defining the drainage network, rainfall, and simulation parameters</span>
                    </div>
                  </div>
                  <h3 className="font-medium mt-4">Key SWMM5 C Modules</h3>
                  <div className="space-y-1 text-muted-foreground text-xs font-mono">
                    <div>swmm5.c - Main entry, swmm_run()</div>
                    <div>runoff.c - Surface runoff</div>
                    <div>routing.c - Flow routing controller</div>
                    <div>dynwave.c - Dynamic wave (Saint-Venant)</div>
                    <div>kinwave.c - Kinematic wave routing</div>
                    <div>report.c - .rpt file generation</div>
                    <div>output.c - .out binary writer</div>
                    <div>input.c - .inp file parser</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t mt-auto">
        <div className="container max-w-6xl mx-auto px-3 sm:px-6 md:px-8 py-3 md:py-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
            <p>BatchSWMM v1.0.0</p>
            <a
              href="https://github.com/USEPA/Stormwater-Management-Model"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary"
              data-testid="link-footer-swmm5"
            >
              <ExternalLink className="h-3 w-3" />
              EPA SWMM5 Source Code
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
