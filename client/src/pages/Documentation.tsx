import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import AppHeader from "@/components/AppHeader";

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

function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  return (
    <ScrollArea className="h-[500px] rounded border">
      <pre className="text-xs p-4 font-mono whitespace-pre overflow-x-auto bg-muted">
        <code>{code}</code>
      </pre>
    </ScrollArea>
  );
}

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="container max-w-6xl mx-auto px-8 py-8 flex-1">
        <div className="space-y-8">
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

          <Tabs defaultValue="swmm5-c" data-testid="tabs-documentation">
            <TabsList className="flex flex-wrap gap-1" data-testid="tablist-documentation">
              <TabsTrigger value="reswmm" data-testid="tab-reswmm">ReSWMM Lengthening</TabsTrigger>
              <TabsTrigger value="swmm5-c" data-testid="tab-swmm5-c">SWMM5 C Reference</TabsTrigger>
              <TabsTrigger value="integration" data-testid="tab-integration">SWMM Integration</TabsTrigger>
              <TabsTrigger value="batch" data-testid="tab-batch">Batch Processing</TabsTrigger>
              <TabsTrigger value="websocket" data-testid="tab-websocket">WebSocket</TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-upload">File Upload</TabsTrigger>
              <TabsTrigger value="schema" data-testid="tab-schema">Data Schema</TabsTrigger>
            </TabsList>

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
        <div className="container max-w-6xl mx-auto px-8 py-4">
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
