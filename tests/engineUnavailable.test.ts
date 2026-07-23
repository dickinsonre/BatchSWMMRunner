import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type express from "express";
import type { Server } from "http";

// Force the SWMM5 API engine to be unavailable so the batch must fail
// explicitly instead of fabricating success.
vi.mock("../server/swmm5api", () => ({
  isApiAvailable: () => false,
  getVersion: () => { throw new Error("unavailable"); },
  runWithApi: async () => { throw new Error("unavailable"); },
}));

import { makeApp, uploadFixtures, waitForJob, isFinished } from "./helpers";

let app: express.Express;
let server: Server;

beforeAll(async () => {
  ({ app, server } = await makeApp());
});

afterAll(() => {
  server.close();
});

describe("unavailable engine", () => {
  it("marks files failed with an explicit engine-unavailable error, never fabricated success", async () => {
    const job = await uploadFixtures(app, ["valid-model.inp"]);
    const start = await request(app).post(`/api/batch/${job.id}/start`).send({ engineMode: "api" });
    expect(start.status).toBe(200);

    const done = await waitForJob(app, job.id, j => isFinished(j) && j.results.length === 1);
    expect(done.status).toBe("completed");
    const r = done.results[0];
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Engine unavailable — no simulation was performed/);
    expect(r.reportContent).toBeUndefined();
    expect(r.parsedMetrics).toBeUndefined();
    expect(r.provenance?.requestedEngine).toBe("api");
    expect(r.provenance?.actualEngine).toBeUndefined();
  }, 60000);
});
