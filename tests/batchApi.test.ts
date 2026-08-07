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

  it("rejects batches with more than 500 files", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "many-inp-"));
    let req = request(app).post("/api/upload");
    for (let i = 0; i < 501; i++) {
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
      expect(res.body.error).toMatch(/at most 500 files/i);
    } catch (e: any) {
      expect(String(e?.code || e?.message)).toMatch(/EPIPE|ECONNRESET/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("appends chunked-upload files to an idle batch and rejects appends after start", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-inp-"));
    const mk = (name: string) => {
      const p = path.join(tmpDir, name);
      fs.writeFileSync(p, "[TITLE]\ntiny\n[JUNCTIONS]\nJ1 1 1\n");
      return p;
    };
    try {
      // First chunk creates the job.
      const first = await request(app).post("/api/upload").attach("files", mk("a.inp"));
      expect(first.status).toBe(200);
      const jobId = first.body.id;

      // Second chunk appends.
      const append = await request(app)
        .post(`/api/batch/${jobId}/files`)
        .attach("files", mk("b.inp"))
        .attach("files", mk("c.inp"));
      expect(append.status).toBe(200);
      expect(append.body.files).toHaveLength(3);

      // Appending to a job that doesn't exist fails cleanly.
      const missing = await request(app).post(`/api/batch/no-such-job/files`).attach("files", mk("d.inp"));
      expect(missing.status).toBe(404);

      // Once the batch is started, appends are rejected.
      const started = await startBatch(jobId);
      expect(started.status).toBe(200);
      const late = await request(app)
        .post(`/api/batch/${jobId}/files`)
        .attach("files", mk("e.inp"));
      expect(late.status).toBe(409);
      await waitForJob(app, jobId).catch(() => {});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects empty uploads", async () => {
    const res = await request(app).post("/api/upload");
    expect(res.status).toBe(400);
  });
});

describe("concurrent chunked-upload appends", () => {
  const TINY = "[TITLE]\ntiny\n[JUNCTIONS]\nJ1 1 1\n";

  function mkFiles(dir: string, names: string[]): string[] {
    return names.map(n => {
      const p = path.join(dir, n);
      fs.writeFileSync(p, TINY);
      return p;
    });
  }

  it("two overlapping appends both land: no file lost or duplicated", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "race-append-"));
    try {
      const first = await request(app).post("/api/upload").attach("files", mkFiles(tmpDir, ["seed.inp"])[0]);
      expect(first.status).toBe(200);
      const jobId = first.body.id;

      const [a1, a2] = mkFiles(tmpDir, ["a1.inp", "a2.inp"]);
      const [b1, b2] = mkFiles(tmpDir, ["b1.inp", "b2.inp"]);

      // Fire both appends without awaiting either, so they overlap in flight.
      const reqA = request(app).post(`/api/batch/${jobId}/files`).attach("files", a1).attach("files", a2);
      const reqB = request(app).post(`/api/batch/${jobId}/files`).attach("files", b1).attach("files", b2);
      const [resA, resB] = await Promise.all([reqA, reqB]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const job = await request(app).get(`/api/batch/${jobId}`);
      expect(job.status).toBe(200);
      const names = (job.body.files as Array<{ name: string }>).map(f => f.name).sort();
      expect(names).toEqual(["a1.inp", "a2.inp", "b1.inp", "b2.inp", "seed.inp"]);
      // Every file exactly once — no duplicates.
      expect(new Set(names).size).toBe(names.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it("overlapping appends cannot jointly exceed the 500-file cap", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "race-cap-"));
    try {
      const first = await request(app).post("/api/upload").attach("files", mkFiles(tmpDir, ["seed.inp"])[0]);
      expect(first.status).toBe(200);
      const jobId = first.body.id;

      // 1 existing + 250 + 250 = 501 > 500, so exactly one append must be rejected.
      const buildAppend = (prefix: string) => {
        let r = request(app).post(`/api/batch/${jobId}/files`);
        for (const p of mkFiles(tmpDir, Array.from({ length: 250 }, (_, i) => `${prefix}${i}.inp`))) {
          r = r.attach("files", p);
        }
        return r;
      };
      const [resA, resB] = await Promise.all([buildAppend("a"), buildAppend("b")]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 400]);
      const rejected = resA.status === 400 ? resA : resB;
      expect(rejected.body.error).toMatch(/at most 500 files/i);

      const job = await request(app).get(`/api/batch/${jobId}`);
      const names = (job.body.files as Array<{ name: string }>).map(f => f.name);
      expect(names).toHaveLength(251);
      expect(new Set(names).size).toBe(251);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  it("an append racing a start never loses files or lets them slip in after start", async () => {
    ensureUploadTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "race-start-"));
    try {
      const first = await request(app).post("/api/upload").attach("files", mkFiles(tmpDir, ["seed.inp"])[0]);
      expect(first.status).toBe(200);
      const jobId = first.body.id;

      const [late] = mkFiles(tmpDir, ["late.inp"]);
      const appendReq = request(app).post(`/api/batch/${jobId}/files`).attach("files", late);
      const startReq = startBatch(jobId);
      const [appendRes, startRes] = await Promise.all([appendReq, startReq]);

      expect(startRes.status).toBe(200);
      // The append either won the race (200, file included) or was rejected
      // once the start reserved the job (409) — never a partial outcome.
      expect([200, 409]).toContain(appendRes.status);

      const job = await request(app).get(`/api/batch/${jobId}`);
      const names = (job.body.files as Array<{ name: string }>).map(f => f.name);
      if (appendRes.status === 200) {
        expect(names.sort()).toEqual(["late.inp", "seed.inp"]);
      } else {
        expect(names).toEqual(["seed.inp"]);
      }
      expect(new Set(names).size).toBe(names.length);

      // Any append after the start is reserved must be rejected.
      const [after] = mkFiles(tmpDir, ["after.inp"]);
      const lateAppend = await request(app).post(`/api/batch/${jobId}/files`).attach("files", after);
      expect(lateAppend.status).toBe(409);

      const done = await waitForJob(app, jobId, isFinished).catch(() => null);
      // The processed results must match exactly the final file list.
      if (done) {
        expect(done.results.length).toBe(names.length);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120000);
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
