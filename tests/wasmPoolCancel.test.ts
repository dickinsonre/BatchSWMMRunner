import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runWasmBatch } from '../client/src/lib/swmmWasmEngine';

// --- Mock Worker infrastructure -------------------------------------------

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  terminated = false;
  posted: any[] = [];

  constructor(public url: string) {
    MockWorker.instances.push(this);
  }

  postMessage(msg: any) {
    if (this.terminated) throw new Error('postMessage after terminate');
    this.posted.push(msg);
  }

  terminate() {
    this.terminated = true;
  }

  // Simulate the worker finishing its most recent job successfully.
  emitDone() {
    const job = this.posted[this.posted.length - 1];
    if (!job || this.terminated) return;
    this.onmessage?.({
      data: {
        type: 'done',
        id: job.id,
        fileName: job.fileName,
        ok: true,
        errMsg: '',
        warnings: 0,
        rptText: 'EPA STORM WATER MANAGEMENT MODEL - VERSION 5.2 (Build 5.2.4)\n',
        elapsedMs: 10,
      },
    });
  }
}

function makeFile(name: string, content = '[TITLE]\ntest\n'): { id: string; name: string; file: File } {
  return { id: name, name, file: new File([content], name) };
}

function makeCallbacks() {
  return {
    onFileStart: vi.fn(),
    onProgress: vi.fn(),
    onResult: vi.fn(),
    onLog: vi.fn(),
    onComplete: vi.fn(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const originalWorker = (globalThis as any).Worker;
const originalNavigator = (globalThis as any).navigator;

beforeEach(() => {
  MockWorker.instances = [];
  (globalThis as any).Worker = MockWorker;
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8 },
    configurable: true,
  });
});

afterEach(() => {
  (globalThis as any).Worker = originalWorker;
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
});

// --- Tests ------------------------------------------------------------------

describe('runWasmBatch worker pool', () => {
  it('spawns a pool and processes files in parallel to completion', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false });
    await flush();

    expect(MockWorker.instances.length).toBe(3);
    expect(MockWorker.instances.every((w) => w.posted.length === 1)).toBe(true);

    for (const w of MockWorker.instances) w.emitDone();
    await flush();

    expect(cb.onResult).toHaveBeenCalledTimes(3);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
  });

  it('skip terminates only the stuck file, records it as failed, and continues the batch', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    const controls = runWasmBatch(files, cb, { current: false }, 'swmm5', undefined, false);
    await flush();

    // Sequential: one worker, running a.inp.
    expect(MockWorker.instances.length).toBe(1);
    const stuck = MockWorker.instances[0];
    expect(stuck.posted[0].id).toBe('a.inp');

    controls.skip('a.inp');
    await flush();

    // Stuck worker terminated, a.inp reported failed as terminated by user.
    expect(stuck.terminated).toBe(true);
    expect(cb.onResult).toHaveBeenCalledTimes(1);
    const r = cb.onResult.mock.calls[0][0];
    expect(r.id).toBe('a.inp');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Terminated by user/);
    expect(cb.onComplete).not.toHaveBeenCalled();

    // A replacement worker picks up the remaining files.
    expect(MockWorker.instances.length).toBe(2);
    const replacement = MockWorker.instances[1];
    expect(replacement.posted[0].id).toBe('b.inp');
    replacement.emitDone();
    await flush();
    replacement.emitDone();
    await flush();

    expect(cb.onResult).toHaveBeenCalledTimes(3);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip during the file-read await does not post to the terminated worker', async () => {
    // File whose .text() resolves only when we say so.
    let release!: (v: string) => void;
    const slowText = new Promise<string>((r) => { release = r; });
    const slowFile = {
      id: 'slow.inp',
      name: 'slow.inp',
      file: { size: 10, text: () => slowText } as unknown as File,
    };
    const cb = makeCallbacks();
    const controls = runWasmBatch([slowFile, makeFile('b.inp')], cb, { current: false }, 'swmm5', undefined, false);
    await flush();

    const first = MockWorker.instances[0];
    expect(first.posted.length).toBe(0); // still awaiting text()

    controls.skip('slow.inp');
    await flush();
    release('[TITLE]\nslow\n');
    await flush();

    // The original runNext must NOT post to the terminated worker.
    expect(first.posted.length).toBe(0);
    expect(cb.onResult).toHaveBeenCalledTimes(1);
    expect(cb.onResult.mock.calls[0][0].status).toBe('failed');

    // Replacement finishes the rest.
    const replacement = MockWorker.instances[1];
    expect(replacement.posted[0].id).toBe('b.inp');
    replacement.emitDone();
    await flush();
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('a stale done message from a skipped file is ignored', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp')];
    const cb = makeCallbacks();
    const controls = runWasmBatch(files, cb, { current: false }, 'swmm5', undefined, false);
    await flush();

    const first = MockWorker.instances[0];
    controls.skip('a.inp');
    await flush();
    expect(cb.onResult).toHaveBeenCalledTimes(1);

    // Simulate a done event that was already queued before the terminate by
    // invoking the handler directly (real Workers can deliver this).
    first.terminated = false;
    first.emitDone();
    await flush();

    // No duplicate result for a.inp, batch not completed early.
    expect(cb.onResult).toHaveBeenCalledTimes(1);
    expect(cb.onComplete).not.toHaveBeenCalled();

    const replacement = MockWorker.instances[1];
    replacement.emitDone();
    await flush();
    expect(cb.onResult).toHaveBeenCalledTimes(2);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skipping one worker in a parallel pool leaves the others untouched', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    const controls = runWasmBatch(files, cb, { current: false });
    await flush();

    expect(MockWorker.instances.length).toBe(3);
    const [wa, wb, wc] = MockWorker.instances;

    controls.skip('b.inp');
    await flush();

    expect(wb.terminated).toBe(true);
    expect(wa.terminated).toBe(false);
    expect(wc.terminated).toBe(false);
    // No files remain unstarted, so no replacement worker is spawned.
    expect(MockWorker.instances.length).toBe(3);

    wa.emitDone();
    wc.emitDone();
    await flush();

    expect(cb.onResult).toHaveBeenCalledTimes(3);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip of an unknown or already-finished file is a no-op', async () => {
    const files = [makeFile('a.inp')];
    const cb = makeCallbacks();
    const controls = runWasmBatch(files, cb, { current: false });
    await flush();

    controls.skip('nope.inp');
    await flush();
    expect(cb.onResult).not.toHaveBeenCalled();

    MockWorker.instances[0].emitDone();
    await flush();
    expect(cb.onComplete).toHaveBeenCalledTimes(1);

    controls.skip('a.inp');
    await flush();
    expect(cb.onResult).toHaveBeenCalledTimes(1);
  });

  it('cancel terminates all workers without signaling completion and starts no further work', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp'), makeFile('d.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef);
    await flush();

    expect(MockWorker.instances.length).toBe(4);

    // One file finishes, then the user cancels.
    MockWorker.instances[0].emitDone();
    await flush();
    const postedBefore = MockWorker.instances.reduce((n, w) => n + w.posted.length, 0);

    cancelRef.current = true;
    cancel();
    await flush();

    // All workers terminated, no completion callback fired.
    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(cb.onComplete).not.toHaveBeenCalled();

    // No new work was dispatched after cancellation.
    const postedAfter = MockWorker.instances.reduce((n, w) => n + w.posted.length, 0);
    expect(postedAfter).toBe(postedBefore);
  });

  it('cancellation reached asynchronously (during file read) does not complete or dispatch', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef);
    // Cancel immediately, before the async file.text() reads resolve.
    cancelRef.current = true;
    cancel();
    await flush();

    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(MockWorker.instances.every((w) => w.posted.length === 0)).toBe(true);
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('worker error still signals completion so the UI does not hang', async () => {
    const files = [makeFile('a.inp')];
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false });
    await flush();

    MockWorker.instances[0].onerror?.({ message: 'boom' });
    await flush();

    expect(cb.onComplete).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances[0].terminated).toBe(true);
  });

  it('parallel=false uses a single worker and runs files in order', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false }, 'swmm5', undefined, false);
    await flush();

    // Only one worker despite 8 hardware cores and 3 files.
    expect(MockWorker.instances.length).toBe(1);
    const w = MockWorker.instances[0];
    expect(w.posted.length).toBe(1);
    expect(w.posted[0].fileName).toBe('a.inp');
    expect(cb.onLog).toHaveBeenCalledWith(
      'Parallel processing is off — running files one at a time.',
      'info',
    );

    // Files are dispatched serially, in order, on the same worker.
    w.emitDone();
    await flush();
    expect(w.posted.length).toBe(2);
    expect(w.posted[1].fileName).toBe('b.inp');
    expect(cb.onComplete).not.toHaveBeenCalled();

    w.emitDone();
    await flush();
    expect(w.posted.length).toBe(3);
    expect(w.posted[2].fileName).toBe('c.inp');

    w.emitDone();
    await flush();
    expect(w.posted.map((p) => p.fileName)).toEqual(['a.inp', 'b.inp', 'c.inp']);
    expect(cb.onResult).toHaveBeenCalledTimes(3);
    expect(cb.onResult.mock.calls.map((c) => c[0].fileName)).toEqual(['a.inp', 'b.inp', 'c.inp']);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(true);
  });

  it('parallel=false cancel terminates the worker and dispatches no further files', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef, 'swmm5', undefined, false);
    await flush();

    const w = MockWorker.instances[0];
    expect(w.posted.length).toBe(1);

    // First file finishes, second is dispatched, then the user cancels.
    w.emitDone();
    await flush();
    expect(w.posted.length).toBe(2);

    cancelRef.current = true;
    cancel();
    await flush();

    expect(w.terminated).toBe(true);
    expect(w.posted.length).toBe(2);
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('caps pool size at 4 and reuses workers for remaining files', async () => {
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.inp`));
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false });
    await flush();

    expect(MockWorker.instances.length).toBe(4);
    for (const w of MockWorker.instances) w.emitDone();
    await flush();
    for (const w of MockWorker.instances) w.emitDone();
    await flush();

    expect(cb.onResult).toHaveBeenCalledTimes(6);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });
});
