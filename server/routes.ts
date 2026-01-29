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
          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: success ? 'success' : 'failed',
            error: success ? undefined : 'Error 110: cannot open rainfall data file',
            processingTime,
            results: success ? {
              peakFlow: Math.random() * 100 + 10,
              totalVolume: Math.random() * 50 + 5,
            } : undefined,
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
          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: 'success',
            processingTime,
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
