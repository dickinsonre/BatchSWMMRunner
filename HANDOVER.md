# BatchSWMM - Handover Guide

## What Is This?

BatchSWMM is a web-based tool for batch processing EPA SWMM (Storm Water Management Model) `.inp` files. It provides a browser interface for uploading multiple SWMM input files, processing them sequentially (or in parallel), and viewing results with real-time progress tracking.

**Important:** This tool is designed to run **locally on a Windows machine** where EPA SWMM is installed. On machines without `runswmm.exe`, the app runs in **simulation mode** (generates fake results to demonstrate the UI).

---

## Quick Start (Local Setup)

### Prerequisites

- **Node.js** v18 or higher — [https://nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- **EPA SWMM** installed with access to `runswmm.exe` — [https://www.epa.gov/water-research/storm-water-management-model-swmm](https://www.epa.gov/water-research/storm-water-management-model-swmm)

### Steps

1. **Copy the project folder** to your Windows machine.

2. **Open a terminal** (Command Prompt, PowerShell, or Git Bash) in the project folder.

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Set the SWMM executable path** (if not in your system PATH):
   ```bash
   # Windows Command Prompt
   set RUNSWMM_PATH=C:\Program Files\EPA SWMM\runswmm.exe

   # Windows PowerShell
   $env:RUNSWMM_PATH = "C:\Program Files\EPA SWMM\runswmm.exe"
   ```

5. **Start the app:**
   ```bash
   # Development mode (with hot reload)
   npm run dev

   # OR Production mode
   npm run build
   npm start
   ```

6. **Open your browser** to `http://localhost:5000`

---

## How It Works

### Processing Flow

1. User uploads `.inp` files through the browser
2. Files are stored temporarily in the `uploads/` folder
3. Backend spawns `runswmm.exe` for each file: `runswmm.exe <input.inp> <output.rpt> <output.out>`
4. Progress updates stream to the browser via WebSocket
5. Results (success/failure, processing time, peak flow, total volume) are displayed in a summary table
6. Output files (`.rpt`, `.out`) are saved alongside the input files

### Simulation Mode

When `runswmm.exe` is not found, the app automatically switches to simulation mode:
- Processes each file with a random 1-3 second delay
- 80% success rate with randomized peak flow and total volume values
- Failed files show a sample error message
- All UI features work identically to real processing

---

## Project Structure

```
BatchSWMM/
├── client/                     # Frontend (React + TypeScript)
│   └── src/
│       ├── components/
│       │   ├── ExpectedOutputs.tsx     # "What You'll Get" panel
│       │   ├── ProcessingLog.tsx       # Real-time timestamped log
│       │   ├── ProgressSection.tsx     # Progress bar + stats
│       │   ├── ResultsDisplay.tsx      # Summary table + CSV export
│       │   ├── SimulationSettings.tsx  # Settings panel
│       │   ├── WorkflowSteps.tsx       # Upload → Process → Results steps
│       │   └── ui/                     # Shadcn/ui component library
│       ├── pages/
│       │   └── Home.tsx                # Main application page
│       ├── hooks/
│       │   └── use-toast.ts            # Toast notification hook
│       ├── lib/
│       │   ├── queryClient.ts          # TanStack Query setup
│       │   └── utils.ts                # Utility functions
│       ├── App.tsx                     # Root component + routing
│       ├── main.tsx                    # Entry point
│       └── index.css                   # Tailwind + custom styles
├── server/                     # Backend (Express + TypeScript)
│   ├── index.ts                # Server entry point
│   ├── routes.ts               # API routes + SWMM processing logic
│   ├── storage.ts              # In-memory job storage
│   └── vite.ts                 # Vite dev server integration
├── shared/
│   └── schema.ts               # Shared TypeScript types (Zod schemas)
├── uploads/                    # Temporary file upload directory
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite build configuration
├── tailwind.config.ts          # Tailwind CSS configuration
└── postcss.config.js           # PostCSS configuration
```

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload `.inp` files (multipart form data, field name: `files`) |
| `POST` | `/api/batch/:jobId/start` | Start processing a batch job |
| `POST` | `/api/batch/:jobId/cancel` | Cancel a running batch job |
| `GET`  | `/api/batch/:jobId` | Get batch job status and results |

### WebSocket

- **Endpoint:** `ws://localhost:5000/api/ws?jobId=<jobId>`
- **Messages from server:**
  - `{ type: "progress", currentFile, total, fileName }` — file processing started
  - `{ type: "result", result }` — individual file result
  - `{ type: "completed" }` — all files done
  - `{ type: "cancelled" }` — job was cancelled

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUNSWMM_PATH` | `runswmm.exe` | Full path to the SWMM command-line executable |
| `PORT` | `5000` | Server port number |
| `NODE_ENV` | `development` | Set to `production` for production builds |

### Simulation Settings (UI)

These settings are configurable in the browser interface:

| Setting | Default | Options |
|---------|---------|---------|
| Report Step | 15 minutes | 1-1440 minutes |
| Routing Method | Dynamic Wave | Steady Flow, Kinematic Wave, Dynamic Wave |
| Parallel Processing | Off | Checkbox |
| Stop on Error | Off | Checkbox |
| Output Format | All files | All files, ZIP archive |

---

## Key Features

- **File Upload:** Drag-and-drop or click to select multiple `.inp` files. Non-`.inp` files are rejected with warnings.
- **Real-Time Progress:** WebSocket-powered progress bar with elapsed time, ETA, and success/failure counters.
- **Processing Log:** Timestamped, color-coded log entries showing each file's processing status.
- **Results Table:** Summary showing file name, status, peak flow (CFS), total volume (MG), and processing time.
- **CSV Export:** Download results as a CSV file for further analysis.
- **Cancel Support:** Stop batch processing mid-run.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| UI Components | Shadcn/ui (Radix UI primitives) |
| State Management | TanStack Query (React Query) v5 |
| Backend | Express.js, TypeScript |
| Real-time | WebSocket (`ws` library) |
| File Upload | Multer |
| Process Execution | Node.js `child_process.spawn` |
| Validation | Zod |
| Icons | Lucide React |

---

## SWMM5 Integration Source Code

All SWMM5 integration lives in `server/routes.ts`. Below is the complete source code that handles SWMM execution, simulation mode fallback, and report file generation.

### SWMM Executable Invocation

The core function that processes a single `.inp` file. It checks for `runswmm.exe`, falls back to simulation mode if not found, and reads the `.rpt` report file on success.

```typescript
// server/routes.ts — processSingleFile()

import { spawn } from "child_process";
import fs from "fs";

async function processSingleFile(
  file: { id: string; name: string; path: string }
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Look for runswmm.exe — env var or default name
    const runswmmPath = process.env.RUNSWMM_PATH || 'runswmm.exe';
    const inputPath = file.path;
    const reportPath = inputPath.replace('.inp', '.rpt');
    const outputPath = inputPath.replace('.inp', '.out');

    // ── SIMULATION MODE (runswmm.exe not found) ──────────────
    if (!fs.existsSync(runswmmPath)) {
      console.warn(
        `runswmm.exe not found at ${runswmmPath}, simulating processing`
      );
      const simulatedTime = 1000 + Math.random() * 2000; // 1-3 sec delay
      setTimeout(() => {
        const success = Math.random() > 0.2; // 80% success rate
        const processingTime = (Date.now() - startTime) / 1000;
        const peakFlow = Math.random() * 100 + 10;
        const totalVolume = Math.random() * 50 + 5;
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: success ? 'success' : 'failed',
          error: success
            ? undefined
            : 'Error 110: cannot open rainfall data file',
          processingTime,
          reportContent: success
            ? generateSimulatedReport(
                file.name, peakFlow, totalVolume, processingTime
              )
            : undefined,
          results: success ? { peakFlow, totalVolume } : undefined,
        });
      }, simulatedTime);
      return;
    }

    // ── REAL SWMM EXECUTION ──────────────────────────────────
    // Command: runswmm.exe <input.inp> <report.rpt> <output.out>
    const childProcess = spawn(runswmmPath, [
      inputPath,
      reportPath,
      outputPath,
    ]);

    let errorOutput = '';

    childProcess.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    childProcess.on('close', (code: number | null) => {
      const processingTime = (Date.now() - startTime) / 1000;
      if (code === 0) {
        // Success — read the .rpt report file
        let reportContent: string | undefined;
        try {
          if (fs.existsSync(reportPath)) {
            reportContent = fs.readFileSync(reportPath, 'utf-8');
          }
        } catch (e) {
          console.warn(`Could not read report file: ${reportPath}`);
        }
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'success',
          processingTime,
          reportContent,
          results: {
            peakFlow: undefined,   // parsed from real .rpt if needed
            totalVolume: undefined,
          },
        });
      } else {
        // SWMM returned non-zero exit code
        resolve({
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'failed',
          error: errorOutput || `Process exited with code ${code}`,
          processingTime,
        });
      }
    });

    childProcess.on('error', (err: Error) => {
      // Could not spawn the process at all
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
}
```

### Batch Processing Loop

Files are processed one at a time. After each file, the result is sent to the browser via WebSocket. Processing stops early if the user cancels.

```typescript
// server/routes.ts — processFilesSequentially()

async function processFilesSequentially(
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

  // All files done
  await storage.updateBatchJob(jobId, { status: 'completed' });
  sendProgressUpdate(jobId, { type: 'completed' });
}
```

### WebSocket Progress Updates

Real-time progress is delivered via WebSocket. Each browser tab opens one WebSocket connection per job.

```typescript
// server/routes.ts — WebSocket setup

import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({
  server: httpServer,
  path: '/api/ws'
});

const clients = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
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
}
```

### File Upload Handling

Files are uploaded via multipart form data. Only `.inp` files are accepted.

```typescript
// server/routes.ts — upload endpoint

import multer from "multer";
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
    id: `${Date.now()}-${index}`,
    name: file.originalname,
    path: file.path,
  }));

  const batchJob = await storage.createBatchJob(uploadedFiles);
  res.json(batchJob);
});
```

### Simulated Report Generator

When running without SWMM, this function generates a realistic `.rpt` file that mirrors what EPA SWMM 5.2 actually produces. It includes all standard report sections.

```typescript
// server/routes.ts — generateSimulatedReport()

function generateSimulatedReport(
  fileName: string,
  peakFlow: number,
  totalVolume: number,
  processingTime: number
): string {
  // Generates a full EPA SWMM 5.2 report with these sections:
  //   - Header (version, input/output file paths, timestamps)
  //   - Analysis Options (flow units, process models, routing method, etc.)
  //   - Runoff Quantity Continuity (precipitation, infiltration, runoff volumes)
  //   - Flow Routing Continuity (inflow, outflow, flooding, storage volumes)
  //   - Node Depth Summary (average/max depth, HGL per junction/outfall)
  //   - Node Flow Summary (max flooding, lateral/total inflow per node)
  //   - Link Flow Summary (max flow, max/full ratios per conduit)
  //   - Conduit Surcharge Summary
  //   - Node Flooding Summary
  //   - Routing Time Step Summary (min/avg/max step, convergence stats)
  //
  // Values are derived from the peakFlow and totalVolume parameters
  // with realistic ratios (e.g., infiltration ~22% of volume,
  // surface runoff ~85%, outflow ~78%).
  //
  // See server/routes.ts lines 167-312 for the full template.
}
```

### Data Types (Shared Schema)

These types are shared between frontend and backend to ensure consistency.

```typescript
// shared/schema.ts

import { z } from "zod";

export const processResultSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  status: z.enum(['success', 'failed']),
  error: z.string().optional(),
  processingTime: z.number().optional(),
  reportContent: z.string().optional(),    // full .rpt file text
  results: z.object({
    peakFlow: z.number().optional(),       // CFS
    totalVolume: z.number().optional(),    // MG (million gallons)
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

export type BatchJob = z.infer<typeof batchJobSchema>;
```

### Report Viewer (Frontend)

The results display includes a report viewer with two tabs — raw text and formatted HTML. Located in `client/src/components/ResultsDisplay.tsx`.

```typescript
// client/src/components/ResultsDisplay.tsx — reportToHtml()
//
// Converts raw .rpt text to styled HTML:
//   - Section headers (***...) → styled <h2> with blue color and bottom border
//   - Separator lines (---...) → <hr> elements
//   - EPA SWMM header → large bold <h1>
//   - File metadata lines → bold labels with values
//   - Continuity errors → green (low) or red (high) colored text
//   - Flooding warnings → orange text
//   - "No flooding" messages → green text
//   - Node/conduit data rows → monospace font
//   - All other lines → monospace pre-formatted
```

---

## Making It Work With Real SWMM Files

To process real SWMM files, you need:

1. **EPA SWMM installed** on the machine running BatchSWMM
2. **`runswmm.exe` accessible** — either in your system PATH or specified via `RUNSWMM_PATH`
3. **Valid `.inp` files** — standard EPA SWMM input files

The app calls SWMM like this:
```
runswmm.exe <input_file.inp> <report_file.rpt> <output_file.out>
```

Output files are saved in the `uploads/` directory by default. To save outputs alongside your original input files, the file paths in the upload would need to reference the original locations.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| App shows "Simulation Mode" | Set `RUNSWMM_PATH` to the full path of `runswmm.exe` |
| Port 5000 already in use | Set `PORT=3000` (or another free port) before starting |
| `npm install` fails | Make sure Node.js v18+ is installed. Try deleting `node_modules` and running `npm install` again |
| WebSocket disconnects | Check that no firewall/proxy is blocking WebSocket connections on the app port |
| Files not uploading | Make sure the `uploads/` directory exists in the project root |

---

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production (frontend + backend) |
| `npm start` | Run production build |
| `npm run check` | TypeScript type checking |

---

## Files You Can Safely Delete When Moving

These are Replit-specific and not needed locally:

- `.replit`
- `replit.md`
- `.upm/`
- `.cache/`
- Any Replit-specific Vite plugins in `vite.config.ts` (the app will still work without them, they just won't load)
