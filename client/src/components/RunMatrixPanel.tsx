import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlaskConical } from "lucide-react";
import type { RunMatrixConfig, MatrixBuild } from "@/lib/runMatrix";

interface RunMatrixPanelProps {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  config: RunMatrixConfig;
  onConfigChange: (value: RunMatrixConfig) => void;
  build: MatrixBuild;
  /** Exactly one uploaded model is required for a matrix run. */
  fileCount: number;
  compareMode: boolean;
  disabled?: boolean;
}

export default function RunMatrixPanel({
  enabled,
  onEnabledChange,
  config,
  onConfigChange,
  build,
  fileCount,
  compareMode,
  disabled,
}: RunMatrixPanelProps) {
  const set = (patch: Partial<RunMatrixConfig>) => onConfigChange({ ...config, ...patch });
  const blocker =
    compareMode ? 'Run matrix is unavailable in engine comparison mode — select a single engine.'
      : fileCount === 0 ? 'Upload one model file to enable the run matrix.'
      : fileCount > 1 ? `Run matrix needs exactly one model file (you have ${fileCount}).`
      : null;

  return (
    <Card data-testid="card-run-matrix">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            Run Matrix — solver experiment
          </CardTitle>
          <div className="flex items-center gap-2">
            {enabled && !blocker && (
              <Badge variant="outline" data-testid="badge-matrix-count">
                {build.variants.length} variant{build.variants.length !== 1 ? 's' : ''}
              </Badge>
            )}
            <Switch
              checked={enabled}
              onCheckedChange={onEnabledChange}
              disabled={disabled}
              data-testid="switch-run-matrix"
              aria-label="Enable run matrix"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Run one model across many solver settings, then chart continuity error, runtime, and peak flow
          against the routing step.
        </p>
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-4">
          {blocker && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400" data-testid="text-matrix-blocker">{blocker}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="matrix-routing-steps">Routing steps (seconds)</Label>
              <Input
                id="matrix-routing-steps"
                value={config.routingStepsText}
                onChange={(e) => set({ routingStepsText: e.target.value })}
                placeholder="1, 5, 15, 30"
                disabled={disabled}
                data-testid="input-matrix-routing-steps"
              />
              <p className="text-xs text-muted-foreground">Comma-separated list; one run per step.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Variable time step</Label>
              <Select
                value={config.variableStep}
                onValueChange={(v) => set({ variableStep: v as RunMatrixConfig['variableStep'] })}
                disabled={disabled}
              >
                <SelectTrigger data-testid="select-matrix-variable-step">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Keep model default</SelectItem>
                  <SelectItem value="off">Off (VARIABLE_STEP 0)</SelectItem>
                  <SelectItem value="on">On (VARIABLE_STEP 0.75)</SelectItem>
                  <SelectItem value="both">Compare both (doubles the matrix)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Inertial terms (INERTIAL_DAMPING)</Label>
              <Select
                value={config.inertialDamping}
                onValueChange={(v) => set({ inertialDamping: v as RunMatrixConfig['inertialDamping'] })}
                disabled={disabled}
              >
                <SelectTrigger data-testid="select-matrix-inertial">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Keep model default</SelectItem>
                  <SelectItem value="NONE">Keep (NONE)</SelectItem>
                  <SelectItem value="PARTIAL">Dampen (PARTIAL)</SelectItem>
                  <SelectItem value="FULL">Ignore (FULL)</SelectItem>
                  <SelectItem value="all">Compare all three (triples the matrix)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="matrix-lengthening">Conduit lengthening step (seconds)</Label>
              <Input
                id="matrix-lengthening"
                value={config.lengtheningStepText}
                onChange={(e) => set({ lengtheningStepText: e.target.value })}
                placeholder="Keep model default"
                disabled={disabled}
                data-testid="input-matrix-lengthening"
              />
              <p className="text-xs text-muted-foreground">Applied to every variant; 0 disables lengthening.</p>
            </div>
          </div>
          {build.errors.length > 0 && !blocker && (
            <ul className="text-sm text-destructive space-y-1" data-testid="list-matrix-errors">
              {build.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {build.errors.length === 0 && !blocker && (
            <div className="flex flex-wrap gap-1.5" data-testid="list-matrix-variants">
              {build.variants.map(v => (
                <Badge key={v.label} variant="secondary" className="font-mono text-xs">{v.label}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
