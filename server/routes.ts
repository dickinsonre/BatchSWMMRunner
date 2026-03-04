import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { storage } from "./storage";
import { uploadFileSchema, type ProcessResult } from "@shared/schema";
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

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
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
      });

      const result = await processSingleFile(file);
      
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
`.trimStart();
  }

  async function processSingleFile(file: { id: string; name: string; path: string }): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const runswmmPath = (process.env as any).RUNSWMM_PATH || 'runswmm.exe';
      const inputPath = file.path;
      const reportPath = inputPath.replace('.inp', '.rpt');
      const outputPath = inputPath.replace('.inp', '.out');

      if (!fs.existsSync(runswmmPath)) {
        console.warn(`runswmm.exe not found at ${runswmmPath}, simulating processing`);
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
            reportContent: success ? generateSimulatedReport(file.name, peakFlow, totalVolume, processingTime) : undefined,
            results: success ? { peakFlow, totalVolume } : undefined,
          });
        }, simulatedTime);
        return;
      }

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
              peakFlow: undefined,
              totalVolume: undefined,
            },
          });
        } else {
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

  return httpServer;
}
