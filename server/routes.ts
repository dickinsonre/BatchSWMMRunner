import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";
import { storage } from "./storage";
import { uploadFileSchema, type ProcessResult, type ParsedMetrics, type SwmmStatus, type SweepResult, type SweepConfig, type DesignStormConfig } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import * as swmm5api from "./swmm5api";
import { parseReportMetrics, extractReportIssues, extractEngineVersion, validateSwmmReport } from "./reportParser";

const MAX_UPLOAD_FILES = 100;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 250 * 1024 * 1024;
const DEFAULT_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_MINUTES = 60;
const RETENTION_HOURS = 24;
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const upload = multer({
  dest: path.join(UPLOADS_DIR, 'tmp'),
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.inp') {
      cb(null, true);
    } else {
      cb(new Error('Only .inp files are allowed'));
    }
  },
});

interface ActiveJobEntry {
  child?: ReturnType<typeof spawn>;
  stopSignal: 'cancelled' | 'timeout' | null;
  killTimer?: NodeJS.Timeout;
}

const activeJobs = new Map<string, ActiveJobEntry>();

function getStopSignal(entry: ActiveJobEntry): 'cancelled' | 'timeout' | null {
  return entry.stopSignal;
}

function jobDir(jobId: string): string {
  return path.join(UPLOADS_DIR, jobId);
}

function cleanupJobFiles(jobId: string): void {
  try {
    const dir = jobDir(jobId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn(`Failed to clean up files for job ${jobId}:`, e);
  }
}

function killJobProcess(entry: ActiveJobEntry): void {
  const child = entry.child;
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {}
  entry.killTimer = setTimeout(() => {
    try {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
    } catch {}
  }, 5000);
}

function removePartialOutputs(inputPath: string): void {
  for (const ext of ['.rpt', '.out']) {
    try {
      const p = inputPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
}

function looksLikeSwmmInput(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const sample = buf.subarray(0, bytesRead);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === 0) return false;
      if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
    }
    if (sample.length > 0 && nonPrintable / sample.length > 0.05) return false;
    const text = sample.toString('latin1');
    return /^\s*\[\s*[A-Za-z_]+\s*\]/m.test(text);
  } catch {
    return false;
  }
}

async function sweepStaleUploads(): Promise<void> {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    const cutoff = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;
    for (const entryName of fs.readdirSync(UPLOADS_DIR)) {
      const full = path.join(UPLOADS_DIR, entryName);
      try {
        const stat = fs.statSync(full);
        if (entryName === 'tmp' || stat.mtimeMs < cutoff || !stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {}
    }
    const removedJobIds = await storage.deleteJobsOlderThan(new Date(cutoff));
    for (const id of removedJobIds) {
      cleanupJobFiles(id);
    }
    if (removedJobIds.length > 0) {
      console.log(`Startup sweep: removed ${removedJobIds.length} expired batch job(s)`);
    }
  } catch (e) {
    console.warn('Startup upload sweep failed:', e);
  } finally {
    try {
      fs.mkdirSync(path.join(UPLOADS_DIR, 'tmp'), { recursive: true });
    } catch {}
  }
}

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

  return { found: false, mode: 'unavailable', searchedPaths };
}

function enrichWithApiStatus(status: SwmmStatus): SwmmStatus {
  const apiAvailable = swmm5api.isApiAvailable();
  let apiVersion: number | undefined;
  if (apiAvailable) {
    try {
      apiVersion = swmm5api.getVersion();
    } catch (e) {
      console.warn('Could not get SWMM API version:', e);
    }
  }
  return { ...status, apiAvailable, apiVersion };
}

function parseSwmmOutputBinary(outPath: string): string {
  try {
    if (!fs.existsSync(outPath)) return '';
    const buf = fs.readFileSync(outPath);
    if (buf.length < 40) return '';

    const magic = buf.readInt32LE(0);
    if (magic !== 516114522) return '';

    const fileSize = buf.length;
    const nSub = buf.readInt32LE(12);
    const nNode = buf.readInt32LE(16);
    const nLink = buf.readInt32LE(20);
    const nPoll = buf.readInt32LE(24);
    const idStart = buf.readInt32LE(fileSize - 6 * 4);
    const propStart = buf.readInt32LE(fileSize - 5 * 4);
    const resultStart = buf.readInt32LE(fileSize - 4 * 4);
    const numPeriods = buf.readInt32LE(fileSize - 3 * 4);
    const errorCode = buf.readInt32LE(fileSize - 2 * 4);

    if (errorCode !== 0 || numPeriods < 1) return '';
    if (resultStart <= 0 || resultStart >= fileSize) return '';

    let pos = idStart;
    const subNames: string[] = [];
    const nodeNames: string[] = [];
    const linkNames: string[] = [];
    for (let i = 0; i < nSub; i++) { const len = buf.readInt32LE(pos); pos += 4; subNames.push(buf.toString('utf8', pos, pos + len)); pos += len; }
    for (let i = 0; i < nNode; i++) { const len = buf.readInt32LE(pos); pos += 4; nodeNames.push(buf.toString('utf8', pos, pos + len)); pos += len; }
    for (let i = 0; i < nLink; i++) { const len = buf.readInt32LE(pos); pos += 4; linkNames.push(buf.toString('utf8', pos, pos + len)); pos += len; }

    pos = propStart;
    const nSubProps = buf.readInt32LE(pos); pos += 4;
    pos += nSubProps * 4 + nSub * nSubProps * 4;
    const nNodeProps = buf.readInt32LE(pos); pos += 4;
    pos += nNodeProps * 4 + nNode * nNodeProps * 4;
    const nLinkProps = buf.readInt32LE(pos); pos += 4;
    pos += nLinkProps * 4 + nLink * nLinkProps * 4;

    const nSubVars = buf.readInt32LE(pos); pos += 4; pos += nSubVars * 4;
    const nNodeVars = buf.readInt32LE(pos); pos += 4; pos += nNodeVars * 4;
    const nLinkVars = buf.readInt32LE(pos); pos += 4; pos += nLinkVars * 4;
    const nSysVars = buf.readInt32LE(pos); pos += 4; pos += nSysVars * 4;

    const startDateOLE = buf.readDoubleLE(pos); pos += 8;
    const reportStep = buf.readInt32LE(pos); pos += 4;

    if (pos !== resultStart) return '';

    const bytesPerPeriod = 8 + 4 * (nSub * nSubVars + nNode * nNodeVars + nLink * nLinkVars + nSysVars);
    const expectedEnd = resultStart + bytesPerPeriod * numPeriods;
    if (expectedEnd > fileSize) return '';

    const oleEpochMs = new Date(1899, 11, 30).getTime();
    const msPerDay = 86400000;

    function oleToDateStr(oleDate: number): { date: string; time: string } {
      const d = new Date(oleEpochMs + oleDate * msPerDay);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return { date: `${mm}/${dd}/${yyyy}`, time: `${hh}:${min}` };
    }

    const maxPeriods = Math.min(numPeriods, 2000);
    const lines: string[] = [];

    const baseSubVarNames = ['Rainfall', 'Snow Depth', 'Evaporation', 'Infiltration', 'Runoff', 'GW Outflow', 'GW Elev', 'Soil Moisture'];
    const baseSubVarUnits = ['in/hr', 'in', 'in/day', 'in/hr', 'CFS', 'CFS', 'ft', ''];
    const baseNodeVarNames = ['Depth', 'Head', 'Volume', 'Lat.Inflow', 'Total Inflow', 'Flooding'];
    const baseNodeVarUnits = ['ft', 'ft', 'ft3', 'CFS', 'CFS', 'CFS'];
    const baseLinkVarNames = ['Flow', 'Depth', 'Velocity', 'Volume', 'Capacity'];
    const baseLinkVarUnits = ['CFS', 'ft', 'ft/sec', 'ft3', ''];
    const baseSysVarNames = ['Temperature', 'Rainfall', 'Snow Depth', 'Evaporation', 'Runoff', 'Dry Weather Inflow', 'GW Inflow', 'RDII Inflow', 'Direct Inflow', 'Total Lateral Inflow', 'Flooding', 'Outflow', 'Storage Volume', 'Evap Rate'];
    const baseSysVarUnits = ['deg F', 'in/hr', 'in', 'in/day', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'ft3', 'CFS'];

    const subVarLabels: string[] = [];
    const subVarUnitLabels: string[] = [];
    for (let v = 0; v < nSubVars; v++) {
      subVarLabels.push(v < baseSubVarNames.length ? baseSubVarNames[v] : `Pollutant_${v - baseSubVarNames.length + 1}`);
      subVarUnitLabels.push(v < baseSubVarUnits.length ? baseSubVarUnits[v] : 'mg/L');
    }
    const nodeVarLabels: string[] = [];
    const nodeVarUnitLabels: string[] = [];
    for (let v = 0; v < nNodeVars; v++) {
      nodeVarLabels.push(v < baseNodeVarNames.length ? baseNodeVarNames[v] : `Pollutant_${v - baseNodeVarNames.length + 1}`);
      nodeVarUnitLabels.push(v < baseNodeVarUnits.length ? baseNodeVarUnits[v] : 'mg/L');
    }
    const linkVarLabels: string[] = [];
    const linkVarUnitLabels: string[] = [];
    for (let v = 0; v < nLinkVars; v++) {
      linkVarLabels.push(v < baseLinkVarNames.length ? baseLinkVarNames[v] : `Pollutant_${v - baseLinkVarNames.length + 1}`);
      linkVarUnitLabels.push(v < baseLinkVarUnits.length ? baseLinkVarUnits[v] : 'mg/L');
    }
    const sysVarLabels: string[] = [];
    const sysVarUnitLabels: string[] = [];
    for (let v = 0; v < nSysVars; v++) {
      sysVarLabels.push(v < baseSysVarNames.length ? baseSysVarNames[v] : `Var_${v + 1}`);
      sysVarUnitLabels.push(v < baseSysVarUnits.length ? baseSysVarUnits[v] : '');
    }

    if (nSub > 0 && nSubVars > 0) {
      lines.push('');
      lines.push('  **************');
      lines.push('  Subcatchment Results Time Series');
      lines.push('  **************');
      lines.push('');

      for (let s = 0; s < nSub; s++) {
        lines.push(`  <<< ${subNames[s]} >>>`);
        lines.push('');
        const cols = ['Date', 'Time', ...subVarLabels];
        lines.push('  ' + cols.map(c => c.padEnd(16)).join(''));
        const units = ['Day', 'Hour:Min', ...subVarUnitLabels];
        lines.push('  ' + units.map(u => u.padEnd(16)).join(''));
        lines.push('  ' + '-'.repeat(cols.length * 16));

        for (let p = 0; p < maxPeriods; p++) {
          const periodStart = resultStart + p * bytesPerPeriod;
          const dateVal = buf.readDoubleLE(periodStart);
          const { date, time } = oleToDateStr(dateVal);
          const subDataStart = periodStart + 8 + s * nSubVars * 4;
          const vals: string[] = [date.padEnd(16), time.padEnd(16)];
          for (let v = 0; v < nSubVars; v++) {
            vals.push(buf.readFloatLE(subDataStart + v * 4).toFixed(3).padStart(12).padEnd(16));
          }
          lines.push('  ' + vals.join(''));
        }
        lines.push('');
      }
    }

    if (nNode > 0 && nNodeVars > 0) {
      lines.push('');
      lines.push('  **************');
      lines.push('  Node Results Time Series');
      lines.push('  **************');
      lines.push('');

      for (let n = 0; n < nNode; n++) {
        lines.push(`  <<< ${nodeNames[n]} >>>`);
        lines.push('');
        const cols = ['Date', 'Time', ...nodeVarLabels];
        lines.push('  ' + cols.map(c => c.padEnd(16)).join(''));
        const units = ['Day', 'Hour:Min', ...nodeVarUnitLabels];
        lines.push('  ' + units.map(u => u.padEnd(16)).join(''));
        lines.push('  ' + '-'.repeat(cols.length * 16));

        for (let p = 0; p < maxPeriods; p++) {
          const periodStart = resultStart + p * bytesPerPeriod;
          const dateVal = buf.readDoubleLE(periodStart);
          const { date, time } = oleToDateStr(dateVal);
          const nodeDataStart = periodStart + 8 + nSub * nSubVars * 4 + n * nNodeVars * 4;
          const vals: string[] = [date.padEnd(16), time.padEnd(16)];
          for (let v = 0; v < nNodeVars; v++) {
            vals.push(buf.readFloatLE(nodeDataStart + v * 4).toFixed(3).padStart(12).padEnd(16));
          }
          lines.push('  ' + vals.join(''));
        }
        lines.push('');
      }
    }

    if (nLink > 0 && nLinkVars > 0) {
      lines.push('');
      lines.push('  **************');
      lines.push('  Link Results Time Series');
      lines.push('  **************');
      lines.push('');

      for (let l = 0; l < nLink; l++) {
        lines.push(`  <<< ${linkNames[l]} >>>`);
        lines.push('');
        const cols = ['Date', 'Time', ...linkVarLabels];
        lines.push('  ' + cols.map(c => c.padEnd(16)).join(''));
        const units = ['Day', 'Hour:Min', ...linkVarUnitLabels];
        lines.push('  ' + units.map(u => u.padEnd(16)).join(''));
        lines.push('  ' + '-'.repeat(cols.length * 16));

        for (let p = 0; p < maxPeriods; p++) {
          const periodStart = resultStart + p * bytesPerPeriod;
          const dateVal = buf.readDoubleLE(periodStart);
          const { date, time } = oleToDateStr(dateVal);
          const linkDataStart = periodStart + 8 + nSub * nSubVars * 4 + nNode * nNodeVars * 4 + l * nLinkVars * 4;
          const vals: string[] = [date.padEnd(16), time.padEnd(16)];
          for (let v = 0; v < nLinkVars; v++) {
            vals.push(buf.readFloatLE(linkDataStart + v * 4).toFixed(3).padStart(12).padEnd(16));
          }
          lines.push('  ' + vals.join(''));
        }
        lines.push('');
      }
    }

    if (nSysVars > 0) {
      lines.push('');
      lines.push('  **************');
      lines.push('  System Results Time Series');
      lines.push('  **************');
      lines.push('');

      lines.push(`  <<< System >>>`);
      lines.push('');
      const cols = ['Date', 'Time', ...sysVarLabels];
      lines.push('  ' + cols.map(c => c.padEnd(16)).join(''));
      const units = ['Day', 'Hour:Min', ...sysVarUnitLabels];
      lines.push('  ' + units.map(u => u.padEnd(16)).join(''));
      lines.push('  ' + '-'.repeat(cols.length * 16));

      for (let p = 0; p < maxPeriods; p++) {
        const periodStart = resultStart + p * bytesPerPeriod;
        const dateVal = buf.readDoubleLE(periodStart);
        const { date, time } = oleToDateStr(dateVal);
        const sysDataStart = periodStart + 8 + nSub * nSubVars * 4 + nNode * nNodeVars * 4 + nLink * nLinkVars * 4;
        const vals: string[] = [date.padEnd(16), time.padEnd(16)];
        for (let v = 0; v < nSysVars; v++) {
          vals.push(buf.readFloatLE(sysDataStart + v * 4).toFixed(3).padStart(12).padEnd(16));
        }
        lines.push('  ' + vals.join(''));
      }
      lines.push('');
    }

    return lines.join('\n');
  } catch (e) {
    console.warn(`Could not parse SWMM output binary: ${outPath}`, e);
    return '';
  }
}


let cachedSwmmStatus: SwmmStatus | null = null;

export async function registerRoutes(app: Express): Promise<Server> {
  sweepStaleUploads();

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/ws'
  });

  const clients = new Map<string, WebSocket>();
  const messageBuffers = new Map<string, any[]>();

  cachedSwmmStatus = detectSwmmPath();
  console.log(`SWMM detection: mode=${cachedSwmmStatus.mode}, path=${cachedSwmmStatus.path || 'N/A'}`);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const jobId = url.searchParams.get('jobId');
    if (jobId) {
      clients.set(jobId, ws);
      console.log(`WebSocket client connected for job: ${jobId}`);

      const buffered = messageBuffers.get(jobId);
      if (buffered && buffered.length > 0) {
        console.log(`Flushing ${buffered.length} buffered messages for job: ${jobId}`);
        for (const msg of buffered) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        }
        messageBuffers.delete(jobId);
      }
    }

    ws.on('close', () => {
      if (jobId) {
        clients.delete(jobId);
        messageBuffers.delete(jobId);
        console.log(`WebSocket client disconnected for job: ${jobId}`);
      }
    });
  });

  function sendProgressUpdate(jobId: string, data: any) {
    const client = clients.get(jobId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    } else {
      if (!messageBuffers.has(jobId)) {
        messageBuffers.set(jobId, []);
      }
      messageBuffers.get(jobId)!.push(data);
    }
  }

  app.get('/api/swmm-status', async (_req, res) => {
    if (!cachedSwmmStatus) {
      cachedSwmmStatus = detectSwmmPath();
    }
    res.json(enrichWithApiStatus(cachedSwmmStatus));
  });

  app.post('/api/swmm-status/refresh', async (_req, res) => {
    cachedSwmmStatus = detectSwmmPath();
    res.json(enrichWithApiStatus(cachedSwmmStatus));
  });

  app.get('/api/swmm5-api-guide', async (_req, res) => {
    const guidePath = path.join(process.cwd(), 'public', 'swmm5_api_guide.md');
    if (fs.existsSync(guidePath)) {
      res.type('text/markdown').sendFile(guidePath);
    } else {
      res.status(404).json({ error: 'API guide not found' });
    }
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
          let title = f;
          try {
            const content = fs.readFileSync(path.join(samplesDir, f), 'utf-8');
            const titleMatch = content.match(/\[TITLE\]\s*\n(?:;;[^\n]*\n)*(.*)/);
            if (titleMatch) title = titleMatch[1].trim();
          } catch {
            const buf = fs.readFileSync(path.join(samplesDir, f));
            const content = buf.toString('latin1');
            const titleMatch = content.match(/\[TITLE\]\s*\n(?:;;[^\n]*\n)*(.*)/);
            if (titleMatch) title = titleMatch[1].trim();
          }
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

  app.post('/api/upload', (req, res) => {
    upload.array('files')(req, res, async (err: any) => {
      const files = (req.files || []) as Express.Multer.File[];
      const discardUploads = () => {
        for (const f of files) {
          try { fs.unlinkSync(f.path); } catch {}
        }
      };

      try {
        if (err) {
          discardUploads();
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: `Each file must be ${MAX_FILE_SIZE / (1024 * 1024)} MB or smaller` });
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: `A batch may contain at most ${MAX_UPLOAD_FILES} files` });
          }
          return res.status(400).json({ error: err.message || 'Upload failed' });
        }

        if (files.length === 0) {
          return res.status(400).json({ error: 'No files uploaded' });
        }

        const totalSize = files.reduce((acc, f) => acc + f.size, 0);
        if (totalSize > MAX_TOTAL_SIZE) {
          discardUploads();
          return res.status(400).json({ error: `Total upload size must be ${MAX_TOTAL_SIZE / (1024 * 1024)} MB or smaller` });
        }

        const invalid = files.filter(f => !looksLikeSwmmInput(f.path));
        if (invalid.length > 0) {
          discardUploads();
          return res.status(400).json({
            error: `These files do not look like SWMM input files (no [SECTION] headers found): ${invalid.map(f => f.originalname).join(', ')}`,
          });
        }

        const batchJob = await storage.createBatchJob([]);
        const dir = jobDir(batchJob.id);
        fs.mkdirSync(dir, { recursive: true });

        const uploadedFiles = files.map((file, index) => {
          const safeName = `${index}-${path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_')}`;
          const destPath = path.join(dir, safeName);
          fs.renameSync(file.path, destPath);
          return {
            id: `${Date.now()}-${index}`,
            name: file.originalname,
            path: destPath,
          };
        });

        const updated = await storage.updateBatchJob(batchJob.id, { files: uploadedFiles });
        res.json(updated);
      } catch (error) {
        console.error('Upload error:', error);
        discardUploads();
        res.status(500).json({ error: 'Failed to upload files' });
      }
    });
  });

  app.post('/api/batch/:jobId/start', async (req, res) => {
    try {
      const { jobId } = req.params;
      const { engineMode, timeoutMinutes, stopOnError } = req.body || {};
      const job = await storage.getBatchJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Batch job not found' });
      }
      if (job.status === 'processing' || activeJobs.has(jobId)) {
        return res.status(409).json({ error: 'Batch job is already processing' });
      }
      if (job.status !== 'idle') {
        return res.status(409).json({ error: `Batch job already finished (status: ${job.status})` });
      }

      let timeoutMin = Number(timeoutMinutes);
      if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) timeoutMin = DEFAULT_TIMEOUT_MINUTES;
      timeoutMin = Math.min(timeoutMin, MAX_TIMEOUT_MINUTES);

      await storage.updateBatchJob(jobId, { status: 'processing', engineMode: engineMode || 'executable' });

      res.json({
        message: 'Processing started',
        engineMode: engineMode || 'executable',
        timeoutMinutes: timeoutMin,
      });

      setTimeout(() => {
        processFilesSequentially(jobId, job.files, engineMode || 'executable', timeoutMin * 60 * 1000, stopOnError === true);
      }, 500);
    } catch (error) {
      console.error('Start processing error:', error);
      res.status(500).json({ error: 'Failed to start processing' });
    }
  });

  app.post('/api/batch/:jobId/cancel', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getBatchJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Batch job not found' });
      }
      if (job.status !== 'processing') {
        return res.status(409).json({ error: `Cannot cancel a batch that is not processing (status: ${job.status})` });
      }
      await storage.updateBatchJob(jobId, { status: 'cancelled' });

      const entry = activeJobs.get(jobId);
      if (entry) {
        entry.stopSignal = 'cancelled';
        killJobProcess(entry);
      } else {
        cleanupJobFiles(jobId);
      }

      res.json({ message: 'Processing cancelled' });
    } catch (error) {
      console.error('Cancel processing error:', error);
      res.status(500).json({ error: 'Failed to cancel processing' });
    }
  });

  app.delete('/api/batch/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const entry = activeJobs.get(jobId);
      if (entry) {
        return res.status(409).json({ error: 'Batch job is still processing — cancel it first' });
      }
      const deleted = await storage.deleteBatchJob(jobId);
      cleanupJobFiles(jobId);
      if (!deleted) {
        return res.status(404).json({ error: 'Batch job not found' });
      }
      res.json({ message: 'Batch deleted' });
    } catch (error) {
      console.error('Delete batch error:', error);
      res.status(500).json({ error: 'Failed to delete batch' });
    }
  });

  app.get('/api/jobs/latest', async (req, res) => {
    try {
      const job = await storage.getLatestCompletedJob();
      if (!job) {
        return res.status(404).json({ error: 'No completed batch jobs found' });
      }
      res.json(job);
    } catch (error) {
      console.error('Latest job error:', error);
      res.status(500).json({ error: 'Failed to get latest job' });
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

  async function processFilesSequentially(
    jobId: string,
    files: Array<{ id: string; name: string; path: string }>,
    engineMode: string = 'executable',
    timeoutMs: number = DEFAULT_TIMEOUT_MINUTES * 60 * 1000,
    stopOnError: boolean = false,
  ) {
    const job = await storage.getBatchJob(jobId);
    if (!job) return;

    const entry: ActiveJobEntry = { stopSignal: null };
    activeJobs.set(jobId, entry);

    try {
      for (let i = 0; i < files.length; i++) {
        if (entry.stopSignal === 'cancelled') break;
        const currentJob = await storage.getBatchJob(jobId);
        if (!currentJob || currentJob.status === 'cancelled') {
          entry.stopSignal = 'cancelled';
          break;
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

        const timeoutTimer = setTimeout(() => {
          if (entry.stopSignal === null) {
            entry.stopSignal = 'timeout';
            killJobProcess(entry);
            sendProgressUpdate(jobId, {
              type: 'log',
              fileId: file.id,
              fileName: file.name,
              text: `Timeout: ${file.name} exceeded ${Math.round(timeoutMs / 60000)} minute(s) and was stopped`,
              stream: 'stderr',
            });
          }
        }, timeoutMs);

        let result: ProcessResult;
        try {
          if (engineMode === 'api') {
            if (swmm5api.isApiAvailable()) {
              result = await processSingleFileApi(jobId, file, entry);
            } else {
              result = makeEngineUnavailableResult(file, 'api', 'SWMM5 API (shared library) is unavailable — no simulation was performed');
              sendProgressUpdate(jobId, {
                type: 'log',
                fileId: file.id,
                fileName: file.name,
                text: `SWMM5 API unavailable — ${file.name} was not simulated`,
                stream: 'stderr',
              });
            }
          } else {
            result = await processSingleFile(jobId, file, entry);
          }
        } finally {
          clearTimeout(timeoutTimer);
          if (entry.killTimer) {
            clearTimeout(entry.killTimer);
            entry.killTimer = undefined;
          }
          entry.child = undefined;
        }

        const stopSignal = getStopSignal(entry);
        if (stopSignal === 'cancelled' || stopSignal === 'timeout') {
          result = {
            ...result,
            status: stopSignal,
            error: stopSignal === 'timeout'
              ? `Simulation exceeded the ${Math.round(timeoutMs / 60000)}-minute timeout and was stopped`
              : 'Simulation was cancelled by the user',
            reportContent: undefined,
            parsedMetrics: undefined,
          };
          removePartialOutputs(file.path);
        }

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

        if (stopSignal === 'cancelled') break;

        if (stopSignal === 'timeout') {
          entry.stopSignal = null;
          if (stopOnError) {
            sendProgressUpdate(jobId, {
              type: 'log',
              fileId: file.id,
              fileName: file.name,
              text: 'Stop on Error is enabled — remaining files were not processed',
              stream: 'stderr',
            });
            break;
          }
          continue;
        }

        if (stopOnError && result.status !== 'success') {
          sendProgressUpdate(jobId, {
            type: 'log',
            fileId: file.id,
            fileName: file.name,
            text: 'Stop on Error is enabled — remaining files were not processed',
            stream: 'stderr',
          });
          break;
        }
      }

      const finalSignal = getStopSignal(entry);
      if (finalSignal === 'cancelled') {
        await storage.updateBatchJob(jobId, { status: 'cancelled' });
        sendProgressUpdate(jobId, { type: 'cancelled' });
      } else {
        await storage.updateBatchJob(jobId, { status: 'completed' });
        sendProgressUpdate(jobId, { type: 'completed' });
      }
    } catch (e) {
      console.error(`Batch ${jobId} failed unexpectedly:`, e);
      try {
        await storage.updateBatchJob(jobId, { status: 'completed' });
        sendProgressUpdate(jobId, { type: 'completed' });
      } catch {}
    } finally {
      activeJobs.delete(jobId);
      cleanupJobFiles(jobId);
    }
  }

  function makeEngineUnavailableResult(file: { id: string; name: string; path: string }, requestedEngine: string, message: string): ProcessResult {
    let inpContent: string | undefined;
    try {
      inpContent = fs.readFileSync(file.path, 'utf-8');
    } catch {}
    const now = new Date().toISOString();
    return {
      id: file.id,
      fileName: file.name,
      filePath: file.path,
      status: 'failed',
      error: `Engine unavailable — no simulation was performed. ${message}`,
      processingTime: 0,
      inpContent,
      provenance: {
        requestedEngine,
        startedAt: now,
        completedAt: now,
      },
    };
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

  async function processSingleFileApi(jobId: string, file: { id: string; name: string; path: string }, entry?: ActiveJobEntry): Promise<ProcessResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();
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

    sendProgressUpdate(jobId, {
      type: 'log',
      fileId: file.id,
      fileName: file.name,
      text: `[API Mode] Running SWMM5 API step-by-step simulation...`,
      stream: 'stdout',
    });

    try {
      const apiResult = await swmm5api.runWithApi(
        inputPath,
        reportPath,
        outputPath,
        (stepData) => {
          sendProgressUpdate(jobId, {
            type: 'file_progress',
            fileId: file.id,
            fileName: file.name,
            percentage: stepData.percentComplete,
            message: `API Step ${stepData.stepCount} — ${stepData.percentComplete}%`,
          });

          if (stepData.nodeSnapshots || stepData.linkSnapshots) {
            sendProgressUpdate(jobId, {
              type: 'api_snapshot',
              fileId: file.id,
              fileName: file.name,
              elapsedTime: stepData.elapsedTime,
              stepCount: stepData.stepCount,
              nodeSnapshots: stepData.nodeSnapshots,
              linkSnapshots: stepData.linkSnapshots,
            });
          }
        },
        10,
        entry ? () => entry.stopSignal : undefined
      );

      const processingTime = (Date.now() - startTime) / 1000;

      sendProgressUpdate(jobId, {
        type: 'file_progress',
        fileId: file.id,
        fileName: file.name,
        percentage: 100,
        message: apiResult.success ? 'Complete (API Mode)' : 'Failed (API Mode)',
      });

      sendProgressUpdate(jobId, {
        type: 'log',
        fileId: file.id,
        fileName: file.name,
        text: `[API Mode] Version: ${apiResult.version}, Steps: ${apiResult.totalSteps}, Warnings: ${apiResult.warnings}` +
              (apiResult.massBalErr ? `, Mass Balance Err - Runoff: ${apiResult.massBalErr.runoff.toFixed(3)}%, Flow: ${apiResult.massBalErr.flow.toFixed(3)}%, Quality: ${apiResult.massBalErr.quality.toFixed(3)}%` : ''),
        stream: 'stdout',
      });

      const provenance = {
        requestedEngine: 'api',
        actualEngine: 'api',
        engineVersion: apiResult.version != null ? String(apiResult.version) : undefined,
        startedAt,
        completedAt: new Date().toISOString(),
      };

      if (!apiResult.success) {
        return {
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'failed',
          error: apiResult.error || 'API simulation failed',
          processingTime,
          inpContent,
          provenance,
        };
      }

      let rawReport: string | undefined;
      try {
        if (fs.existsSync(reportPath)) {
          rawReport = fs.readFileSync(reportPath, 'utf-8');
        }
      } catch (e) {
        console.warn(`Could not read report file: ${reportPath}`);
      }

      const validation = validateSwmmReport(rawReport);
      if (!validation.valid) {
        return {
          id: file.id,
          fileName: file.name,
          filePath: file.path,
          status: 'failed',
          error: validation.reason || 'SWMM API run produced an invalid report',
          processingTime,
          reportContent: rawReport,
          inpContent,
          parsedMetrics: rawReport ? parseReportMetrics(rawReport) : undefined,
          provenance,
        };
      }

      let reportContent = rawReport!;
      try {
        const timeSeriesData = parseSwmmOutputBinary(outputPath);
        if (timeSeriesData) {
          reportContent = reportContent + '\n' + timeSeriesData;
        }
      } catch (e) {
        console.warn(`Could not parse SWMM output binary: ${outputPath}`);
      }

      const parsedMetrics = parseReportMetrics(reportContent);

      return {
        id: file.id,
        fileName: file.name,
        filePath: file.path,
        status: 'success',
        processingTime,
        reportContent,
        inpContent,
        results: { peakFlow: undefined, totalVolume: undefined },
        parsedMetrics,
        provenance,
      };
    } catch (e: any) {
      const processingTime = (Date.now() - startTime) / 1000;
      return {
        id: file.id,
        fileName: file.name,
        filePath: file.path,
        status: 'failed',
        error: `API mode error: ${e.message}`,
        processingTime,
        inpContent,
        provenance: {
          requestedEngine: 'api',
          actualEngine: 'api',
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    }
  }

  async function processSingleFile(jobId: string, file: { id: string; name: string; path: string }, entry?: ActiveJobEntry): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let swmmStatus = cachedSwmmStatus || detectSwmmPath();
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

      if (swmmStatus.found && !fs.existsSync(runswmmPath)) {
        console.warn(`SWMM binary no longer exists at ${runswmmPath}`);
        swmmStatus = { found: false, mode: 'unavailable', searchedPaths: swmmStatus.searchedPaths || [] };
        cachedSwmmStatus = swmmStatus;
      }

      if (!swmmStatus.found) {
        console.warn(`SWMM executable not found — refusing to simulate ${file.name}`);
        sendProgressUpdate(jobId, {
          type: 'file_progress',
          fileId: file.id,
          fileName: file.name,
          percentage: 100,
          message: 'Engine unavailable',
        });
        sendProgressUpdate(jobId, {
          type: 'log',
          fileId: file.id,
          fileName: file.name,
          text: `SWMM executable not found — ${file.name} was not simulated`,
          stream: 'stderr',
        });
        resolve(makeEngineUnavailableResult(file, 'executable', 'The SWMM executable was not found on this server.'));
        return;
      }

      const startedAt = new Date().toISOString();

      console.log(`Running SWMM: ${runswmmPath} "${inputPath}" "${reportPath}" "${outputPath}"`);
      const childProcess = spawn(runswmmPath, [inputPath, reportPath, outputPath]);
      if (entry) {
        entry.child = childProcess;
        if (entry.stopSignal) {
          killJobProcess(entry);
        }
      }

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

        const provenance = {
          requestedEngine: 'executable',
          actualEngine: 'executable',
          startedAt,
          completedAt: new Date().toISOString(),
          exitCode: code,
        };

        if (code === 0) {
          let rawReport: string | undefined;
          try {
            if (fs.existsSync(reportPath)) {
              rawReport = fs.readFileSync(reportPath, 'utf-8');
            }
          } catch (e) {
            console.warn(`Could not read report file: ${reportPath}`);
          }

          const validation = validateSwmmReport(rawReport);
          if (!validation.valid) {
            resolve({
              id: file.id,
              fileName: file.name,
              filePath: file.path,
              status: 'failed',
              error: validation.reason || 'SWMM produced an invalid report',
              processingTime,
              reportContent: rawReport,
              inpContent,
              parsedMetrics: rawReport ? parseReportMetrics(rawReport) : undefined,
              provenance,
            });
            return;
          }

          let reportContent = rawReport!;
          try {
            const timeSeriesData = parseSwmmOutputBinary(outputPath);
            if (timeSeriesData) {
              reportContent = reportContent + '\n' + timeSeriesData;
            }
          } catch (e) {
            console.warn(`Could not parse SWMM output binary: ${outputPath}`);
          }

          const parsedMetrics = parseReportMetrics(reportContent);

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
            provenance: {
              ...provenance,
              engineVersion: extractEngineVersion(rawReport!),
            },
          });
        } else {
          let rawReport: string | undefined;
          try {
            if (fs.existsSync(reportPath)) {
              rawReport = fs.readFileSync(reportPath, 'utf-8');
            }
          } catch {}
          const issues = rawReport ? extractReportIssues(rawReport) : { warnings: [], errors: [] };
          resolve({
            id: file.id,
            fileName: file.name,
            filePath: file.path,
            status: 'failed',
            error: issues.errors.length > 0
              ? issues.errors.join('\n')
              : (errorOutput || `Process exited with code ${code}`),
            processingTime,
            reportContent: rawReport,
            inpContent,
            parsedMetrics: rawReport ? parseReportMetrics(rawReport) : undefined,
            provenance,
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
          provenance: {
            requestedEngine: 'executable',
            actualEngine: 'executable',
            startedAt,
            completedAt: new Date().toISOString(),
            exitCode: null,
          },
        });
      });
    });
  }

  const aiClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  app.post('/api/chat-report', express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const { messages, reportContent, inpContent } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array is required' });
      }

      const systemPrompt = `You are an expert EPA SWMM (Storm Water Management Model) report assistant. The user has an EPA SWMM simulation result and wants you to help them create a custom HTML report.

When the user asks you to generate or modify an HTML report, produce a complete, self-contained HTML document with inline CSS styling. The HTML should be professional, well-formatted, and ready to save as a standalone file.

Key guidelines for HTML reports:
- Use clean, modern CSS with a professional color scheme
- Include proper tables with alternating row colors for readability
- Add charts/visualizations using inline SVG when appropriate
- Make the report print-friendly
- Include a title, date, and summary section
- Parse and present the SWMM data in a clear, organized manner
- Wrap the entire HTML in a code block with \`\`\`html and \`\`\` markers so it can be extracted

When the user asks questions about the data, answer based on the report content provided.

${reportContent ? `\n--- SWMM REPORT (.rpt) CONTENT${reportContent.length > 30000 ? ` (TRUNCATED: showing first 30,000 of ${reportContent.length.toLocaleString()} characters; the remainder was omitted — tell the user if they ask about data that may be in the omitted portion)` : ''} ---\n${reportContent.substring(0, 30000)}\n--- END REPORT${reportContent.length > 30000 ? ' (TRUNCATED)' : ''} ---` : ''}
${inpContent ? `\n--- SWMM INPUT (.inp) CONTENT${inpContent.length > 15000 ? ` (TRUNCATED: showing first 15,000 of ${inpContent.length.toLocaleString()} characters; the remainder was omitted — tell the user if they ask about data that may be in the omitted portion)` : ''} ---\n${inpContent.substring(0, 15000)}\n--- END INPUT${inpContent.length > 15000 ? ' (TRUNCATED)' : ''} ---` : ''}`;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      const stream = await aiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: chatMessages,
        stream: true,
        max_tokens: 16384,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error('Chat report error:', error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: error.message || 'AI request failed' })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: error.message || 'AI request failed' });
      }
    }
  });

  return httpServer;
}
