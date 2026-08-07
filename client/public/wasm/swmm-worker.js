importScripts('/wasm/swmm-out-parser.js');

const ENGINES = {
  swmm5: { script: '/wasm/swmm5.js', dir: '/wasm/', factory: 'createSwmmModule' },
  swmm6: { script: '/wasm6/swmm6.js', dir: '/wasm6/', factory: 'createSwmm6Module' },
};

const modulePromises = {};

function getModule(engine) {
  const cfg = ENGINES[engine] || ENGINES.swmm5;
  const key = cfg.factory;
  if (!modulePromises[key]) {
    if (typeof self[cfg.factory] !== 'function') {
      importScripts(cfg.script);
    }
    modulePromises[key] = self[cfg.factory]({
      locateFile: (path) => cfg.dir + path,
      print: () => {},
      printErr: () => {},
    });
  }
  return modulePromises[key];
}

function parseDurationDays(inpText) {
  const get = (key) => {
    const m = inpText.match(new RegExp('^\\s*' + key + '\\s+(\\S+)', 'im'));
    return m ? m[1] : null;
  };
  const parseDate = (d, t) => {
    if (!d) return null;
    const dm = d.match(/(\d+)\/(\d+)\/(\d+)/);
    if (!dm) return null;
    let [, mo, da, yr] = dm.map(Number);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    let hours = 0;
    if (t) {
      const tm = t.match(/(\d+):(\d+)(?::(\d+))?/);
      if (tm) hours = Number(tm[1]) + Number(tm[2]) / 60 + (Number(tm[3]) || 0) / 3600;
    }
    return Date.UTC(yr, mo - 1, da) / 86400000 + hours / 24;
  };
  const start = parseDate(get('START_DATE'), get('START_TIME'));
  const end = parseDate(get('END_DATE'), get('END_TIME'));
  if (start != null && end != null && end > start) return end - start;
  return null;
}

self.onmessage = async (e) => {
  const { type, id, fileName, inpText, engine } = e.data;
  if (type !== 'run') return;

  const t0 = Date.now();
  try {
    const Module = await getModule(engine);
    const FS = Module.FS;

    const inpPath = '/input.inp';
    const rptPath = '/report.rpt';
    const outPath = '/output.out';

    try { FS.unlink(inpPath); } catch (_) {}
    try { FS.unlink(rptPath); } catch (_) {}
    try { FS.unlink(outPath); } catch (_) {}
    FS.writeFile(inpPath, inpText);

    const totalDays = parseDurationDays(inpText);

    let err = Module.ccall('swmm_open', 'number', ['string', 'string', 'string'], [inpPath, rptPath, outPath]);
    let errMsg = '';

    if (err === 0) {
      err = Module.ccall('swmm_start', 'number', ['number'], [1]);
      if (err === 0) {
        const elapsedPtr = Module._malloc(8);
        let step = 0;
        let lastPost = 0;
        while (true) {
          const code = Module.ccall('swmm_step', 'number', ['number'], [elapsedPtr]);
          const elapsed = Module.getValue(elapsedPtr, 'double');
          step++;
          if (code !== 0) { err = code; break; }
          if (elapsed <= 0) break;
          const now = Date.now();
          if (now - lastPost > 200) {
            lastPost = now;
            const pct = totalDays ? Math.min(99, Math.round((elapsed / totalDays) * 100)) : Math.min(99, step % 100);
            self.postMessage({ type: 'progress', id, fileName, percentage: pct, message: `Simulating... ${pct}%` });
          }
        }
        Module._free(elapsedPtr);
        const endErr = Module.ccall('swmm_end', 'number', [], []);
        if (err === 0) err = endErr;
      }
      const rptErr = Module.ccall('swmm_report', 'number', [], []);
      if (err === 0) err = rptErr;
    }

    if (err !== 0) {
      const bufLen = 512;
      const buf = Module._malloc(bufLen);
      Module.ccall('swmm_getError', 'number', ['number', 'number'], [buf, bufLen]);
      errMsg = Module.UTF8ToString(buf) || `SWMM error code ${err}`;
      Module._free(buf);
    }

    const warnings = Module.ccall('swmm_getWarnings', 'number', [], []);
    Module.ccall('swmm_close', 'number', [], []);

    let rptText = '';
    try { rptText = FS.readFile(rptPath, { encoding: 'utf8' }); } catch (_) {}

    // SWMM writes detailed time series to the binary .out (not the .rpt) when
    // an output file is used. Append rpt-style time-series sections parsed
    // from the .out so RPT Graphs work in every engine mode.
    if (err === 0 && rptText && !self.SwmmOutParser.reportHasTimeSeries(rptText)) {
      try {
        const outBytes = FS.readFile(outPath);
        const tsText = self.SwmmOutParser.parseSwmmOutBinary(outBytes);
        if (tsText) rptText = rptText + '\n' + tsText;
      } catch (_) {}
    } else if (err === 0 && rptText && !self.SwmmOutParser.reportHasSystemTimeSeries(rptText)) {
      // The rpt has element time series but SWMM never writes the system-wide
      // series to the rpt — pull just that section from the binary output.
      try {
        const outBytes = FS.readFile(outPath);
        const sysText = self.SwmmOutParser.parseSwmmOutBinary(outBytes, { systemOnly: true });
        if (sysText) rptText = rptText + '\n' + sysText;
      } catch (_) {}
    }

    self.postMessage({
      type: 'done',
      id,
      fileName,
      ok: err === 0,
      errMsg,
      warnings,
      rptText,
      elapsedMs: Date.now() - t0,
    });
  } catch (ex) {
    self.postMessage({
      type: 'done',
      id,
      fileName,
      ok: false,
      errMsg: 'WASM engine error: ' + (ex && ex.message ? ex.message : String(ex)),
      warnings: 0,
      rptText: '',
      elapsedMs: Date.now() - t0,
    });
  }
};
