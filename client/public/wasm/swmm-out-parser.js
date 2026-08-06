// Shared SWMM binary .out file parser.
// Converts a SWMM 5.x binary output file into rpt-style time-series text
// sections that the RPT Graphs UI (parseTimeSeries) can render.
// Used by BOTH the server (executable / SWMM5-API modes) and the in-browser
// WASM worker, so it must stay plain JavaScript with a UMD-style export and
// operate on a Uint8Array (no Node Buffer APIs).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SwmmOutParser = api;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  var MAGIC = 516114522;
  var MAX_PERIODS = 2000;

  function parseSwmmOutBinary(bytes) {
    try {
      if (!bytes || bytes.length < 40) return '';
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var i32 = function (pos) { return view.getInt32(pos, true); };
      var f32 = function (pos) { return view.getFloat32(pos, true); };
      var f64 = function (pos) { return view.getFloat64(pos, true); };

      if (i32(0) !== MAGIC) return '';

      var fileSize = bytes.length;
      var nSub = i32(12);
      var nNode = i32(16);
      var nLink = i32(20);
      var idStart = i32(fileSize - 6 * 4);
      var propStart = i32(fileSize - 5 * 4);
      var resultStart = i32(fileSize - 4 * 4);
      var numPeriods = i32(fileSize - 3 * 4);
      var errorCode = i32(fileSize - 2 * 4);

      if (errorCode !== 0 || numPeriods < 1) return '';
      if (resultStart <= 0 || resultStart >= fileSize) return '';

      var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
      function readStr(pos, len) {
        var slice = bytes.subarray(pos, pos + len);
        if (decoder) return decoder.decode(slice);
        var s = '';
        for (var k = 0; k < slice.length; k++) s += String.fromCharCode(slice[k]);
        return s;
      }

      var pos = idStart;
      var subNames = [], nodeNames = [], linkNames = [];
      var i, len;
      for (i = 0; i < nSub; i++) { len = i32(pos); pos += 4; subNames.push(readStr(pos, len)); pos += len; }
      for (i = 0; i < nNode; i++) { len = i32(pos); pos += 4; nodeNames.push(readStr(pos, len)); pos += len; }
      for (i = 0; i < nLink; i++) { len = i32(pos); pos += 4; linkNames.push(readStr(pos, len)); pos += len; }

      pos = propStart;
      var nSubProps = i32(pos); pos += 4;
      pos += nSubProps * 4 + nSub * nSubProps * 4;
      var nNodeProps = i32(pos); pos += 4;
      pos += nNodeProps * 4 + nNode * nNodeProps * 4;
      var nLinkProps = i32(pos); pos += 4;
      pos += nLinkProps * 4 + nLink * nLinkProps * 4;

      var nSubVars = i32(pos); pos += 4; pos += nSubVars * 4;
      var nNodeVars = i32(pos); pos += 4; pos += nNodeVars * 4;
      var nLinkVars = i32(pos); pos += 4; pos += nLinkVars * 4;
      var nSysVars = i32(pos); pos += 4; pos += nSysVars * 4;

      pos += 8; // start date (OLE double) — re-read per period below
      pos += 4; // report step

      if (pos !== resultStart) return '';

      var bytesPerPeriod = 8 + 4 * (nSub * nSubVars + nNode * nNodeVars + nLink * nLinkVars + nSysVars);
      if (resultStart + bytesPerPeriod * numPeriods > fileSize) return '';

      var oleEpochMs = new Date(1899, 11, 30).getTime();
      var msPerDay = 86400000;
      function pad2(n) { return n < 10 ? '0' + n : '' + n; }
      function oleToDateStr(oleDate) {
        var d = new Date(oleEpochMs + oleDate * msPerDay);
        return {
          date: pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear(),
          time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
        };
      }

      // Column width: at least 16 chars, and always >= label length + 2 so
      // headers/units are separated by 2+ spaces (parseTimeSeries splits on that).
      function padCol(s) {
        var w = Math.max(16, s.length + 2);
        while (s.length < w) s += ' ';
        return s;
      }

      var baseSubVarNames = ['Rainfall', 'Snow Depth', 'Evaporation', 'Infiltration', 'Runoff', 'GW Outflow', 'GW Elev', 'Soil Moisture'];
      var baseSubVarUnits = ['in/hr', 'in', 'in/day', 'in/hr', 'CFS', 'CFS', 'ft', ''];
      var baseNodeVarNames = ['Depth', 'Head', 'Volume', 'Lat.Inflow', 'Total Inflow', 'Flooding'];
      var baseNodeVarUnits = ['ft', 'ft', 'ft3', 'CFS', 'CFS', 'CFS'];
      var baseLinkVarNames = ['Flow', 'Depth', 'Velocity', 'Volume', 'Capacity'];
      var baseLinkVarUnits = ['CFS', 'ft', 'ft/sec', 'ft3', ''];
      var baseSysVarNames = ['Temperature', 'Rainfall', 'Snow Depth', 'Evaporation', 'Runoff', 'Dry Weather Inflow', 'GW Inflow', 'RDII Inflow', 'Direct Inflow', 'Total Lateral Inflow', 'Flooding', 'Outflow', 'Storage Volume', 'Evap Rate'];
      var baseSysVarUnits = ['deg F', 'in/hr', 'in', 'in/day', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'CFS', 'ft3', 'CFS'];

      function makeLabels(count, names, units, extraName, extraUnit) {
        var labels = [], unitLabels = [];
        for (var v = 0; v < count; v++) {
          labels.push(v < names.length ? names[v] : extraName + '_' + (v - names.length + 1));
          // Use '-' for unitless columns so the units row keeps one token per
          // column when split on whitespace (keeps units aligned to columns).
          var u = v < units.length ? units[v] : extraUnit;
          unitLabels.push(u || '-');
        }
        return { labels: labels, units: unitLabels };
      }

      var subL = makeLabels(nSubVars, baseSubVarNames, baseSubVarUnits, 'Pollutant', 'mg/L');
      var nodeL = makeLabels(nNodeVars, baseNodeVarNames, baseNodeVarUnits, 'Pollutant', 'mg/L');
      var linkL = makeLabels(nLinkVars, baseLinkVarNames, baseLinkVarUnits, 'Pollutant', 'mg/L');
      var sysL = makeLabels(nSysVars, baseSysVarNames, baseSysVarUnits, 'Var', '');

      var maxPeriods = Math.min(numPeriods, MAX_PERIODS);
      var lines = [];

      function padVal(x) {
        var s = x.toFixed(3);
        while (s.length < 12) s = ' ' + s;
        while (s.length < 16) s += ' ';
        return s;
      }

      function emitSection(sectionTitle, elementNames, labels, unitLabels, nVars, dataOffsetFor) {
        if (elementNames.length === 0 || nVars === 0) return;
        lines.push('');
        lines.push('  **************');
        lines.push('  ' + sectionTitle);
        lines.push('  **************');
        lines.push('');
        for (var e = 0; e < elementNames.length; e++) {
          lines.push('  <<< ' + elementNames[e] + ' >>>');
          lines.push('');
          var headerCols = ['Date', 'Time'].concat(labels);
          lines.push('  ' + headerCols.map(padCol).join(''));
          var unitCols = ['Day', 'Hour:Min'].concat(unitLabels);
          lines.push('  ' + unitCols.map(padCol).join(''));
          var totalWidth = headerCols.reduce(function (a, c) { return a + Math.max(16, c.length + 2); }, 0);
          lines.push('  ' + new Array(totalWidth + 1).join('-'));
          for (var p = 0; p < maxPeriods; p++) {
            var periodStart = resultStart + p * bytesPerPeriod;
            var dt = oleToDateStr(f64(periodStart));
            var dataStart = dataOffsetFor(periodStart, e);
            var vals = [padCol(dt.date), padCol(dt.time)];
            for (var v = 0; v < nVars; v++) {
              vals.push(padVal(f32(dataStart + v * 4)));
            }
            lines.push('  ' + vals.join(''));
          }
          lines.push('');
        }
      }

      emitSection('Subcatchment Results Time Series', subNames, subL.labels, subL.units, nSubVars, function (periodStart, e) {
        return periodStart + 8 + e * nSubVars * 4;
      });
      emitSection('Node Results Time Series', nodeNames, nodeL.labels, nodeL.units, nNodeVars, function (periodStart, e) {
        return periodStart + 8 + nSub * nSubVars * 4 + e * nNodeVars * 4;
      });
      emitSection('Link Results Time Series', linkNames, linkL.labels, linkL.units, nLinkVars, function (periodStart, e) {
        return periodStart + 8 + nSub * nSubVars * 4 + nNode * nNodeVars * 4 + e * nLinkVars * 4;
      });
      if (nSysVars > 0) {
        emitSection('System Results Time Series', ['System'], sysL.labels, sysL.units, nSysVars, function (periodStart) {
          return periodStart + 8 + nSub * nSubVars * 4 + nNode * nNodeVars * 4 + nLink * nLinkVars * 4;
        });
      }

      return lines.join('\n');
    } catch (e) {
      return '';
    }
  }

  // A report already contains time-series sections if it has element markers.
  function reportHasTimeSeries(rptText) {
    return typeof rptText === 'string' && rptText.indexOf('<<<') !== -1;
  }

  return { parseSwmmOutBinary: parseSwmmOutBinary, reportHasTimeSeries: reportHasTimeSeries };
});
