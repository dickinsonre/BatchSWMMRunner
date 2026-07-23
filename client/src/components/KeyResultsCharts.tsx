import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractTablesFromReport, type TableData } from "./ResultsDisplay";

const BAR_COLORS = ["hsl(210, 85%, 50%)", "hsl(340, 75%, 50%)", "hsl(142, 60%, 40%)", "hsl(35, 90%, 50%)"];
const MAX_ELEMENTS = 40;

interface ChartSpec {
  title: string;
  sectionMatch: RegExp;
  columns: { headerMatch: RegExp; label: string }[];
}

const CHART_SPECS: ChartSpec[] = [
  {
    title: "Node Flooding",
    sectionMatch: /Node Flooding Summary/i,
    columns: [
      { headerMatch: /Hours\s*Flooded/i, label: "Hours Flooded" },
      { headerMatch: /Total\s*Flood\s*Volume|Flood\s*Volume/i, label: "Flood Volume" },
    ],
  },
  {
    title: "Node Max Depths",
    sectionMatch: /Node Depth Summary/i,
    columns: [
      { headerMatch: /Maximum\s*Depth|Max(imum)?\s*Depth/i, label: "Max Depth" },
    ],
  },
  {
    title: "Link Max Flows",
    sectionMatch: /Link Flow Summary/i,
    columns: [
      { headerMatch: /Maximum\s*\|?Flow\|?|Max(imum)?\s*Flow/i, label: "Max Flow" },
      { headerMatch: /Max(imum)?\s*\|?Veloc/i, label: "Max Velocity" },
    ],
  },
];

function buildChartData(table: TableData, spec: ChartSpec) {
  const colIndices: { idx: number; label: string }[] = [];
  for (const col of spec.columns) {
    const idx = table.headers.findIndex(h => col.headerMatch.test(h));
    if (idx >= 0) colIndices.push({ idx, label: col.label });
  }
  if (colIndices.length === 0) return null;

  const data = table.rows.slice(0, MAX_ELEMENTS).map(row => {
    const entry: Record<string, string | number> = { name: row[0] || "" };
    for (const { idx, label } of colIndices) {
      const raw = idx < row.length ? row[idx].replace(/[%,]/g, "") : "";
      const num = parseFloat(raw);
      if (!isNaN(num)) entry[label] = num;
    }
    return entry;
  }).filter(e => Object.keys(e).length > 1);

  if (data.length === 0) return null;
  return { data, series: colIndices.map(c => c.label), truncated: table.rows.length > MAX_ELEMENTS, total: table.rows.length };
}

export default function KeyResultsCharts({ reportContent }: { reportContent: string }) {
  const charts = useMemo(() => {
    const tables = extractTablesFromReport(reportContent);
    const out: { title: string; data: Record<string, string | number>[]; series: string[]; truncated: boolean; total: number }[] = [];
    for (const spec of CHART_SPECS) {
      const table = tables.find(t => spec.sectionMatch.test(t.sectionTitle));
      if (!table) continue;
      const built = buildChartData(table, spec);
      if (built) out.push({ title: spec.title, ...built });
    }
    return out;
  }, [reportContent]);

  if (charts.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm" data-testid="text-no-key-charts">
        No flooding, depth, or flow summary tables were found in this report.
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="key-results-charts">
      {charts.map((chart, ci) => (
        <Card key={ci} data-testid={`card-key-chart-${ci}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{chart.title}</CardTitle>
            {chart.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing first {MAX_ELEMENTS} of {chart.total} elements
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.data} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                    height={60}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {chart.series.map((s, si) => (
                    <Bar key={s} dataKey={s} fill={BAR_COLORS[si % BAR_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
