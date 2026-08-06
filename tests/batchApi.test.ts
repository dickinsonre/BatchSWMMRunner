import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import type express from "express";
import type { Server } from "http";
import { makeApp, uploadFixtures, waitForJob, isFinished, ensureUploadTmpDir } from "./helpers";

let app: express.Express;
let server: Server;

beforeAll(async () => {
  ({ app, server } = await makeApp());
});

afterAll(() => {
  server.close();
});

async function startBatch(jobId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/batch/${jobId}/start`).send({ engineMode: "executable", ...body });
}

describe("upload validation", () => {
  it("rejects non-.inp files", async () => {
    ensureUploadTmpDir();
    const tmp = path.join(os.tmpdir(), "not-swmm.txt");
    fs.writeFileSync(tmp, "[TITLE]\nhello");
    const res = await request(app).post("/api/upload").attach("files", tmp);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.inp files/i);
  });

  it("rejects .inp files that do not look like SWMM input", async () => {
    ensureUploadTmpDir();
    const tmp = path.join(os.tmpdir(), "fake.inp");
    fs.writeFileSync(tmp, "this is just plain text with no section headers");
    const res = await request(app).post("/api/upload").attach("files", tmp);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/do not look like SWMM input/i);
  });

  it("rejects batches with more than 100 files", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "many-inp-"));
    let req = request(app).post("/api/upload");
    for (let i = 0; i < 101; i++) {
      const p = path.join(tmpDir, `f${i}.inp`);
      fs.writeFileSync(p, "[TITLE]\ntiny\n[JUNCTIONS]\nJ1 1 1\n");
      req = req.attach("files", p);
    }
    // The server responds 400 as soon as multer hits the file-count limit and
    // aborts the stream, which can surface client-side as an EPIPE write error.
    // Both outcomes prove the batch was rejected.
    try {
      const res = await req;
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at most 100 files/i);
    } catch (e: any) {
      expect(String(e?.code || e?.message)).toMatch(/EPIPE|ECONNRESET/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects empty uploads", async () => {
    const res = await request(app).post("/api/upload");
    expect(res.status).toBe(400);
  });
});

describe("batch processing (executable engine)", () => {
  it("processes a valid model successfully with real parsed metrics", async () => {
    const job = await uploadFixtures(app, ["valid-model.inp"]);
    const start = await startBatch(job.id);
    expect(start.status).toBe(200);

    const done = await waitForJob(app, job.id, isFinished);
    expect(done.status).toBe("completed");
    expect(done.results).toHaveLength(1);
    const r = done.results[0];
    expect(r.status).toBe("success");
    // Job reads return light summaries; full text loads on demand.
    expect(r.reportContent).toBeUndefined();
    expect(r.hasReport).toBe(true);
    const contentRes = await request(app).get(`/api/batch/${job.id}/results/${r.id}/content`);
    expect(contentRes.status).toBe(200);
    const reportContent = contentRes.body.reportContent as string;
    expect(reportContent).toMatch(/EPA STORM WATER MANAGEMENT MODEL/);
    // Time series parsed from the binary .out must be appended so RPT Graphs work
    expect(reportContent).toMatch(/Results Time Series/);
    expect(reportContent).toContain("<<<");
    expect(r.provenance?.requestedEngine).toBe("executable");
    expect(r.provenance?.actualEngine).toBe("executable");
    expect(r.provenance?.exitCode).toBe(0);
    const m = r.parsedMetrics!;
    expect(m.runoffContinuityError).toBeTypeOf("number");
    expect(Math.abs(m.runoffContinuityError!)).toBeLessThan(5);
    expect(m.routingContinuityError).toBeTypeOf("number");
    expect(m.totalPrecipitation).toBeGreaterThan(0);
    expect(m.surfaceRunoff).toBeGreaterThan(0);
    expect(m.flowRoutingMethod).toMatch(/KINWAVE/i);
  }, 120000);

  it("fails a model with an invalid network and surfaces the SWMM error", async () => {
    const job = await uploadFixtures(app, ["invalid-section.inp"]);
    await startBatch(job.id);
    const done = await waitForJob(app, job.id, isFinished);
    expect(done.status).toBe("completed");
    const r = done.results[0];
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/ERROR/i);
  }, 120000);

  it("reports routing-only models without a fabricated runoff continuity error", async () => {
    const job = await uploadFixtures(app, ["routing-only.inp"]);
    await startBatch(job.id);
    const done = await waitForJob(app, job.id, isFinished);
    const r = done.results[0];
    expect(r.status).toBe("success");
    expect(r.parsedMetrics?.runoffContinuityError).toBeUndefined();
    expect(r.parsedMetrics?.routingContinuityError).toBeTypeOf("number");
  }, 120000);

  it("cancels a running batch and marks the file cancelled", async () => {
    const job = await uploadFixtures(app, ["long-model.inp"]);
    await startBatch(job.id);
    // Wait until the job is actually processing, then give the child a moment to spawn.
    await waitForJob(app, job.id, j => j.status === "processing", 15000, 100);
    await new Promise(r => setTimeout(r, 750));
    const cancel = await request(app).post(`/api/batch/${job.id}/cancel`);
    expect(cancel.status).toBe(200);

    const done = await waitForJob(app, job.id, j => j.status === "cancelled" && j.results.length > 0, 30000);
    expect(done.status).toBe("cancelled");
    const r = done.results[0];
    expect(r.status).toBe("cancelled");
    expect(r.reportContent).toBeUndefined();
    expect(r.parsedMetrics).toBeUndefined();
  }, 120000);

  it("times out a slow file but still processes subsequent files", async () => {
    const job = await uploadFixtures(app, ["long-model.inp", "valid-model.inp"]);
    // 0.02 minutes = 1.2 seconds
    await startBatch(job.id, { timeoutMinutes: 0.02 });
    const done = await waitForJob(app, job.id, j => isFinished(j) && j.results.length === 2, 120000);
    expect(done.status).toBe("completed");
    const [slow, fast] = done.results;
    expect(slow.status).toBe("timeout");
    expect(slow.error).toMatch(/timeout/i);
    expect(fast.status).toBe("success");
  }, 150000);

  it("rejects starting an already-finished job", async () => {
    const job = await uploadFixtures(app, ["valid-model.inp"]);
    await startBatch(job.id);
    await waitForJob(app, job.id, isFinished);
    const again = await startBatch(job.id);
    expect(again.status).toBe(409);
  }, 120000);

  it("returns 404 for unknown jobs", async () => {
    const res = await request(app).get("/api/batch/nope");
    expect(res.status).toBe(404);
    const start = await request(app).post("/api/batch/nope/start").send({});
    expect(start.status).toBe(404);
  });
});
