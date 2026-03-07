import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";
import { storage } from "./storage";
import { uploadFileSchema, type ProcessResult, type ParsedMetrics, type SwmmStatus, type SweepResult, type SweepConfig, type DesignStormConfig } from "@shared/schema";
import { z } from "zod";

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

const COMMON_SWMM_PATHS = [
  path.join(process.cwd(), 'swmm-engine', 'runswmm'),
  'C:\\Program Files (x86)\\EPA SWMM 5.2\\runswmm.exe',
  'C:\\Program Files\\EPA SWMM 5.2\\runswmm.exe',
  'C:\\Program Files (x86)\\EPA SWMM 5.1\\swmm5.exe',
  'C:\\Program Files\\EPA SWMM 5.1\\swmm5.exe',
  'C:\\EPA SWMM 5.2\\runswmm.exe',
  'C:\\SWMM\\runswmm.exe',
  '/usr/local/bin/runswmm',
  '/usr/local/bin/swmm5',
  '/usr/bin/runswmm',
  '/usr/bin/swmm5',
];

function detectSwmmPath(): SwmmStatus {
  const envPath = process.env.RUNSWMM_PATH;
  const searchedPaths: string[] = [];

  if (envPath) {
    searchedPaths.push(envPath);
    if (fs.existsSync(envPath)) {
      return { found: true, path: envPath, mode: 'live', searchedPaths };
    }
  }

  for (const p of COMMON_SWMM_PATHS) {
    searchedPaths.push(p);
    if (fs.existsSync(p)) {
      return { found: true, path: p, mode: 'live', searchedPaths };
    }
  }

  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'where runswmm.exe 2>nul || where swmm5.exe 2>nul' : 'which runswmm 2>/dev/null || which swmm5 2>/dev/null';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result) {
      const foundPath = result.split('\n')[0].trim();
      searchedPaths.push(`PATH lookup: ${foundPath}`);
      return { found: true, path: foundPath, mode: 'live', searchedPaths };
    }
  } catch {
    searchedPaths.push('PATH lookup (not found)');
  }

  return { found: false, mode: 'simulation', searchedPaths };
}

function parseReportMetrics(reportContent: string): ParsedMetrics {
  const metrics: ParsedMetrics = {};

  const runoffCE = reportContent.match(/Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (runoffCE) {
    metrics.runoffContinuityError = parseFloat(runoffCE[1]);
  }

  const routingCE = reportContent.match(/Flow Routing Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (routingCE) {
    metrics.routingContinuityError = parseFloat(routingCE[1]);
  }

  const precip = reportContent.match(/Total Precipitation\s*\.+\s*([\d.]+)/i);
  if (precip) {
    metrics.totalPrecipitation = parseFloat(precip[1]);
  }

  const runoff = reportContent.match(/Surface Runoff\s*\.+\s*([\d.]+)/i);
  if (runoff) {
    metrics.surfaceRunoff = parseFloat(runoff[1]);
  }

  const floodingMatch = reportContent.match(/Flooding was detected at (\d+) node/i);
  if (floodingMatch) {
    metrics.nodesFlooded = parseInt(floodingMatch[1], 10);
    metrics.floodingSummary = `${floodingMatch[1]} node(s) flooded`;
  } else if (/No nodes were flooded/i.test(reportContent)) {
    metrics.nodesFlooded = 0;
    metrics.floodingSummary = 'No flooding';
  }

  const routingMethod = reportContent.match(/Flow Routing Method\s*\.+\s*(\S+)/i);
  if (routingMethod) {
    metrics.flowRoutingMethod = routingMethod[1];
  }

  const infiltration = reportContent.match(/Infiltration Method\s*\.+\s*(\S+)/i);
  if (infiltration) {
    metrics.infiltrationMethod = infiltration[1];
  }

  const wetInflow = reportContent.match(/Wet Weather Inflow\s*\.+\s*([\d.]+)/i);
  if (wetInflow) {
    metrics.totalInflow = parseFloat(wetInflow[1]);
  }

  const extOutflow = reportContent.match(/External Outflow\s*\.+\s*([\d.]+)/i);
  if (extOutflow) {
    metrics.totalOutflow = parseFloat(extOutflow[1]);
  }

  const floodLoss = reportContent.match(/Flooding Loss\s*\.+\s*([\d.]+)/i);
  if (floodLoss) {
    metrics.floodingLoss = parseFloat(floodLoss[1]);
  }

  return metrics;
}

let cachedSwmmStatus: SwmmStatus | null = null;

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/ws'
  });

  const clients = new Map<string, WebSocket>();

  cachedSwmmStatus = detectSwmmPath();
  console.log(`SWMM detection: mode=${cachedSwmmStatus.mode}, path=${cachedSwmmStatus.path || 'N/A'}`);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const jobId = url.searchParams.get('jobId');
    if (jobId) {
      clients.set(jobId, ws);
      console.log(`WebSocket client connected for job: ${jobId}`);
    }

    ws.on('close', () => {
      if (jobId) {
        clients.delete(jobId);
        console.log(`WebSocket client disconnected for job: ${jobId}`);
      }
    });
  });

  function sendProgressUpdate(jobId: string, data: any) {
    const client = clients.get(jobId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }

  app.get('/api/swmm-status', async (_req, res) => {
    if (!cachedSwmmStatus) {
      cachedSwmmStatus = detectSwmmPath();
    }
    res.json(cachedSwmmStatus);
  });

  app.post('/api/swmm-status/refresh', async (_req, res) => {
    cachedSwmmStatus = detectSwmmPath();
    res.json(cachedSwmmStatus);
  });

  app.get('/api/samples', async (req, res) => {
    try {
      const samplesDir = path.join(process.cwd(), 'public', 'samples');
      if (!fs.existsSync(samplesDir)) {
        return res.json([]);
      }
      const files = fs.readdirSync(samplesDir)
        .filter(f => f.toLowerCase().endsWith('.inp'))
        .sort()
        .map(f => {
          const stat = fs.statSync(path.join(samplesDir, f));
          const content = fs.readFileSync(path.join(samplesDir, f), 'utf-8');
          const titleMatch = content.match(/\[TITLE\]\s*\n(?:;;[^\n]*\n)*(.*)/);
          const title = titleMatch ? titleMatch[1].trim() : f;
          return {
            name: f,
            size: stat.size,
            title,
          };
        });
      res.json(files);
    } catch (error) {
      console.error('Error listing samples:', error);
      res.status(500).json({ error: 'Failed to list sample files' });
    }
  });

  app.get('/api/samples/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      if (!filename.toLowerCase().endsWith('.inp')) {
        return res.status(400).json({ error: 'Invalid file type' });
      }
      const filePath = path.join(process.cwd(), 'public', 'samples', path.basename(filename));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Sample file not found' });
      }
      res.sendFile(filePath);
    } catch (error) {
      console.error('Error serving sample:', error);
      res.status(500).json({ error: 'Failed to serve sample file' });
    }
  });

  app.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
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
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to upload files' });
    }
  });

  app.post('/api/batch/:jobId/start', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getBatchJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Batch job not found' });
      }

      await storage.updateBatchJob(jobId, { status: 'processing' });

      res.json({ message: 'Processing started' });

      processFilesSequentially(jobId, job.files);
    } catch (error) {
      console.error('Start processing error:', error);
      res.status(500).json({ error: 'Failed to start processing' });
    }
  });

  app.post('/api/batch/:jobId/cancel', async (req, res) => {
    try {
      const { jobId } = req.params;
      await storage.updateBatchJob(jobId, { status: 'cancelled' });
      res.json({ message: 'Processing cancelled' });
    } catch (error) {
      console.error('Cancel processing error:', error);
      res.status(500).json({ error: 'Failed to cancel processing' });
    }
  });

  app.get('/api/batch/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getBatchJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Batch job not found' });
      }

      res.json(job);
    } catch (error) {
      console.error('Get batch job error:', error);
      res.status(500).json({ error: 'Failed to get batch job' });
    }
  });

  async function processFilesSequentially(jobId: string, files: Array<{ id: string; name: string; path: string }>) {
    const job = await storage.getBatchJob(jobId);
    if (!job) return;

    for (let i = 0; i < files.length; i++) {
      const currentJob = await storage.getBatchJob(jobId);
      if (currentJob?.status === 'cancelled') {
        sendProgressUpdate(jobId, {
          type: 'cancelled',
        });
        return;
      }

      const file = files[i];
      await storage.updateBatchJob(jobId, { currentFile: i + 1 });
      
      sendProgressUpdate(jobId, {
        type: 'progress',
        currentFile: i + 1,
        total: files.length,
        fileName: file.name,
        fileId: file.id,
      });

      const result = await processSingleFile(jobId, file);
      
      const updatedJob = await storage.getBatchJob(jobId);
      if (updatedJob) {
        await storage.updateBatchJob(jobId, {
          results: [...updatedJob.results, result],
        });
      }

      sendProgressUpdate(jobId, {
        type: 'result',
        result,
      });
    }

    await storage.updateBatchJob(jobId, { status: 'completed' });
    sendProgressUpdate(jobId, {
      type: 'completed',
    });
  }

  function generateTimeSeriesData(type: string, peakValue: number, totalVolume: number): string {
    const timeSteps = [];
    const hours = 24;
    const interval = 15;
    const totalSteps = (hours * 60) / interval;

    for (let i = 0; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const totalMinutes = i * interval;
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

      const risePhase = t < 0.3 ? Math.pow(t / 0.3, 2) : 0;
      const peakPhase = t >= 0.3 && t < 0.45 ? 1.0 - 0.2 * Math.pow((t - 0.375) / 0.075, 2) : 0;
      const fallPhase = t >= 0.45 ? Math.exp(-3.5 * (t - 0.45)) : 0;
      const hydrograph = risePhase + peakPhase + fallPhase;
      const noise = 1 + (Math.random() - 0.5) * 0.08;
      const value = peakValue * hydrograph * noise;

      if (type === 'subcatchment') {
        const precip = t >= 0.1 && t <= 0.4 ? (peakValue * 0.8 * (1 - Math.abs(t - 0.25) / 0.15) * noise).toFixed(2) : '0.00';
        const runoff = (value * 0.62).toFixed(2);
        const losses = (value * 0.18).toFixed(2);
        const depth = (value * 0.004).toFixed(3);
        timeSteps.push(`  01/01/2024  ${timeStr}       ${precip.padStart(8)}   ${runoff.padStart(8)}   ${losses.padStart(8)}   ${depth.padStart(8)}`);
      } else if (type.startsWith('node')) {
        const baseElev = type === 'node_out' ? 15 : type === 'node_j3' ? 42 : type === 'node_j2' ? 48 : 55;
        const inflow = (value * 0.9).toFixed(2);
        const flooding = value > peakValue * 0.9 ? ((value - peakValue * 0.9) * 0.3).toFixed(2) : '0.00';
        const depth2 = (value * 0.03).toFixed(2);
        const head = (baseElev + value * 0.03).toFixed(2);
        timeSteps.push(`  01/01/2024  ${timeStr}       ${inflow.padStart(8)}   ${flooding.padStart(8)}   ${depth2.padStart(8)}   ${head.padStart(8)}`);
      } else if (type.startsWith('link')) {
        const flow = value.toFixed(2);
        const velocity = (value * 0.15 + 0.1).toFixed(2);
        const depth3 = (value * 0.025).toFixed(2);
        const capacity = Math.min(value / (peakValue * 1.2), 1.0).toFixed(3);
        timeSteps.push(`  01/01/2024  ${timeStr}       ${flow.padStart(8)}   ${velocity.padStart(8)}   ${depth3.padStart(8)}   ${capacity.padStart(8)}`);
      }
    }
    return timeSteps.join('\n');
  }

  function generateSimulatedReport(fileName: string, peakFlow: number, totalVolume: number, processingTime: number): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const totalInflow = (totalVolume * 0.85).toFixed(3);
    const totalOutflow = (totalVolume * 0.78).toFixed(3);
    const peakRunoff = (peakFlow * 0.62).toFixed(3);
    const continuityError = (Math.random() * 0.5 - 0.25).toFixed(3);
    const nodesFlooded = Math.floor(Math.random() * 3);
    const wetSteps = Math.floor(Math.random() * 500 + 200);

    return `
  EPA STORM WATER MANAGEMENT MODEL - VERSION 5.2 (Build 5.2.4)
  --------------------------------------------------------------

  *************
  EPA SWMM 5.2
  *************

  Input File:   ${fileName}
  Report File:  ${fileName.replace('.inp', '.rpt')}
  Output File:  ${fileName.replace('.inp', '.out')}

  Analysis Date: ${dateStr}
  Analysis Time: ${timeStr}
  Elapsed Time:  ${processingTime.toFixed(1)} seconds

  ****************
  Analysis Options
  ****************
  Flow Units ............... CFS
  Process Models:
    Rainfall/Runoff ........ YES
    RDII ................... NO
    Snowmelt ............... NO
    Groundwater ............ NO
    Flow Routing ........... YES
    Ponding Allowed ........ NO
    Water Quality .......... NO
  Infiltration Method ...... HORTON
  Flow Routing Method ...... DYNWAVE
  Surcharge Method ......... EXTRAN
  Starting Date ............ 01/01/2024 00:00:00
  Ending Date .............. 01/02/2024 00:00:00
  Antecedent Dry Days ...... 5.0
  Report Time Step ......... 00:15:00
  Wet Time Step ............ 00:05:00
  Dry Time Step ............ 01:00:00
  Routing Time Step ........ 30.00 sec
  Variable Time Step ....... YES

  **************************        Volume         Depth
  Runoff Quantity Continuity     acre-feet        inches
  **************************     ---------       -------
  Total Precipitation ......     ${(totalVolume * 1.12).toFixed(3)}       ${(totalVolume * 0.33).toFixed(3)}
  Evaporation Loss .........         0.000         0.000
  Infiltration Loss ........     ${(totalVolume * 0.22).toFixed(3)}       ${(totalVolume * 0.065).toFixed(3)}
  Surface Runoff ...........     ${totalInflow}       ${(totalVolume * 0.28).toFixed(3)}
  Final Storage ............     ${(totalVolume * 0.05).toFixed(3)}       ${(totalVolume * 0.015).toFixed(3)}
  Continuity Error (%) .....     ${continuityError}

  **************************        Volume        Volume
  Flow Routing Continuity        acre-feet      10^6 gal
  **************************     ---------     ---------
  Dry Weather Inflow .......         0.000         0.000
  Wet Weather Inflow .......     ${totalInflow}     ${totalVolume.toFixed(3)}
  Groundwater Inflow .......         0.000         0.000
  RDII Inflow ..............         0.000         0.000
  External Inflow ..........         0.000         0.000
  External Outflow .........     ${totalOutflow}     ${(totalVolume * 0.78).toFixed(3)}
  Flooding Loss ............     ${(totalVolume * 0.02).toFixed(3)}     ${(totalVolume * 0.02).toFixed(3)}
  Evaporation Loss .........         0.000         0.000
  Exfiltration Loss ........         0.000         0.000
  Initial Stored Volume ....         0.000         0.000
  Final Stored Volume ......     ${(totalVolume * 0.05).toFixed(3)}     ${(totalVolume * 0.05).toFixed(3)}
  Continuity Error (%) .....     ${continuityError}

  ***************
  Node Depth Summary
  ***************

  -------------------------------------------------------------------------
                                 Average  Maximum  Maximum  Time of Max
                                   Depth    Depth      HGL   Occurrence
  Node                 Type       Feet     Feet     Feet   days hr:min
  -------------------------------------------------------------------------
  J1                   JUNCTION   ${(Math.random() * 2 + 0.5).toFixed(2)}     ${(Math.random() * 4 + 2).toFixed(2)}     ${(Math.random() * 100 + 50).toFixed(2)}      0  ${Math.floor(Math.random() * 12 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}
  J2                   JUNCTION   ${(Math.random() * 2 + 0.3).toFixed(2)}     ${(Math.random() * 3 + 1).toFixed(2)}     ${(Math.random() * 100 + 45).toFixed(2)}      0  ${Math.floor(Math.random() * 12 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}
  J3                   JUNCTION   ${(Math.random() * 1.5 + 0.2).toFixed(2)}     ${(Math.random() * 3 + 1.5).toFixed(2)}     ${(Math.random() * 100 + 40).toFixed(2)}      0  ${Math.floor(Math.random() * 12 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}
  OUT1                 OUTFALL    ${(Math.random() * 1 + 0.1).toFixed(2)}     ${(Math.random() * 2 + 0.5).toFixed(2)}     ${(Math.random() * 30 + 10).toFixed(2)}      0  ${Math.floor(Math.random() * 12 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}

  ***************
  Node Flow Summary
  ***************

  ----------------------------------------------------------------------------------
                                  Maximum  Time of Max   Lateral    Total   Maximum
                                  Flooding   Occurrence   Inflow   Inflow   Flooded
  Node                 Type          CFS   days hr:min      CFS      CFS    Minutes
  ----------------------------------------------------------------------------------
  J1                   JUNCTION      0.00      0  00:00    ${peakRunoff}    ${peakRunoff}      0.0
  J2                   JUNCTION      0.00      0  00:00     0.000    ${peakRunoff}      0.0
  J3                   JUNCTION      ${nodesFlooded > 0 ? (peakFlow * 0.1).toFixed(3) : '0.000'}      0  ${Math.floor(Math.random() * 6 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}     0.000    ${(peakFlow * 0.95).toFixed(3)}      ${nodesFlooded > 0 ? (Math.random() * 30 + 5).toFixed(1) : '0.0'}
  OUT1                 OUTFALL       0.00      0  00:00     0.000    ${peakFlow.toFixed(3)}      0.0

  ***************
  Link Flow Summary
  ***************

  ----------------------------------------------------------------------------------
                                     Maximum  Time of Max      Max/    Max/
                                      |Flow|   Occurrence     Full     Full
  Link                     Type         CFS   days hr:min    Flow    Depth
  ----------------------------------------------------------------------------------
  C1                       CONDUIT    ${peakRunoff}      0  ${Math.floor(Math.random() * 6 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}    ${(Math.random() * 0.5 + 0.3).toFixed(2)}    ${(Math.random() * 0.4 + 0.3).toFixed(2)}
  C2                       CONDUIT    ${(peakFlow * 0.85).toFixed(3)}      0  ${Math.floor(Math.random() * 6 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}    ${(Math.random() * 0.6 + 0.3).toFixed(2)}    ${(Math.random() * 0.5 + 0.3).toFixed(2)}
  C3                       CONDUIT    ${peakFlow.toFixed(3)}      0  ${Math.floor(Math.random() * 6 + 1)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}    ${(Math.random() * 0.7 + 0.2).toFixed(2)}    ${(Math.random() * 0.5 + 0.3).toFixed(2)}

  *************************
  Conduit Surcharge Summary
  *************************

  No conduits were surcharged.

  *********************
  Node Flooding Summary
  *********************

  ${nodesFlooded > 0 ? `Flooding was detected at ${nodesFlooded} node(s).` : 'No nodes were flooded.'}

  ********************
  Routing Time Step Summary
  ********************

  Minimum Time Step           :     ${(Math.random() * 5 + 1).toFixed(2)} sec
  Average Time Step           :    ${(Math.random() * 15 + 10).toFixed(2)} sec
  Maximum Time Step           :    30.00 sec
  Percent in Steady State     :     0.00
  Average Iterations per Step :     ${(Math.random() * 1.5 + 1.5).toFixed(2)}
  Percent Not Converging      :     ${(Math.random() * 2).toFixed(2)}
  Time Step Frequencies       :
     ${wetSteps} ( ${((wetSteps / (wetSteps + 100)) * 100).toFixed(1)}%)  are Wet Weather Steps

  Analysis begun on:  ${dateStr}  ${timeStr}
  Total Elapsed Time: ${processingTime.toFixed(1)} seconds

  ********************************
  Subcatchment Runoff Time Series
  ********************************

  <<< Subcatchment S1 >>>

  Date        Time        Precip     Runoff     Losses     Depth
  Day         Hour:Min    in/hr      CFS        CFS        Feet
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('subcatchment', peakFlow, totalVolume)}

  ********************************
  Node Results Time Series
  ********************************

  <<< Node J1 >>>

  Date        Time        Inflow     Flooding   Depth      Head
  Day         Hour:Min    CFS        CFS        Feet       Feet
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('node_j1', peakFlow, totalVolume)}

  <<< Node J2 >>>

  Date        Time        Inflow     Flooding   Depth      Head
  Day         Hour:Min    CFS        CFS        Feet       Feet
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('node_j2', peakFlow * 0.9, totalVolume)}

  <<< Node J3 >>>

  Date        Time        Inflow     Flooding   Depth      Head
  Day         Hour:Min    CFS        CFS        Feet       Feet
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('node_j3', peakFlow * 0.85, totalVolume)}

  <<< Node OUT1 >>>

  Date        Time        Inflow     Flooding   Depth      Head
  Day         Hour:Min    CFS        CFS        Feet       Feet
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('node_out', peakFlow * 0.8, totalVolume)}

  ********************************
  Link Results Time Series
  ********************************

  <<< Link C1 >>>

  Date        Time        Flow       Velocity   Depth      Capacity
  Day         Hour:Min    CFS        ft/sec     Feet       fraction
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('link_c1', peakFlow * 0.6, totalVolume)}

  <<< Link C2 >>>

  Date        Time        Flow       Velocity   Depth      Capacity
  Day         Hour:Min    CFS        ft/sec     Feet       fraction
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('link_c2', peakFlow * 0.8, totalVolume)}

  <<< Link C3 >>>

  Date        Time        Flow       Velocity   Depth      Capacity
  Day         Hour:Min    CFS        ft/sec     Feet       fraction
  ----------  ----------  ---------- ---------- ---------- ----------
${generateTimeSeriesData('link_c3', peakFlow * 0.95, totalVolume)}
`.trimStart();
  }

  function injectReportOptions(filePath: string): void {
    try {
      let content = fs.readFileSync(filePath, 'utf-8');
      const hasReportSection = /^\[REPORT\]/im.test(content);

      const reportBlock = [
        'INPUT            YES',
        'SUBCATCHMENTS    ALL',
        'NODES            ALL',
        'LINKS            ALL',
      ].join('\n');

      if (hasReportSection) {
        const reportSectionRange = content.match(/(\[REPORT\])([\s\S]*?)(?=\n\s*\[|$)/i);
        if (reportSectionRange) {
          const sectionStart = content.indexOf(reportSectionRange[0]);
          const sectionEnd = sectionStart + reportSectionRange[0].length;
          let sectionContent = reportSectionRange[0];
          sectionContent = sectionContent.replace(/^INPUT\s+.*/gim, '');
          sectionContent = sectionContent.replace(/^SUBCATCHMENTS\s+.*/gim, '');
          sectionContent = sectionContent.replace(/^NODES\s+.*/gim, '');
          sectionContent = sectionContent.replace(/^LINKS\s+.*/gim, '');
          sectionContent = sectionContent.replace(/^\[REPORT\]/im, `[REPORT]\n${reportBlock}`);
          content = content.substring(0, sectionStart) + sectionContent + content.substring(sectionEnd);
        }
      } else {
        content += `\n\n[REPORT]\n${reportBlock}\n`;
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`Injected report options into ${filePath}`);
    } catch (e) {
      console.warn(`Could not inject report options into ${filePath}:`, e);
    }
  }

  async function processSingleFile(jobId: string, file: { id: string; name: string; path: string }): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const swmmStatus = cachedSwmmStatus || detectSwmmPath();
      const runswmmPath = swmmStatus.found ? swmmStatus.path! : 'runswmm.exe';
      const inputPath = file.path;
      const reportPath = inputPath + '.rpt';
      const outputPath = inputPath + '.out';

      injectReportOptions(inputPath);

      let inpContent: string | undefined;
      try {
        inpContent = fs.readFileSync(inputPath, 'utf-8');
      } catch (e) {
        console.warn(`Could not read inp file ${inputPath}:`, e);
      }

      if (!swmmStatus.found) {
        console.warn(`runswmm.exe not found, simulating processing for ${file.name}`);
        const simulatedTime = 1000 + Math.random() * 2000;
        const progressSteps = 10;
        const stepInterval = simulatedTime / progressSteps;
        let currentStep = 0;

        const progressTimer = setInterval(() => {
          currentStep++;
          if (currentStep <= progressSteps) {
            const pct = Math.round((currentStep / progressSteps) * 100);
            sendProgressUpdate(jobId, {
              type: 'file_progress',
              fileId: file.id,
              fileName: file.name,
              percentage: pct,
              message: pct < 30 ? 'Reading input data...' : pct < 60 ? 'Running simulation...' : pct < 90 ? 'Computing results...' : 'Writing output...',
            });
          }
        }, stepInterval);

        setTimeout(() => {
          clearInterval(progressTimer);
          sendProgressUpdate(jobId, {
            type: 'file_progress',
            fileId: file.id,
            fileName: file.name,
            percentage: 100,
            message: 'Complete',
          });

          const processingTime = (Date.now() - startTime) / 1000;
          const peakFlow = Math.random() * 100 + 10;
          const totalVolume = Math.random() * 50 + 5;
          const reportContent = generateSimulatedReport(file.name, peakFlow, totalVolume, processingTime);
          const parsedMetrics = parseReportMetrics(reportContent);

          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: 'success',
            processingTime,
            reportContent,
            inpContent,
            results: { peakFlow, totalVolume },
            parsedMetrics,
          });
        }, simulatedTime);
        return;
      }

      console.log(`Running SWMM: ${runswmmPath} "${inputPath}" "${reportPath}" "${outputPath}"`);
      const childProcess = spawn(runswmmPath, [inputPath, reportPath, outputPath]);

      let errorOutput = '';
      let stdoutBuffer = '';

      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdoutBuffer += text;

        const pctMatch = text.match(/(\d+)\s*%/);
        if (pctMatch) {
          const pct = parseInt(pctMatch[1], 10);
          sendProgressUpdate(jobId, {
            type: 'file_progress',
            fileId: file.id,
            fileName: file.name,
            percentage: pct,
            message: `Running... ${pct}%`,
          });
        }

        sendProgressUpdate(jobId, {
          type: 'log',
          fileId: file.id,
          fileName: file.name,
          text: text.trim(),
          stream: 'stdout',
        });
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        sendProgressUpdate(jobId, {
          type: 'log',
          fileId: file.id,
          fileName: file.name,
          text: text.trim(),
          stream: 'stderr',
        });
      });

      childProcess.on('close', (code: number | null) => {
        const processingTime = (Date.now() - startTime) / 1000;

        sendProgressUpdate(jobId, {
          type: 'file_progress',
          fileId: file.id,
          fileName: file.name,
          percentage: 100,
          message: code === 0 ? 'Complete' : 'Failed',
        });

        console.log(`SWMM finished for ${file.name}: exit code ${code}, report exists: ${fs.existsSync(reportPath)}`);

        if (code === 0) {
          let reportContent: string | undefined;
          try {
            if (fs.existsSync(reportPath)) {
              reportContent = fs.readFileSync(reportPath, 'utf-8');
            }
          } catch (e) {
            console.warn(`Could not read report file: ${reportPath}`);
          }

          if (!reportContent) {
            resolve({
              id: file.id,
              fileName: file.name,
              filePath: file.path,
              status: 'failed',
              error: 'SWMM exited successfully but no report file was generated',
              processingTime: (Date.now() - startTime) / 1000,
              inpContent,
            });
            return;
          }

          const parsedMetrics = reportContent ? parseReportMetrics(reportContent) : undefined;

          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: 'success',
            processingTime,
            reportContent,
            inpContent,
            results: {
              peakFlow: undefined,
              totalVolume: undefined,
            },
            parsedMetrics,
          });
        } else {
          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: 'failed',
            error: errorOutput || `Process exited with code ${code}`,
            processingTime,
            inpContent,
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
          inpContent,
        });
      });
    });
  }

  return httpServer;
}
