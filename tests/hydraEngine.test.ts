import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parseTimeSeries } from '../client/src/lib/parseTimeSeries';

const HYDRA_DIR = path.join(process.cwd(), 'client', 'public', 'wasmhydra');
const HYDRA_JS = path.join(HYDRA_DIR, 'hydra.js');
const HYDRA_WASM = path.join(HYDRA_DIR, 'hydra_bg.wasm');
const HYDRA_WORKER = path.join(HYDRA_DIR, 'hydra-worker.js');
const OUT_PARSER = path.join(process.cwd(), 'client', 'public', 'wasm', 'swmm-out-parser.js');
const SAMPLE_INP = path.join(process.cwd(), 'public', 'samples', 'Session15_Runoff47.inp');
const prerequisites = [HYDRA_JS, HYDRA_WASM, HYDRA_WORKER, OUT_PARSER, SAMPLE_INP].every(fs.existsSync);

type HydraBindings = {
  (options: { module_or_path: Uint8Array }): Promise<unknown>;
  versionInfo(): string;
  RunOptions: new (model: Uint8Array, modelName: string) => {
    withEngine(engine: string): void;
    withResults(enabled: boolean): void;
    free(): void;
  };
  HydraRun: {
    open(options: unknown): {
      engineKey: string;
      progress: string;
      advance(maxSteps: number): string;
      reportText(): string;
      resultsBytes(): Uint8Array | undefined;
      free(): void;
    };
  };
};

async function loadHydra(): Promise<HydraBindings> {
  const source = fs.readFileSync(HYDRA_JS, 'utf8');
  const hydra = new Function(`${source}\nreturn wasm_bindgen;`)() as HydraBindings;
  await hydra({ module_or_path: new Uint8Array(fs.readFileSync(HYDRA_WASM)) });
  return hydra;
}

describe.runIf(prerequisites)('Hydra v12.1.0 browser engine', () => {
  it('worker explicitly selects UDS, advances cooperatively, and captures results', () => {
    const worker = fs.readFileSync(HYDRA_WORKER, 'utf8');
    expect(worker).not.toContain('self.wasm_bindgen');
    expect(worker).toContain("typeof wasm_bindgen === 'function'");
    expect(worker).toContain("options.withEngine('uds')");
    expect(worker).toContain('run.advance(2000)');
    expect(worker).toContain('run.progress');
    expect(worker).not.toContain('run.progress()');
    expect(worker).toContain('run.resultsBytes()');
  });

  it('initializes the real wasm-bindgen bundle through the classic worker global', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const sandbox: Record<string, any> = {
      console,
      Date,
      Promise,
      Response,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      WebAssembly,
      fetch: async () => new Response(new Uint8Array(fs.readFileSync(HYDRA_WASM))),
      postMessage: (message: Record<string, unknown>) => posted.push(message),
      setTimeout,
    };
    sandbox.self = sandbox;
    const context = vm.createContext(sandbox);
    sandbox.importScripts = (...urls: string[]) => {
      for (const url of urls) {
        if (url.endsWith('/hydra.js')) {
          vm.runInContext(fs.readFileSync(HYDRA_JS, 'utf8'), context);
        } else if (url.endsWith('/swmm-out-parser.js')) {
          sandbox.SwmmOutParser = {
            reportHasTimeSeries: () => true,
            parseSwmmOutBinary: () => '',
          };
        }
      }
    };

    vm.runInContext(fs.readFileSync(HYDRA_WORKER, 'utf8'), context);
    await sandbox.onmessage({
      data: {
        type: 'run',
        id: 'worker-smoke',
        fileName: path.basename(SAMPLE_INP),
        inpText: fs.readFileSync(SAMPLE_INP, 'utf8'),
      },
    });

    const done = posted.find(message => message.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      id: 'worker-smoke',
      ok: true,
      errMsg: '',
    });
  });

  it('runs a real SWMM sample with chartable subcatchment, node, and link series', async () => {
    const hydra = await loadHydra();
    expect(JSON.parse(hydra.versionInfo()).hydra).toBe('12.1.0');

    const options = new hydra.RunOptions(
      new Uint8Array(fs.readFileSync(SAMPLE_INP)),
      path.basename(SAMPLE_INP),
    );
    options.withEngine('uds');
    options.withResults(true);

    const run = hydra.HydraRun.open(options);
    try {
      let progress = JSON.parse(run.progress) as { done: boolean };
      let calls = 0;
      while (!progress.done && calls < 10_000) {
        progress = JSON.parse(run.advance(10_000)) as { done: boolean };
        calls++;
      }

      expect(progress.done).toBe(true);
      expect(run.engineKey).toBe('uds');
      expect(run.reportText()).toContain('HYDRA URBAN DRAINAGE ENGINE - VERSION 12.1.0');
      const results = run.resultsBytes();
      expect(results?.byteLength).toBeGreaterThan(0);

      const parserScope: {
        SwmmOutParser?: {
          parseSwmmOutBinary(bytes: Uint8Array): string;
          reportHasTimeSeries(report: string): boolean;
        };
      } = {};
      new Function('self', fs.readFileSync(OUT_PARSER, 'utf8'))(parserScope);
      const timeSeries = parserScope.SwmmOutParser!.parseSwmmOutBinary(results!);
      expect(timeSeries.length).toBeGreaterThan(1_000);
      expect(parserScope.SwmmOutParser!.reportHasTimeSeries(timeSeries)).toBe(true);
      const chartSeries = parseTimeSeries(`${run.reportText()}\n${timeSeries}`);
      expect(chartSeries.some(series => /^Subcatchment/i.test(series.title))).toBe(true);
      expect(chartSeries.some(series => /^Node/i.test(series.title))).toBe(true);
      expect(chartSeries.some(series => /^Link/i.test(series.title))).toBe(true);
      expect(chartSeries.every(series =>
        series.data.length > 0 &&
        series.data.every(entry => entry.values.length > 0 && entry.values.every(Number.isFinite)),
      )).toBe(true);
    } finally {
      run.free();
      options.free();
    }
  });
});