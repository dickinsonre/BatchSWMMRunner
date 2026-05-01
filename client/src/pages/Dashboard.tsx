import { useLocation } from "wouter";
import { useMemo } from "react";
import { ArrowLeft, FileText, AlertTriangle, Droplets, CheckCircle, XCircle, Clock, BarChart3, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDashboardResults } from "@/lib/resultsStore";
import type { ProcessResult } from "@/components/ResultsDisplay";
import AppHeader from "@/components/AppHeader";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function getCEColor(val: number | undefined): string {
  if (val === undefined) return '#94a3b8';
  const abs = Math.abs(val);
  if (abs <= 1) return '#22c55e';
  if (abs <= 5) return '#eab308';
  return '#ef4444';
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { results, elapsedTime } = getDashboardResults();

  const stats = useMemo(() => {
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    const withFlooding = successful.filter(r => r.parsedMetrics?.nodesFlooded && r.parsedMetrics.nodesFlooded > 0);
    const withWarnings = successful.filter(r => {
      const runoff = r.parsedMetrics?.runoffContinuityError;
      const routing = r.parsedMetrics?.routingContinuityError;
      return (runoff !== undefined && Math.abs(runoff) > 1) || (routing !== undefined && Math.abs(routing) > 1);
    });
    const avgProcessingTime = successful.length > 0
      ? successful.reduce((sum, r) => sum + (r.processingTime || 0), 0) / successful.length
      : 0;

    return { successful, failed, withFlooding, withWarnings, avgProcessingTime };
  }, [results]);

  const continuityData = useMemo(() => {
    return results
      .filter(r => r.status === 'success')
      .map(r => ({
        name: r.fileName.replace('.inp', ''),
        runoff: r.parsedMetrics?.runoffContinuityError ?? 0,
        routing: r.parsedMetrics?.routingContinuityError ?? 0,
      }));
  }, [results]);

  const floodingData = useMemo(() => {
    return results
      .filter(r => r.status === 'success' && r.parsedMetrics?.nodesFlooded !== undefined)
      .map(r => ({
        name: r.fileName.replace('.inp', ''),
        nodes: r.parsedMetrics!.nodesFlooded!,
      }))
      .filter(d => d.nodes > 0);
  }, [results]);

  const statusPieData = useMemo(() => {
    const data = [];
    if (stats.successful.length > 0) data.push({ name: 'Success', value: stats.successful.length, color: '#22c55e' });
    if (stats.failed.length > 0) data.push({ name: 'Failed', value: stats.failed.length, color: '#ef4444' });
    return data;
  }, [stats]);

  const processingTimeData = useMemo(() => {
    return results
      .filter(r => r.processingTime != null)
      .map(r => ({
        name: r.fileName.replace('.inp', ''),
        time: parseFloat((r.processingTime || 0).toFixed(2)),
      }));
  }, [results]);

  const volumeData = useMemo(() => {
    return results
      .filter(r => r.status === 'success' && r.parsedMetrics)
      .map(r => ({
        name: r.fileName.replace('.inp', ''),
        precipitation: r.parsedMetrics?.totalPrecipitation ?? 0,
        runoff: r.parsedMetrics?.surfaceRunoff ?? 0,
      }))
      .filter(d => d.precipitation > 0 || d.runoff > 0);
  }, [results]);

  if (results.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 sm:p-8 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-no-results">No Results Available</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Run a batch processing job first, then open the dashboard to see your results.
            </p>
            <Button onClick={() => setLocation('/')} data-testid="button-back-to-home">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to BatchSWMM
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-3 sm:px-4 py-4 md:py-6 space-y-4 md:space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4" data-testid="section-dashboard-stats">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Total Files</p>
              <p className="text-3xl font-bold mt-1" data-testid="text-dash-total">{results.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Successful</p>
              <p className="text-3xl font-bold mt-1 text-green-600" data-testid="text-dash-success">{stats.successful.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-3xl font-bold mt-1 text-destructive" data-testid="text-dash-failed">{stats.failed.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Flooding</p>
              <p className={`text-3xl font-bold mt-1 ${stats.withFlooding.length > 0 ? 'text-yellow-600' : 'text-muted-foreground'}`} data-testid="text-dash-flooding">
                {stats.withFlooding.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Avg Time</p>
              <p className="text-3xl font-bold mt-1" data-testid="text-dash-avg-time">{stats.avgProcessingTime.toFixed(1)}s</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {continuityData.length > 0 && (
            <Card data-testid="card-continuity-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Continuity Errors by File
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={continuityData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: '%', position: 'insideLeft', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        fontSize: '12px',
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value: number) => `${value.toFixed(3)}%`}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="runoff" name="Runoff CE" maxBarSize={30}>
                      {continuityData.map((entry, index) => (
                        <Cell key={`runoff-${index}`} fill={getCEColor(entry.runoff)} />
                      ))}
                    </Bar>
                    <Bar dataKey="routing" name="Routing CE" maxBarSize={30}>
                      {continuityData.map((entry, index) => (
                        <Cell key={`routing-${index}`} fill={getCEColor(entry.routing)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> ≤1%</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> 1-5%</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> &gt;5%</span>
                </div>
              </CardContent>
            </Card>
          )}

          {statusPieData.length > 0 && (
            <Card data-testid="card-status-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Processing Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {statusPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col justify-center space-y-3">
                    {processingTimeData.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Processing Times</p>
                        <div className="space-y-1">
                          {processingTimeData.map(d => (
                            <div key={d.name} className="flex items-center justify-between text-xs">
                              <span className="font-mono truncate mr-2">{d.name}</span>
                              <Badge variant="outline" className="font-mono text-xs">{d.time}s</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {volumeData.length > 0 && (
            <Card data-testid="card-volume-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Precipitation vs Runoff
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={volumeData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        fontSize: '12px',
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="precipitation" name="Total Precipitation" fill="#3b82f6" maxBarSize={30} />
                    <Bar dataKey="runoff" name="Surface Runoff" fill="#06b6d4" maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {floodingData.length > 0 && (
            <Card data-testid="card-flooding-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Droplets className="h-4 w-4" />
                  Flooded Nodes by File
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={floodingData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        fontSize: '12px',
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                    />
                    <Bar dataKey="nodes" name="Flooded Nodes" fill="#eab308" maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>

        <Card data-testid="card-detailed-metrics">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Detailed Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[500px]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-dashboard-metrics">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">File</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                      <th className="text-right py-2 px-3 font-medium">Runoff CE</th>
                      <th className="text-right py-2 px-3 font-medium">Routing CE</th>
                      <th className="text-right py-2 px-3 font-medium">Precip.</th>
                      <th className="text-right py-2 px-3 font-medium">Runoff</th>
                      <th className="text-center py-2 px-3 font-medium">Flooding</th>
                      <th className="text-left py-2 px-3 font-medium">Routing</th>
                      <th className="text-left py-2 px-3 font-medium">Infiltration</th>
                      <th className="text-right py-2 px-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.id} className="border-b last:border-0" data-testid={`row-dash-${r.id}`}>
                        <td className="py-2 px-3 font-mono text-xs">{r.fileName}</td>
                        <td className="py-2 px-3">
                          {r.status === 'success' ? (
                            <span className="text-green-600 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> OK</span>
                          ) : (
                            <span className="text-destructive flex items-center gap-1"><XCircle className="h-3 w-3" /> Fail</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs" style={{ color: getCEColor(r.parsedMetrics?.runoffContinuityError) }}>
                          {r.parsedMetrics?.runoffContinuityError !== undefined ? `${r.parsedMetrics.runoffContinuityError.toFixed(3)}%` : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs" style={{ color: getCEColor(r.parsedMetrics?.routingContinuityError) }}>
                          {r.parsedMetrics?.routingContinuityError !== undefined ? `${r.parsedMetrics.routingContinuityError.toFixed(3)}%` : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs">
                          {r.parsedMetrics?.totalPrecipitation !== undefined ? r.parsedMetrics.totalPrecipitation.toFixed(2) : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs">
                          {r.parsedMetrics?.surfaceRunoff !== undefined ? r.parsedMetrics.surfaceRunoff.toFixed(2) : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {r.parsedMetrics?.nodesFlooded !== undefined ? (
                            r.parsedMetrics.nodesFlooded > 0 ? (
                              <Badge variant="secondary" className="text-yellow-700">
                                <Droplets className="h-3 w-3 mr-1" />
                                {r.parsedMetrics.nodesFlooded}
                              </Badge>
                            ) : (
                              <span className="text-xs text-green-600">None</span>
                            )
                          ) : 'N/A'}
                        </td>
                        <td className="py-2 px-3 text-xs">{r.parsedMetrics?.routingMethod ?? 'N/A'}</td>
                        <td className="py-2 px-3 text-xs">{r.parsedMetrics?.infiltrationMethod ?? 'N/A'}</td>
                        <td className="py-2 px-3 text-right font-mono text-xs">
                          {r.processingTime != null ? `${r.processingTime.toFixed(1)}s` : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
