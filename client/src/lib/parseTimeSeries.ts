// Parses rpt-style "Results Time Series" sections out of a SWMM report.
// Kept as a plain .ts module (no JSX) so node-side tests can exercise the
// exact parser the RPT Graphs tab feeds into recharts.

export interface TimeSeriesEntry {
  time: string;
  values: number[];
}

export interface ParsedTimeSeries {
  title: string;
  element: string;
  columns: string[];
  units: string[];
  data: TimeSeriesEntry[];
}

export function parseTimeSeries(rawContent: string): ParsedTimeSeries[] {
  const series: ParsedTimeSeries[] = [];
  const lines = rawContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (/^\s*\*{3,}\s*$/.test(lines[i])) {
      i++;
      if (i < lines.length) {
        const titleLine = lines[i].trim();
        if (/Time Series( Results)?$/i.test(titleLine)) {
          const sectionTitle = titleLine;
          i++;
          while (i < lines.length && /^\s*\*{3,}\s*$/.test(lines[i])) i++;

          while (i < lines.length) {
            if (/^\s*\*{3,}\s*$/.test(lines[i])) {
              break;
            }

            const elemMatch = lines[i].match(/<<<\s*(.*?)\s*>>>/);
            if (elemMatch) {
              const elementName = elemMatch[1];
              i++;
              // Skip blank lines and leading dashed separators (SWMM6 places
              // a dashed line before the column headers).
              while (i < lines.length && (lines[i].trim() === '' || /^\s*-{3,}\s*$/.test(lines[i]))) i++;
              const colLine = lines[i] || '';
              let columns: string[];
              let units: string[];
              if (/\bDate\b/.test(colLine)) {
                // SWMM5 layout:  Date  Time  <names>  /  Day  Hour:Min  <units>
                columns = colLine.trim().split(/\s{2,}/).filter(c => c && c !== 'Date' && c !== 'Time');
                i++;
                const unitLine = lines[i] || '';
                units = unitLine.trim().split(/\s{2,}/).filter(u => u && u !== 'Day' && u !== 'Hour:Min');
                i++;
              } else {
                // SWMM6 (OpenSWMM 5.3) layout:  <names>  /  Date  Time  <units>
                columns = colLine.trim().split(/\s{2,}/).filter(Boolean);
                i++;
                const unitLine = lines[i] || '';
                units = unitLine.trim().split(/\s{2,}/).filter(u => u && u !== 'Date' && u !== 'Time');
                i++;
              }
              while (i < lines.length && /^\s*-{3,}/.test(lines[i])) i++;

              const data: TimeSeriesEntry[] = [];
              while (i < lines.length) {
                const dataLine = lines[i].trim();
                if (!dataLine || /^\s*\*{3,}/.test(lines[i]) || /<<</.test(lines[i])) break;
                const parts = dataLine.split(/\s+/);
                if (parts.length >= 4 && /^\d{2}\/\d{2}\/\d{4}$/.test(parts[0])) {
                  const date = parts[0];
                  const time = `${date} ${parts[1]}`;
                  const values = parts.slice(2).map(v => parseFloat(v)).filter(v => !isNaN(v));
                  if (values.length > 0) {
                    data.push({ time, values });
                  }
                }
                i++;
              }

              if (data.length > 0) {
                series.push({ title: sectionTitle, element: elementName, columns, units, data });
              }
              continue;
            }
            i++;
          }
          continue;
        }
      }
    }
    i++;
  }
  return series;
}
