importScripts('/wasm/swmm-out-parser.js');

let hydraPromise;

function getHydra() {
  if (!hydraPromise) {
    importScripts('/wasmhydra/hydra.js');
    const bindgen = typeof wasm_bindgen === 'function' ? wasm_bindgen : null;
    if (!bindgen) {
      throw new Error('Hydra wasm-bindgen loader did not initialize');
    }
    hydraPromise = bindgen({ module_or_path: '/wasmhydra/hydra_bg.wasm' }).then(() => bindgen);
  }
  return hydraPromise;
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function errorMessage(error) {
  const raw = error && error.message ? error.message : String(error);
  const parsed = parseJson(raw, null);
  if (parsed && Array.isArray(parsed.diagnostics)) {
    const messages = parsed.diagnostics
      .map((d) => d && (d.message || d.text || d.code))
      .filter(Boolean);
    if (messages.length > 0) return messages.join('; ');
  }
  return raw;
}

self.onmessage = async (event) => {
  const { type, id, fileName, inpText, auxFiles } = event.data;
  if (type !== 'run') return;

  const startedAt = Date.now();
  let options;
  let run;

  try {
    const hydra = await getHydra();
    options = new hydra.RunOptions(new TextEncoder().encode(inpText), fileName);
    options.withEngine('uds');
    options.withResults(true);

    if (auxFiles) {
      for (const file of auxFiles) {
        options.withAuxFile(file.name.replace(/^\/+/, ''), new Uint8Array(file.data));
      }
    }

    run = hydra.HydraRun.open(options);
    let progress = parseJson(run.progress, { done: false, t: 0, duration: 0, phase: 'Simulation' });
    let lastPost = 0;

    while (!progress.done) {
      progress = parseJson(run.advance(2000), progress);
      const now = Date.now();
      if (now - lastPost >= 200 || progress.done) {
        lastPost = now;
        const percentage = progress.duration > 0
          ? Math.min(progress.done ? 100 : 99, Math.round((progress.t / progress.duration) * 100))
          : (progress.done ? 100 : 0);
        const phase = progress.phase || 'Simulation';
        self.postMessage({
          type: 'progress',
          id,
          fileName,
          percentage,
          message: progress.done ? 'Finalizing report...' : `${phase}... ${percentage}%`,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let rptText = run.reportText() || '';
    const warnings = (rptText.match(/^\s*WARNING\b/gim) || []).length;

    if (rptText && !self.SwmmOutParser.reportHasTimeSeries(rptText)) {
      try {
        const outBytes = run.resultsBytes();
        if (outBytes) {
          const tsText = self.SwmmOutParser.parseSwmmOutBinary(outBytes);
          if (tsText) rptText += '\n' + tsText;
        }
      } catch (_) {}
    }

    self.postMessage({
      type: 'done',
      id,
      fileName,
      ok: true,
      errMsg: '',
      warnings,
      rptText,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    self.postMessage({
      type: 'done',
      id,
      fileName,
      ok: false,
      errMsg: 'Hydra WASM error: ' + errorMessage(error),
      warnings: 0,
      rptText: '',
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    try { if (run) run.free(); } catch (_) {}
    try { if (options) options.free(); } catch (_) {}
  }
};