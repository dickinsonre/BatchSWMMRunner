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
import type { Swmm6Options } from "@shared/inpOptions";

interface SimulationSettingsProps {
  reportStep: number;
  routingMethod: string;
  parallelProcessing: boolean;
  /** Parallel runs are only available for in-browser (WASM) engines. */
  parallelSupported: boolean;
  stopOnError: boolean;
  timeoutMinutes: number;
  startDate: string;
  endDate: string;
  routingStepSeconds: number | null;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRoutingStepSecondsChange: (value: number | null) => void;
  onReportStepChange: (value: number) => void;
  onRoutingMethodChange: (value: string) => void;
  onParallelProcessingChange: (value: boolean) => void;
  onStopOnErrorChange: (value: boolean) => void;
  onTimeoutMinutesChange: (value: number) => void;
  swmm6Options: Swmm6Options;
  onSwmm6OptionsChange: (value: Swmm6Options) => void;
  disabled?: boolean;
}

export default function SimulationSettings({
  reportStep,
  routingMethod,
  parallelProcessing,
  parallelSupported,
  stopOnError,
  timeoutMinutes,
  startDate,
  endDate,
  routingStepSeconds,
  onStartDateChange,
  onEndDateChange,
  onRoutingStepSecondsChange,
  onReportStepChange,
  onRoutingMethodChange,
  onParallelProcessingChange,
  onStopOnErrorChange,
  onTimeoutMinutesChange,
  swmm6Options,
  onSwmm6OptionsChange,
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
            <div className="flex items-center space-x-2">
              <Checkbox
                id="swmm6-enabled"
                checked={!!s6.enabled}
                onCheckedChange={(checked) => setS6({ enabled: checked === true })}
                disabled={disabled}
                data-testid="checkbox-swmm6-enabled"
              />
              <Label htmlFor="swmm6-enabled" className="text-sm font-medium cursor-pointer">
                SWMM6 Options — write new solver keywords into the .inp
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Adds SWMM6-only [OPTIONS] lines to every file in the batch. Applied only when running the
              in-browser SWMM6 engine — the SWMM 5.x engines reject these keywords (ERROR 205), so they
              are left out of SWMM5 runs automatically.
            </p>
            {s6.enabled && (
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
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="timeout-minutes">Per-file timeout (minutes)</Label>
              <Input
                id="timeout-minutes"
                type="number"
                min={1}
                max={60}
                value={timeoutMinutes}
                onChange={(e) => onTimeoutMinutesChange(Number(e.target.value))}
                disabled={disabled}
                data-testid="input-timeout-minutes"
              />
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
