import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";
import { DEFAULT_FV_MIN_CELLS, type Swmm6Options } from "@shared/inpOptions";

interface SimulationSettingsProps {
  reportStep: number;
  routingMethod: string;
  parallelProcessing: boolean;
  /** Parallel runs are only available for in-browser (WASM) engines. */
  parallelSupported: boolean;
  stopOnError: boolean;
  timeoutMinutes: number;
  /** Per-file timeout used when FV routing is active (SWMM6 engines only). */
  fvTimeoutMinutes: number;
  /** Whether the selected engine can run FV routing (wasm6 / wasm6dev). */
  fvCapable: boolean;
  startDate: string;
  endDate: string;
  routingStepSeconds: number | null;
  timeStepMode: 'default' | 'fixed' | 'variable';
  variableStepFactor: number;
  lengtheningStepSeconds: number | null;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRoutingStepSecondsChange: (value: number | null) => void;
  onTimeStepModeChange: (value: 'default' | 'fixed' | 'variable') => void;
  onVariableStepFactorChange: (value: number) => void;
  onLengtheningStepSecondsChange: (value: number | null) => void;
  onReportStepChange: (value: number) => void;
  onRoutingMethodChange: (value: string) => void;
  onParallelProcessingChange: (value: boolean) => void;
  onStopOnErrorChange: (value: boolean) => void;
  onTimeoutMinutesChange: (value: number) => void;
  onFvTimeoutMinutesChange: (value: number) => void;
  swmm6Options: Swmm6Options;
  onSwmm6OptionsChange: (value: Swmm6Options) => void;
  swmm6StableSelected: boolean;
  swmm6DevSelected: boolean;
  disabled?: boolean;
}

export default function SimulationSettings({
  reportStep,
  routingMethod,
  parallelProcessing,
  parallelSupported,
  stopOnError,
  timeoutMinutes,
  fvTimeoutMinutes,
  fvCapable,
  startDate,
  endDate,
  routingStepSeconds,
  timeStepMode,
  variableStepFactor,
  lengtheningStepSeconds,
  onStartDateChange,
  onEndDateChange,
  onRoutingStepSecondsChange,
  onTimeStepModeChange,
  onVariableStepFactorChange,
  onLengtheningStepSecondsChange,
  onReportStepChange,
  onRoutingMethodChange,
  onParallelProcessingChange,
  onStopOnErrorChange,
  onTimeoutMinutesChange,
  onFvTimeoutMinutesChange,
  swmm6Options,
  onSwmm6OptionsChange,
  swmm6StableSelected,
  swmm6DevSelected,
  disabled = false,
}: SimulationSettingsProps) {
  const s6 = swmm6Options;
  const setS6 = (patch: Partial<Swmm6Options>) => onSwmm6OptionsChange({ ...s6, ...patch });
  return (
    <Card data-testid="card-simulation-settings">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Simulation Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="report-step">Report Step (minutes)</Label>
              <Input
                id="report-step"
                type="number"
                min={1}
                max={1440}
                value={reportStep}
                onChange={(e) => onReportStepChange(Number(e.target.value))}
                disabled={disabled}
                data-testid="input-report-step"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="routing-method">Routing Method</Label>
              <Select
                value={routingMethod}
                onValueChange={onRoutingMethodChange}
                disabled={disabled}
              >
                <SelectTrigger id="routing-method" data-testid="select-routing-method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="steady" data-testid="option-steady">Steady Flow</SelectItem>
                  <SelectItem value="kinematic" data-testid="option-kinematic">Kinematic Wave</SelectItem>
                  <SelectItem value="dynamic" data-testid="option-dynamic">Dynamic Wave</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Batch Overrides (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Leave blank to keep each file's own values. Filled-in values are applied to every file in the batch.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <DatePicker
                  id="start-date"
                  value={startDate}
                  onChange={onStartDateChange}
                  placeholder="From file"
                  disabled={disabled}
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <DatePicker
                  id="end-date"
                  value={endDate}
                  onChange={onEndDateChange}
                  placeholder="From file"
                  disabled={disabled}
                  data-testid="input-end-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="routing-step">Routing Step (seconds)</Label>
                <Input
                  id="routing-step"
                  type="number"
                  min={1}
                  max={3600}
                  placeholder="From file"
                  value={routingStepSeconds ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    onRoutingStepSecondsChange(v === '' ? null : Number(v));
                  }}
                  disabled={disabled}
                  data-testid="input-routing-step"
                />
              </div>
            </div>
          </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Dynamic-wave time-step controls</Label>
              <p className="text-xs text-muted-foreground">
                These values are written to each exported INP file. They apply when a model uses Dynamic Wave routing.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="time-step-mode">Time-step mode</Label>
                  <Select
                    value={timeStepMode}
                    onValueChange={(value) => onTimeStepModeChange(value as 'default' | 'fixed' | 'variable')}
                    disabled={disabled}
                  >
                    <SelectTrigger id="time-step-mode" data-testid="select-time-step-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use each model&apos;s setting</SelectItem>
                      <SelectItem value="fixed">Fixed time step</SelectItem>
                      <SelectItem value="variable">Variable time step</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="variable-step-factor">Variable-step factor (0–2)</Label>
                  <Input
                    id="variable-step-factor"
                    type="number"
                    min={0.01}
                    max={2}
                    step={0.05}
                    value={variableStepFactor}
                    onChange={(e) => onVariableStepFactorChange(Number(e.target.value))}
                    disabled={disabled || timeStepMode !== 'variable'}
                    data-testid="input-variable-step-factor"
                  />
                  <p className="text-xs text-muted-foreground">
                    {timeStepMode === 'fixed'
                      ? 'Writes VARIABLE_STEP 0.'
                      : timeStepMode === 'variable'
                        ? 'Writes VARIABLE_STEP with this CFL safety factor.'
                        : 'Select Variable time step to override this value.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lengthening-step">Conduit lengthening step (seconds)</Label>
                  <Input
                    id="lengthening-step"
                    type="number"
                    min={0}
                    max={3600}
                    step={0.1}
                    placeholder="From file (0 disables)"
                    value={lengtheningStepSeconds ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      onLengtheningStepSecondsChange(value === '' ? null : Number(value));
                    }}
                    disabled={disabled}
                    data-testid="input-lengthening-step"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to preserve each model&apos;s value; enter 0 to disable lengthening.
                  </p>
                </div>
              </div>
            </div>

          <div className="space-y-4">
            {!swmm6StableSelected && !swmm6DevSelected && (
              <p className="text-xs text-muted-foreground rounded-md border p-3">
                Select SWMM6 Stable or SWMM6 Dev above to configure engine-specific solver options.
              </p>
            )}
            {swmm6StableSelected && (
            <div className="space-y-2 rounded-md border p-3" data-testid="section-swmm6-stable-options">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="swmm6-enabled"
                checked={!!s6.enabled}
                onCheckedChange={(checked) => setS6({ enabled: checked === true })}
                disabled={disabled || !swmm6StableSelected}
                data-testid="checkbox-swmm6-enabled"
              />
              <Label htmlFor="swmm6-enabled" className="text-sm font-medium cursor-pointer">
                Use advanced options in SWMM6 Stable
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Pick any combination of Dynamic Preissmann Slot, semi-implicit continuity, Anderson
              acceleration, and virtual junctions. These choices are sent only to SWMM6 Stable.
            </p>
            {s6.enabled && swmm6StableSelected && (
              <div className="space-y-4 pl-6 pt-1">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="swmm6-dynamic-slot"
                      checked={!!s6.dynamicSlot}
                      onCheckedChange={(checked) => setS6({ dynamicSlot: checked === true })}
                      disabled={disabled}
                      data-testid="checkbox-swmm6-dynamic-slot"
                    />
                    <Label htmlFor="swmm6-dynamic-slot" className="text-sm font-normal cursor-pointer">
                      Dynamic Preissmann Slot (SURCHARGE_METHOD DYNAMIC_SLOT)
                    </Label>
                  </div>
                  {s6.dynamicSlot && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pl-6">
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-dps-celerity" className="text-xs">Celerity (m/s)</Label>
                        <Input
                          id="swmm6-dps-celerity"
                          type="number"
                          min={1}
                          placeholder="25 (default)"
                          value={s6.dpsCelerity ?? ''}
                          onChange={(e) => setS6({ dpsCelerity: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-dps-celerity"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-dps-alpha" className="text-xs">Alpha (≥ 2)</Label>
                        <Input
                          id="swmm6-dps-alpha"
                          type="number"
                          min={2}
                          step="0.1"
                          placeholder="3 (default)"
                          value={s6.dpsAlpha ?? ''}
                          onChange={(e) => setS6({ dpsAlpha: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-dps-alpha"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-dps-decay" className="text-xs">Decay time (s)</Label>
                        <Input
                          id="swmm6-dps-decay"
                          type="number"
                          min={0.1}
                          step="0.1"
                          placeholder="0.5 (default)"
                          value={s6.dpsDecayTime ?? ''}
                          onChange={(e) => setS6({ dpsDecayTime: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-dps-decay"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="swmm6-semi-implicit"
                    checked={!!s6.semiImplicit}
                    onCheckedChange={(checked) => setS6({ semiImplicit: checked === true })}
                    disabled={disabled}
                    data-testid="checkbox-swmm6-semi-implicit"
                  />
                  <Label htmlFor="swmm6-semi-implicit" className="text-sm font-normal cursor-pointer">
                    Semi-implicit node continuity (NODE_CONTINUITY SEMI_IMPLICIT)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="swmm6-anderson"
                    checked={!!s6.andersonAccel}
                    onCheckedChange={(checked) => setS6({ andersonAccel: checked === true })}
                    disabled={disabled}
                    data-testid="checkbox-swmm6-anderson"
                  />
                  <Label htmlFor="swmm6-anderson" className="text-sm font-normal cursor-pointer">
                    Anderson acceleration (ANDERSON_ACCEL YES)
                  </Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="swmm6-virtual-junctions"
                      checked={!!s6.virtualJunctions}
                      onCheckedChange={(checked) => setS6({ virtualJunctions: checked === true })}
                      disabled={disabled}
                      data-testid="checkbox-swmm6-virtual-junctions"
                    />
                    <Label htmlFor="swmm6-virtual-junctions" className="text-sm font-normal cursor-pointer">
                      Virtual junctions (move eligible pipe-break junctions to [VIRTUAL_JUNCTIONS])
                    </Label>
                  </div>
                  {s6.virtualJunctions && (
                    <div className="pl-6 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Junctions with exactly 2 attached conduits and no inflows/DWF become zero-storage
                        virtual junctions that transmit momentum. Files run on SWMM 5.x engines are
                        automatically converted back to plain [JUNCTIONS].
                      </p>
                      <div className="max-w-xs space-y-1">
                        <Label htmlFor="swmm6-vj-momentum" className="text-xs">VIRTUAL_JUNCTION_MOMENTUM</Label>
                        <Select
                          value={s6.vjMomentum ?? 'FULL'}
                          onValueChange={(v) => setS6({ vjMomentum: v as 'BASIC' | 'FULL' })}
                          disabled={disabled}
                        >
                          <SelectTrigger id="swmm6-vj-momentum" data-testid="select-swmm6-vj-momentum">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FULL">FULL — adds cross-junction convective flux</SelectItem>
                            <SelectItem value="BASIC">BASIC — engine default momentum handling</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
            )}

            {swmm6DevSelected && (
              <div className="space-y-2 rounded-md border p-3" data-testid="section-swmm6-dev-options">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="swmm6-fv-routing"
                    checked={!!s6.fvRouting}
                    onCheckedChange={(checked) => setS6({ fvRouting: checked === true })}
                    disabled={disabled || !swmm6DevSelected}
                    data-testid="checkbox-swmm6-fv-routing"
                  />
                  <Label htmlFor="swmm6-fv-routing" className="text-sm font-medium cursor-pointer">
                    Use finite-volume routing in SWMM6 Dev (FLOW_ROUTING FV)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Turn this off to use the normal routing method selected above. FV settings are
                  sent only to SWMM6 Dev and never to SWMM6 Stable.
                </p>
                {s6.fvRouting && (
                  <div className="pl-6 space-y-2">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      The FV solver is significantly slower than Dynamic Wave — a 24 h run on a
                      500-element model takes ~5–6 minutes in the browser. Increase the per-file
                      timeout below for large models or long simulation windows.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-order" className="text-xs">FV_ORDER</Label>
                        <Select
                          value={s6.fvOrder !== undefined ? String(s6.fvOrder) : 'default'}
                          onValueChange={(v) => setS6({ fvOrder: v === 'default' ? undefined : Number(v) })}
                          disabled={disabled}
                        >
                          <SelectTrigger id="swmm6-fv-order" data-testid="select-swmm6-fv-order">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Engine default (1)</SelectItem>
                            <SelectItem value="1">1 — first order</SelectItem>
                            <SelectItem value="2">2 — second order (η, v reconstruction)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-limiter" className="text-xs">FV_LIMITER</Label>
                        <Input
                          id="swmm6-fv-limiter"
                          placeholder="MINMOD (default)"
                          value={s6.fvLimiter ?? ''}
                          onChange={(e) => setS6({ fvLimiter: e.target.value === '' ? undefined : e.target.value })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-limiter"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-time" className="text-xs">FV_TIME_INTEGRATION</Label>
                        <Input
                          id="swmm6-fv-time"
                          placeholder="EULER (default)"
                          value={s6.fvTimeIntegration ?? ''}
                          onChange={(e) => setS6({ fvTimeIntegration: e.target.value === '' ? undefined : e.target.value })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-time"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-riemann" className="text-xs">FV_RIEMANN</Label>
                        <Input
                          id="swmm6-fv-riemann"
                          placeholder="HLLC (default)"
                          value={s6.fvRiemann ?? ''}
                          onChange={(e) => setS6({ fvRiemann: e.target.value === '' ? undefined : e.target.value })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-riemann"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-cell-length" className="text-xs">FV_CELL_LENGTH (ft or m)</Label>
                        <Input
                          id="swmm6-fv-cell-length"
                          type="number"
                          min={0.1}
                          step="0.1"
                          placeholder="100 (safe default)"
                          value={s6.fvCellLength ?? ''}
                          onChange={(e) => setS6({ fvCellLength: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-cell-length"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-min-cells" className="text-xs">
                          Subgrid discretization (FV_MIN_CELLS)
                        </Label>
                        <Input
                          id="swmm6-fv-min-cells"
                          type="number"
                          min={1}
                          step="1"
                          placeholder={`${DEFAULT_FV_MIN_CELLS} (recommended)`}
                          value={s6.fvMinCells ?? DEFAULT_FV_MIN_CELLS}
                          onChange={(e) => setS6({ fvMinCells: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-min-cells"
                        />
                        <p className="text-xs text-muted-foreground">
                          Minimum cells per conduit. 2 is the recommended baseline for many models and reduces FV cost.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="swmm6-fv-cfl" className="text-xs">FV_CFL (0–1]</Label>
                        <Input
                          id="swmm6-fv-cfl"
                          type="number"
                          min={0.01}
                          max={1}
                          step="0.05"
                          placeholder="Engine default"
                          value={s6.fvCfl ?? ''}
                          onChange={(e) => setS6({ fvCfl: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          data-testid="input-swmm6-fv-cfl"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Per-file timeout</Label>
            {fvCapable && (
              <p className="text-xs text-muted-foreground">
                Effective limits: <span className="font-medium">{timeoutMinutes} min</span> for DW/KW runs
                {' · '}
                <span className="font-medium">{fvTimeoutMinutes} min</span> for FV runs
                {' '}(applied automatically when FLOW_ROUTING FV is active).
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="space-y-2">
                <Label htmlFor="timeout-minutes">{fvCapable ? 'DW / KW runs (minutes)' : 'Timeout (minutes)'}</Label>
                <Input
                  id="timeout-minutes"
                  type="number"
                  min={1}
                  max={120}
                  value={timeoutMinutes}
                  onChange={(e) => onTimeoutMinutesChange(Number(e.target.value))}
                  disabled={disabled}
                  data-testid="input-timeout-minutes"
                />
              </div>
              {fvCapable && (
                <div className="space-y-2">
                  <Label htmlFor="fv-timeout-minutes">FV runs (minutes)</Label>
                  <Input
                    id="fv-timeout-minutes"
                    type="number"
                    min={1}
                    max={480}
                    value={fvTimeoutMinutes}
                    onChange={(e) => onFvTimeoutMinutesChange(Number(e.target.value))}
                    disabled={disabled}
                    data-testid="input-fv-timeout-minutes"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="parallel-processing"
                  checked={parallelSupported && parallelProcessing}
                  onCheckedChange={(checked) => onParallelProcessingChange(checked === true)}
                  disabled={disabled || !parallelSupported}
                  data-testid="checkbox-parallel-processing"
                />
                <Label htmlFor="parallel-processing" className="text-sm font-normal cursor-pointer">
                  Process files in parallel
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6" data-testid="text-parallel-hint">
                {parallelSupported
                  ? 'Runs several files at once in browser workers (up to 4, based on your device).'
                  : 'Available for the in-browser (WASM) engines only — server engines run files one at a time.'}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="stop-on-error"
                checked={stopOnError}
                onCheckedChange={(checked) => onStopOnErrorChange(checked === true)}
                disabled={disabled}
                data-testid="checkbox-stop-on-error"
              />
              <Label htmlFor="stop-on-error" className="text-sm font-normal cursor-pointer">
                Stop if any file fails
              </Label>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
