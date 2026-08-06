import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import path from "path";
import request from "supertest";
import WebSocket from "ws";
import { registerRoutes } from "../server/routes";
import { buildSessionMiddleware } from "../server/session";
import { FIXTURES, ensureUploadTmpDir } from "./helpers";
import type { BatchJob } from "@shared/schema";

let app: express.Express;
let server: Server;
let baseUrl: string;
let wsUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const sessionMiddleware = buildSessionMiddleware({ memoryStore: true });
  app.use(sessionMiddleware);
  server = await registerRoutes(app, sessionMiddleware);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

async function uploadAs(agent: ReturnType<typeof request.agent>): Promise<{ job: BatchJob; cookie: string }> {
  ensureUploadTmpDir();
  const res = await agent.post("/api/upload").attach("files", path.join(FIXTURES, "valid-model.inp"));
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(c => String(c).split(";")[0]).join("; ");
  return { job: res.body as BatchJob, cookie };
}

/** Connect to the job's WS stream; resolves with how the server treated us. */
function tryWsConnect(jobId: string, cookie?: string): Promise<{ opened: boolean; closeCode?: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/api/ws?jobId=${jobId}`, cookie ? { headers: { Cookie: cookie } } : {});
    let opened = false;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS test timed out")); }, 8000);
    ws.on("open", () => {
      opened = true;
      // give the server a moment to close unauthorized connections
      setTimeout(() => { clearTimeout(timer); ws.close(); resolve({ opened, closeCode: undefined }); }, 500);
    });
    ws.on("close", (code) => { clearTimeout(timer); resolve({ opened, closeCode: code }); });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

describe("anonymous session job ownership", () => {
  it("hides another visitor's job from read, cancel, and delete", async () => {
    const alice = request.agent(app);
    const mallory = request.agent(app);

    const { job } = await uploadAs(alice);

    // Owner can read it
    const own = await alice.get(`/api/batch/${job.id}`);
    expect(own.status).toBe(200);

    // Others get 404 everywhere
    expect((await mallory.get(`/api/batch/${job.id}`)).status).toBe(404);
    expect((await mallory.post(`/api/batch/${job.id}/start`).send({})).status).toBe(404);
    expect((await mallory.post(`/api/batch/${job.id}/cancel`)).status).toBe(404);
    expect((await mallory.delete(`/api/batch/${job.id}`)).status).toBe(404);

    // Owner can still delete
    expect((await alice.delete(`/api/batch/${job.id}`)).status).toBe(200);
  }, 30000);

  it("scopes /api/jobs/latest to the caller's session", async () => {
    const stranger = request.agent(app);
    const res = await stranger.get("/api/jobs/latest");
    expect(res.status).toBe(404);
  });

  it("returns no server filesystem paths in job responses", async () => {
    const alice = request.agent(app);
    const { job } = await uploadAs(alice);
    const res = await alice.get(`/api/batch/${job.id}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("uploads/");
    expect(body).not.toContain(process.cwd());
    expect(res.body.ownerId).toBeUndefined();
    await alice.delete(`/api/batch/${job.id}`);
  }, 30000);

  it("returns no filesystem paths from /api/swmm-status", async () => {
    const res = await request(app).get("/api/swmm-status");
    expect(res.status).toBe(200);
    expect(res.body.path).toBeUndefined();
    expect(res.body.searchedPaths).toBeUndefined();
    expect(typeof res.body.found).toBe("boolean");
  });

  it("allows the owner's WebSocket stream but rejects others", async () => {
    const alice = request.agent(app);
    const { job, cookie } = await uploadAs(alice);

    // Owner connects fine
    const owner = await tryWsConnect(job.id, cookie);
    expect(owner.opened).toBe(true);
    expect(owner.closeCode === undefined || owner.closeCode === 1000 || owner.closeCode === 1005).toBe(true);

    // Unauthenticated visitor is rejected with the auth close code
    const anon = await tryWsConnect(job.id);
    expect(anon.closeCode).toBe(4403);

    // A different session is rejected too
    const mallory = request.agent(app);
    const { cookie: malloryCookie } = await uploadAs(mallory);
    const other = await tryWsConnect(job.id, malloryCookie);
    expect(other.closeCode).toBe(4403);

    await alice.delete(`/api/batch/${job.id}`);
  }, 30000);

  it("admits only one of many parallel start requests for the same job", async () => {
    const alice = request.agent(app);
    const { job } = await uploadAs(alice);
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => alice.post(`/api/batch/${job.id}/start`).send({ engineMode: "executable" })),
    );
    const ok = attempts.filter(r => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of attempts) {
      if (r.status !== 200) expect([409, 429]).toContain(r.status);
    }
    // let it finish so it doesn't hold a slot for later tests
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const s = await alice.get(`/api/batch/${job.id}`);
      if (s.status === 200 && ["completed", "cancelled", "failed"].includes(s.body.status)) break;
      await new Promise(r => setTimeout(r, 300));
    }
    await alice.delete(`/api/batch/${job.id}`);
  }, 90000);

  it("caps concurrent batches and releases slots for rejected requests", async () => {
    const alice = request.agent(app);
    // Upload sequentially: parallel first-time uploads would each create a
    // separate session before the agent has stored its cookie.
    const jobs: Awaited<ReturnType<typeof uploadAs>>[] = [];
    for (let i = 0; i < 5; i++) jobs.push(await uploadAs(alice));
    const starts = await Promise.all(
      jobs.map(({ job }) => alice.post(`/api/batch/${job.id}/start`).send({ engineMode: "executable" })),
    );
    const ok = starts.filter(r => r.status === 200).length;
    const busy = starts.filter(r => r.status === 429).length;
    expect(ok).toBeLessThanOrEqual(4);
    expect(ok + busy).toBe(5);
    // wait for started jobs to finish, then clean up
    const deadline = Date.now() + 90000;
    for (const { job } of jobs) {
      while (Date.now() < deadline) {
        const s = await alice.get(`/api/batch/${job.id}`);
        if (s.status === 200 && s.body.status !== "processing") break;
        await new Promise(r => setTimeout(r, 300));
      }
      await alice.delete(`/api/batch/${job.id}`);
    }
  }, 120000);

  it("denies access to legacy jobs with no owner when sessions are enabled", async () => {
    // Simulate a pre-migration job by creating one with a null owner directly.
    const { storage } = await import("../server/storage");
    const legacy = await storage.createBatchJob([], undefined, null);
    try {
      const visitor = request.agent(app);
      expect((await visitor.get(`/api/batch/${legacy.id}`)).status).toBe(404);
      const ws = await tryWsConnect(legacy.id);
      expect(ws.closeCode).toBe(4403);
    } finally {
      await (await import("../server/storage")).storage.deleteBatchJob(legacy.id);
    }
  }, 30000);
});
