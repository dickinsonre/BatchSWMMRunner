import fs from "fs";
import express from "express";
import type { Server } from "http";
import path from "path";
import request from "supertest";
import { registerRoutes } from "../server/routes";
import type { BatchJob } from "@shared/schema";

export const FIXTURES = path.join(__dirname, "fixtures");

export async function makeApp(): Promise<{ app: express.Express; server: Server }> {
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
  return { app, server };
}

// The dev server's startup sweep can remove uploads/tmp while tests run in
// parallel with it; make sure multer's destination exists before uploading.
export function ensureUploadTmpDir(): void {
  fs.mkdirSync(path.join(process.cwd(), "uploads", "tmp"), { recursive: true });
}

export async function uploadFixtures(app: express.Express, fileNames: string[]): Promise<BatchJob> {
  ensureUploadTmpDir();
  let req = request(app).post("/api/upload");
  for (const name of fileNames) {
    req = req.attach("files", path.join(FIXTURES, name));
  }
  const res = await req;
  if (res.status !== 200) {
    throw new Error(`Upload failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as BatchJob;
}

export async function waitForJob(
  app: express.Express,
  jobId: string,
  predicate: (job: BatchJob) => boolean,
  timeoutMs = 60000,
  pollMs = 250,
): Promise<BatchJob> {
  const deadline = Date.now() + timeoutMs;
  let last: BatchJob | undefined;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/batch/${jobId}`);
    if (res.status === 200) {
      last = res.body as BatchJob;
      if (predicate(last)) return last;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for job ${jobId}; last state: ${JSON.stringify(last?.status)}, results: ${last?.results?.length}`);
}

export function isFinished(job: BatchJob): boolean {
  return job.status === "completed" || job.status === "cancelled";
}
