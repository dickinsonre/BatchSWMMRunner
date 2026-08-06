import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import path from "path";
import request from "supertest";
import { registerRoutes } from "../server/routes";
import { buildSessionMiddleware } from "../server/session";
import { storage } from "../server/storage";
import { db } from "../server/db";
import { batchJobsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { FIXTURES, ensureUploadTmpDir } from "./helpers";
import type { BatchJob, ProcessResult } from "@shared/schema";

let app: express.Express;
let server: Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const sessionMiddleware = buildSessionMiddleware({ memoryStore: true });
  app.use(sessionMiddleware);
  server = await registerRoutes(app, sessionMiddleware);
});

afterAll(() => {
  server.close();
});

function makeResult(id: string, fileName: string, withContent = true): ProcessResult {
  return {
    id,
    fileName,
    filePath: fileName,
    status: "success",
    processingTime: 1,
    ...(withContent ? { reportContent: `report for ${fileName}`, inpContent: `inp for ${fileName}` } : {}),
  };
}

describe("normalized result storage", () => {
  it("stores results per file, keeps job reads light, and orders by sequence", async () => {
    const job = await storage.createBatchJob([], undefined, null);
    try {
      await storage.appendBatchResult(job.id, 1, makeResult("r-b", "b.inp"));
      await storage.appendBatchResult(job.id, 0, makeResult("r-a", "a.inp"));

      const read = (await storage.getBatchJob(job.id))!;
      expect(read.results.map(r => r.id)).toEqual(["r-a", "r-b"]);
      for (const r of read.results) {
        expect(r.reportContent).toBeUndefined();
        expect(r.inpContent).toBeUndefined();
        expect(r.hasReport).toBe(true);
        expect(r.hasInp).toBe(true);
      }

      const artifacts = (await storage.getBatchResultArtifacts(job.id, "r-a"))!;
      expect(artifacts.reportContent).toBe("report for a.inp");
      expect(artifacts.inpContent).toBe("inp for a.inp");
    } finally {
      await storage.deleteBatchJob(job.id);
    }
  });

  it("merges legacy JSONB results with new rows, deduped and legacy-first", async () => {
    const job = await storage.createBatchJob([], undefined, null);
    try {
      // Simulate a pre-migration job: results living in the JSONB blob.
      const legacy = [makeResult("legacy-1", "old1.inp"), makeResult("legacy-2", "old2.inp")];
      await db.update(batchJobsTable).set({ results: legacy }).where(eq(batchJobsTable.id, job.id));

      // Job resumes after deployment and appends new rows (one overwriting a legacy id).
      await storage.appendBatchResult(job.id, 0, makeResult("legacy-2", "old2.inp"));
      await storage.appendBatchResult(job.id, 1, makeResult("new-1", "new1.inp"));

      const read = (await storage.getBatchJob(job.id))!;
      expect(read.results.map(r => r.id)).toEqual(["legacy-1", "legacy-2", "new-1"]);
      // Legacy summaries are light too, but their artifacts remain retrievable.
      expect(read.results[0].reportContent).toBeUndefined();
      expect(read.results[0].hasReport).toBe(true);
      const legacyArtifacts = (await storage.getBatchResultArtifacts(job.id, "legacy-1"))!;
      expect(legacyArtifacts.reportContent).toBe("report for old1.inp");
    } finally {
      await storage.deleteBatchJob(job.id);
    }
  });

  it("removes result rows when the job is deleted", async () => {
    const job = await storage.createBatchJob([], undefined, null);
    await storage.appendBatchResult(job.id, 0, makeResult("r-1", "a.inp"));
    await storage.deleteBatchJob(job.id);
    expect(await storage.getBatchResultSummaries(job.id)).toHaveLength(0);
    expect(await storage.getBatchResultArtifacts(job.id, "r-1")).toBeUndefined();
  });

  it("denies the content endpoint to other sessions", async () => {
    ensureUploadTmpDir();
    const alice = request.agent(app);
    const upload = await alice.post("/api/upload").attach("files", path.join(FIXTURES, "valid-model.inp"));
    expect(upload.status).toBe(200);
    const job = upload.body as BatchJob;
    try {
      await storage.appendBatchResult(job.id, 0, makeResult("r-owned", "valid-model.inp"));

      const own = await alice.get(`/api/batch/${job.id}/results/r-owned/content`);
      expect(own.status).toBe(200);
      expect(own.body.reportContent).toContain("report for");

      const mallory = request.agent(app);
      expect((await mallory.get(`/api/batch/${job.id}/results/r-owned/content`)).status).toBe(404);
    } finally {
      await alice.delete(`/api/batch/${job.id}`);
    }
  });
});
