import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import type express from "express";
import type { Server } from "http";
import { makeApp, uploadFixtures, waitForJob, isFinished } from "./helpers";

// A fake SWMM executable that exits 0 but writes an empty report file.
// The server must treat this as a failure — a zero exit code alone must
// never be reported as a successful simulation.
let app: express.Express;
let server: Server;
let fakeDir: string;
const originalEnv = process.env.RUNSWMM_PATH;

beforeAll(async () => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-swmm-"));
  const fakeExe = path.join(fakeDir, "runswmm");
  fs.writeFileSync(fakeExe, '#!/bin/sh\n: > "$2"\nexit 0\n');
  fs.chmodSync(fakeExe, 0o755);
  process.env.RUNSWMM_PATH = fakeExe;
  ({ app, server } = await makeApp());
});

afterAll(() => {
  server.close();
  if (originalEnv === undefined) delete process.env.RUNSWMM_PATH;
  else process.env.RUNSWMM_PATH = originalEnv;
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

describe("empty report from engine", () => {
  it("marks the file failed when the engine exits 0 but produces an empty report", async () => {
    const job = await uploadFixtures(app, ["valid-model.inp"]);
    const start = await request(app).post(`/api/batch/${job.id}/start`).send({ engineMode: "executable" });
    expect(start.status).toBe(200);

    const done = await waitForJob(app, job.id, j => isFinished(j) && j.results.length === 1);
    expect(done.status).toBe("completed");
    const r = done.results[0];
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/report|empty|missing/i);
    expect(r.parsedMetrics).toBeUndefined();
  }, 60000);
});
