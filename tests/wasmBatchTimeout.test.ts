/**
 * Tests for runWasmBatch timeout watchdog and cancel regression.
 *
 * The watchdog is a setInterval that fires every 5 s and skips any in-flight
 * file whose elapsed time exceeds `timeoutMs`.
 *
 * vi.useFakeTimers() mocks both setInterval AND Date, so:
 *  - vi.advanceTimersByTime(N) advances the fake clock, fires queued intervals,
 *    and updates Date.now().
 *  - flush() drains the microtask queue via chained Promise.resolve() calls
 *    (avoids the real-setTimeout path that would also be mocked).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runWasmBatch } from '../client/src/lib/swmmWasmEngine';

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

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

  /** Simulate the worker finishing its most recent job successfully. */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, content = '[TITLE]\ntest\n') {
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

/**
 * Drain the microtask queue without relying on setTimeout (which is faked).
 * Five chained Promise.resolve() ticks is enough to let File#text() and the
 * subsequent postMessage / callback chains resolve.
 */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalWorker = (globalThis as any).Worker;
const originalNavigator = (globalThis as any).navigator;

beforeEach(() => {
  MockWorker.instances = [];
  (globalThis as any).Worker = MockWorker;
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8 },
    configurable: true,
  });
  // Fake both setInterval and Date so that advancing the clock also moves
  // Date.now() forward (required by the watchdog's elapsed-time comparison).
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).Worker = originalWorker;
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Timeout watchdog tests
// ---------------------------------------------------------------------------

describe('runWasmBatch — timeout watchdog', () => {
  it('skips a single timed-out file and still calls onComplete', async () => {
    const cb = makeCallbacks();
    runWasmBatch([makeFile('slow.inp')], cb, { current: false }, 'swmm5', undefined, false, 60_000);
    await flush();

    // Advance the fake clock past the timeout threshold; the watchdog fires.
    vi.advanceTimersByTime(65_000);
    await flush();

    expect(MockWorker.instances[0].terminated).toBe(true);
    expect(cb.onResult).toHaveBeenCalledTimes(1);
    const result = cb.onResult.mock.calls[0][0];
    expect(result.id).toBe('slow.inp');
    expect(result.status).toBe('timeout');
    // onComplete must fire even for a single-file timed-out batch.
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skips only the timed-out file and lets remaining files complete (sequential)', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false }, 'swmm5', undefined, false, 60_000);
    await flush();

    // Sequential: one worker on a.inp. Advance past the timeout.
    vi.advanceTimersByTime(65_000);
    await flush();

    // a.inp was skipped; the other two are still pending.
    expect(cb.onResult).toHaveBeenCalledTimes(1);
    expect(cb.onResult.mock.calls[0][0].id).toBe('a.inp');
    expect(cb.onResult.mock.calls[0][0].status).toBe('timeout');
    expect(cb.onComplete).not.toHaveBeenCalled();

    // A replacement worker should be running b.inp.
    const replacement = MockWorker.instances[MockWorker.instances.length - 1];
    expect(replacement.posted[0]?.id).toBe('b.inp');

    replacement.emitDone(); // b.inp done
    await flush();
    replacement.emitDone(); // c.inp done
    await flush();

    expect(cb.onResult).toHaveBeenCalledTimes(3);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skips only the timed-out file in a parallel pool; finisher is untouched', async () => {
    // b.inp finishes before the watchdog fires — only a.inp and c.inp time out.
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cb = makeCallbacks();
    runWasmBatch(files, cb, { current: false }, 'swmm5', undefined, true, 60_000);
    await flush();

    expect(MockWorker.instances.length).toBe(3);
    const [, wb] = MockWorker.instances;

    wb.emitDone(); // b.inp finishes before the timeout
    await flush();

    vi.advanceTimersByTime(65_000); // watchdog fires; a.inp and c.inp time out
    await flush();

    const statuses = cb.onResult.mock.calls.map((c) => c[0].status);
    expect(statuses.length).toBe(3);
    expect(statuses.filter((s) => s === 'success').length).toBe(1);
    expect(statuses.filter((s) => s === 'timeout').length).toBe(2);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('watchdog does not fire when timeoutMs is omitted', async () => {
    const cb = makeCallbacks();
    runWasmBatch([makeFile('a.inp')], cb, { current: false });
    await flush();

    // Advance a very long time — no watchdog installed, nothing should happen.
    vi.advanceTimersByTime(300_000);
    await flush();

    expect(cb.onResult).not.toHaveBeenCalled();
    expect(cb.onComplete).not.toHaveBeenCalled();

    // Normal finish still works.
    MockWorker.instances[0].emitDone();
    await flush();
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('watchdog is cleared after the batch completes (no spurious post-finish fires)', async () => {
    const cb = makeCallbacks();
    runWasmBatch([makeFile('a.inp')], cb, { current: false }, 'swmm5', undefined, false, 120_000);
    await flush();

    // File finishes well before the timeout.
    MockWorker.instances[0].emitDone();
    await flush();
    expect(cb.onComplete).toHaveBeenCalledTimes(1);

    const resultCountAfterFinish = cb.onResult.mock.calls.length;

    // Advancing beyond the timeout after the batch is done must be a no-op.
    vi.advanceTimersByTime(130_000);
    await flush();
    expect(cb.onResult).toHaveBeenCalledTimes(resultCountAfterFinish);
    expect(cb.onComplete).toHaveBeenCalledTimes(1);
  });

  it('the timeout log message mentions timeout', async () => {
    const cb = makeCallbacks();
    runWasmBatch([makeFile('big.inp')], cb, { current: false }, 'swmm5', undefined, false, 30_000);
    await flush();

    vi.advanceTimersByTime(35_000);
    await flush();

    expect(cb.onResult.mock.calls[0][0].status).toBe('timeout');
    const logMessages: string[] = cb.onLog.mock.calls.map((c: any[]) => c[0] as string);
    expect(logMessages.some((m) => /timeout/i.test(m))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cancel regression tests (watchdog installed in all cases)
// ---------------------------------------------------------------------------

describe('runWasmBatch — cancel regression (with timeout active)', () => {
  it('cancel terminates all workers without onComplete, even with an active watchdog', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef, 'swmm5', undefined, true, 120_000);
    await flush();

    expect(MockWorker.instances.length).toBe(3);

    cancelRef.current = true;
    cancel();
    await flush();

    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(cb.onComplete).not.toHaveBeenCalled();

    // Watchdog fires after cancellation — must be a no-op.
    vi.advanceTimersByTime(130_000);
    await flush();
    expect(cb.onComplete).not.toHaveBeenCalled();
    expect(cb.onResult).not.toHaveBeenCalled();
  });

  it('cancel mid-batch (one file already done) stops remaining workers', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp'), makeFile('d.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef, 'swmm5', undefined, true, 120_000);
    await flush();

    MockWorker.instances[0].emitDone(); // one file finishes normally
    await flush();
    expect(cb.onResult).toHaveBeenCalledTimes(1);

    cancelRef.current = true;
    cancel();
    await flush();

    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('sequential cancel terminates the single worker and dispatches no further files', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp'), makeFile('c.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef, 'swmm5', undefined, false, 120_000);
    await flush();

    const w = MockWorker.instances[0];
    w.emitDone(); // first file done, second dispatched
    await flush();
    expect(w.posted.length).toBe(2);

    cancelRef.current = true;
    cancel();
    await flush();

    expect(w.terminated).toBe(true);
    expect(w.posted.length).toBe(2); // third file never dispatched
    expect(cb.onComplete).not.toHaveBeenCalled();
  });

  it('immediate cancel (before file reads) leaves no live workers', async () => {
    const files = [makeFile('a.inp'), makeFile('b.inp')];
    const cancelRef = { current: false };
    const cb = makeCallbacks();
    const cancel = runWasmBatch(files, cb, cancelRef, 'swmm5', undefined, true, 120_000);

    cancelRef.current = true;
    cancel();
    await flush();

    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(cb.onComplete).not.toHaveBeenCalled();
  });
});
