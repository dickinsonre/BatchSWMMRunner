import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Area, AreaChart, Brush,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BarChart3, Layers, Table2 } from "lucide-react";

interface TimeSeriesEntry {
  time: string;
  values: number[];
}

interface ParsedTimeSeries {
  title: string;
  element: string;
  columns: string[];
  units: string[];
  data: TimeSeriesEntry[];
}

const CHART_COLORS = [
  "hsl(210, 85%, 50%)",
  "hsl(340, 75%, 50%)",
  "hsl(142, 60%, 40%)",
  "hsl(35, 90%, 50%)",
  "hsl(270, 60%, 55%)",
  "hsl(180, 55%, 40%)",
  "hsl(0, 70%, 55%)",
  "hsl(50, 80%, 45%)",
];

function parseTimeSeries(rawContent: string): ParsedTimeSeries[] {
  const series: ParsedTimeSeries[] = [];
  const lines = rawContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (/^\s*\*{3,}\s*$/.test(lines[i])) {
      i++;
      if (i < lines.length) {
        const titleLine = lines[i].trim();
        if (/Time Series$/i.test(titleLine)) {
          const sectionTitle = titleLine;
          i++;
          while (i < lines.length && /^\s*\*{3,}\s*$/.test(lines[i])) i++;

          while (i < lines.length) {
            if (/^\s*\*{3,}\s*$/.test(lines[i])) {
              const peekTitle = i + 1 < lines.length ? lines[i + 1].trim() : '';
              if (!/Time Series$/i.test(peekTitle)) break;
            }

            const elemMatch = lines[i].match(/<<<\s*(.*?)\s*>>>/);
            if (elemMatch) {
              const elementName = elemMatch[1];
              i++;
              while (i < lines.length && lines[i].trim() === '') i++;
              const colLine = lines[i] || '';
              const columns = colLine.trim().split(/\s{2,}/).filter(c => c && c !== 'Date' && c !== 'Time');
              i++;
              const unitLine = lines[i] || '';
              const units = unitLine.trim().split(/\s{2,}/).filter(u => u && u !== 'Day' && u !== 'Hour:Min');
              i++;
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

interface ChartViewProps {
  allSeries: ParsedTimeSeries[];
}

function ChartView({ allSeries }: ChartViewProps) {
  const sectionMap = useMemo(() => {
    const map = new Map<string, ParsedTimeSeries[]>();
    for (const ts of allSeries) {
      if (!map.has(ts.title)) map.set(ts.title, []);
      map.get(ts.title)!.push(ts);
    }
    return map;
  }, [allSeries]);

  const sectionNames = useMemo(() => Array.from(sectionMap.keys()), [sectionMap]);

  const [activeSection, setActiveSection] = useState(sectionNames[0] || '');
  const [selectedElements, setSelectedElements] = useState<Set<string>>(() => {
    const first = sectionMap.get(sectionNames[0] || '');
    if (first && first.length > 0) return new Set([first[0].element]);
    return new Set();
  });
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
    const first = sectionMap.get(sectionNames[0] || '');
    if (first && first.length > 0) {
      const cols = first[0].columns.filter((_, ci) => !first[0].data.every(d => (d.values[ci] ?? 0) === 0));
      return new Set(cols.length > 0 ? [cols[0]] : []);
    }
    return new Set();
  });
  const [chartType, setChartType] = useState<'line' | 'area'>('area');
  const [showTable, setShowTable] = useState(false);

  const sectionSeries = useMemo(() => sectionMap.get(activeSection) || [], [sectionMap, activeSection]);
  const allElements = useMemo(() => sectionSeries.map(s => s.element), [sectionSeries]);
  const allColumns = useMemo(() => {
    if (sectionSeries.length === 0) return [];
    const first = sectionSeries[0];
    return first.columns.map((col, ci) => ({
      name: col,
      unit: first.units[ci] || '',
      allZero: sectionSeries.every(s => s.data.every(d => (d.values[ci] ?? 0) === 0)),
    }));
  }, [sectionSeries]);

  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    const series = sectionMap.get(section) || [];
    if (series.length > 0) {
      setSelectedElements(new Set([series[0].element]));
      const cols = series[0].columns.filter((_, ci) => !series[0].data.every(d => (d.values[ci] ?? 0) === 0));
      setSelectedColumns(new Set(cols.length > 0 ? [cols[0]] : []));
    }
    setShowTable(false);
  };

  const toggleElement = (el: string) => {
    setSelectedElements(prev => {
      const next = new Set(prev);
      if (next.has(el)) {
        if (next.size > 1) next.delete(el);
      } else {
        next.add(el);
      }
      return next;
    });
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) {
        if (next.size > 1) next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  };

  const allElementsSelected = selectedElements.size === allElements.length && allElements.length > 0;
  const toggleAllElements = () => {
    if (allElementsSelected) {
      setSelectedElements(new Set());
    } else {
      setSelectedElements(new Set(allElements));
    }
  };

  const selectableColumns = allColumns.filter(c => !c.allZero).map(c => c.name);
  const allColumnsSelected = selectedColumns.size === selectableColumns.length && selectableColumns.length > 0;
  const toggleAllColumns = () => {
    if (allColumnsSelected) {
      setSelectedColumns(new Set());
    } else {
      setSelectedColumns(new Set(selectableColumns));
    }
  };

  const chartData = useMemo(() => {
    const activeSeries = sectionSeries.filter(s => selectedElements.has(s.element));
    if (activeSeries.length === 0) return [];

    const maxLen = Math.max(...activeSeries.map(s => s.data.length));
    const result: Record<string, any>[] = [];

    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, any> = {};
      let time = '';
      for (const s of activeSeries) {
        if (i < s.data.length) {
          if (!time) time = s.data[i].time;
          for (let ci = 0; ci < s.columns.length; ci++) {
            if (selectedColumns.has(s.columns[ci])) {
              const key = activeSeries.length > 1 ? `${s.element} - ${s.columns[ci]}` : s.columns[ci];
              row[key] = s.data[i].values[ci] ?? 0;
            }
          }
        }
      }
      row['time'] = time;
      result.push(row);
    }
    return result;
  }, [sectionSeries, selectedElements, selectedColumns]);

  const lineKeys = useMemo(() => {
    if (chartData.length === 0) return [];
    return Object.keys(chartData[0]).filter(k => k !== 'time');
  }, [chartData]);

  const seriesColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    const sortedElements = [...allElements].sort();
    const sortedColumns = allColumns.filter(c => !c.allZero).map(c => c.name).sort();
    for (const el of sortedElements) {
      for (const col of sortedColumns) {
        const singleKey = col;
        const multiKey = `${el} - ${col}`;
        if (!map.has(singleKey)) map.set(singleKey, CHART_COLORS[colorIdx % CHART_COLORS.length]);
        if (!map.has(multiKey)) map.set(multiKey, CHART_COLORS[colorIdx % CHART_COLORS.length]);
        colorIdx++;
      }
    }
    return map;
  }, [allElements, allColumns]);

  const tickInterval = useMemo(() => {
    if (chartData.length <= 12) return 0;
    return Math.max(Math.floor(chartData.length / 8) - 1, 1);
  }, [chartData]);

  if (allSeries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground" data-testid="text-no-charts">
        No time series data available.
      </div>
    );
  }

  const ChartComponent = chartType === 'area' ? AreaChart : LineChart;

  return (
    <div className="space-y-4" data-testid="interactive-charts">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-shrink-0">
          <Select value={activeSection} onValueChange={handleSectionChange}>
            <SelectTrigger className="w-64" data-testid="select-chart-section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sectionNames.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant={chartType === 'area' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setChartType('area')}
            data-testid="button-chart-area"
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Area
          </Button>
          <Button
            variant={chartType === 'line' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setChartType('line')}
            data-testid="button-chart-line"
          >
            <Layers className="h-3.5 w-3.5 mr-1" />
            Line
          </Button>
        </div>

        <Button
          variant={showTable ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowTable(!showTable)}
          data-testid="button-toggle-data-table"
        >
          <Table2 className="h-3.5 w-3.5 mr-1" />
          Data Table
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Elements</CardTitle>
                <Button variant="ghost" size="sm" onClick={toggleAllElements} data-testid="button-select-all-elements">
                  {allElementsSelected ? 'None' : 'All'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 pb-3">
              {allElements.map((el, idx) => (
                <div key={el} className="flex items-center gap-2">
                  <Checkbox
                    id={`el-${el}`}
                    checked={selectedElements.has(el)}
                    onCheckedChange={() => toggleElement(el)}
                    data-testid={`checkbox-element-${idx}`}
                  />
                  <Label htmlFor={`el-${el}`} className="text-xs font-mono cursor-pointer">
                    {el}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Values</CardTitle>
                <Button variant="ghost" size="sm" onClick={toggleAllColumns} data-testid="button-select-all-values">
                  {allColumnsSelected ? 'None' : 'All'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 pb-3">
              {allColumns.map((col, idx) => (
                <div key={col.name} className="flex items-center gap-2">
                  <Checkbox
                    id={`col-${col.name}`}
                    checked={selectedColumns.has(col.name)}
                    onCheckedChange={() => toggleColumn(col.name)}
                    disabled={col.allZero}
                    data-testid={`checkbox-value-${idx}`}
                  />
                  <Label htmlFor={`col-${col.name}`} className={`text-xs cursor-pointer ${col.allZero ? 'text-muted-foreground line-through' : ''}`}>
                    {col.name}
                    {col.unit && <span className="text-muted-foreground ml-1">({col.unit})</span>}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          {lineKeys.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm border rounded-md" data-testid="text-select-prompt">
              Select at least one element and one value to display a chart.
            </div>
          ) : (
            <Card>
              <CardContent className="pt-4 pb-2 px-2">
                <div className="flex items-center gap-2 px-4 pb-2 flex-wrap">
                  {selectedElements.size > 0 && (
                    <span className="text-xs text-muted-foreground">Showing:</span>
                  )}
                  {Array.from(selectedElements).map(el => (
                    <Badge key={el} variant="outline" className="text-xs font-mono">{el}</Badge>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={400} data-testid="chart-container">
                  <ChartComponent data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10 }}
                      interval={tickInterval}
                      tickFormatter={(val: string) => {
                        const parts = val.split(' ');
                        return parts.length > 1 ? parts[parts.length - 1] : val;
                      }}
                      angle={-30}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={60} />
                    <Tooltip
                      contentStyle={{
                        fontSize: '12px',
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      }}
                      labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    />
                    {lineKeys.map((key) => {
                      const color = seriesColorMap.get(key) || CHART_COLORS[0];
                      if (chartType === 'area') {
                        return (
                          <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            stroke={color}
                            fill={color}
                            fillOpacity={0.15}
                            strokeWidth={1.5}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 1 }}
                          />
                        );
                      }
                      return (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={color}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 1 }}
                        />
                      );
                    })}
                    {chartData.length > 30 && (
                      <Brush
                        dataKey="time"
                        height={20}
                        stroke="hsl(210, 60%, 60%)"
                        fill="hsl(var(--muted))"
                        tickFormatter={(val) => val}
                      />
                    )}
                  </ChartComponent>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {showTable && chartData.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Data Table</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <table className="w-full text-xs font-mono" data-testid="table-chart-data">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1.5 px-2 sticky top-0 bg-background">Time</th>
                        {lineKeys.map(k => (
                          <th key={k} className="text-right py-1.5 px-2 sticky top-0 bg-background">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((row, ri) => (
                        <tr key={ri} className="border-b last:border-0">
                          <td className="py-1 px-2 text-muted-foreground">{row.time}</td>
                          {lineKeys.map(k => (
                            <td key={k} className="py-1 px-2 text-right tabular-nums">
                              {typeof row[k] === 'number' ? row[k].toFixed(3) : row[k]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

interface InteractiveChartsProps {
  reportContent: string;
}

export default function InteractiveCharts({ reportContent }: InteractiveChartsProps) {
  const allSeries = useMemo(() => parseTimeSeries(reportContent), [reportContent]);
  return <ChartView allSeries={allSeries} />;
}
