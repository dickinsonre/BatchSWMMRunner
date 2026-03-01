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
