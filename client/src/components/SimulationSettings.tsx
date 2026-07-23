import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";

interface SimulationSettingsProps {
  reportStep: number;
  routingMethod: string;
  parallelProcessing: boolean;
  stopOnError: boolean;
  outputFormat: string;
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
  onOutputFormatChange: (value: string) => void;
  onTimeoutMinutesChange: (value: number) => void;
  disabled?: boolean;
}

export default function SimulationSettings({
  reportStep,
  routingMethod,
  parallelProcessing,
  stopOnError,
  outputFormat,
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
  onOutputFormatChange,
  onTimeoutMinutesChange,
  disabled = false,
}: SimulationSettingsProps) {
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
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => onStartDateChange(e.target.value)}
                  disabled={disabled}
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => onEndDateChange(e.target.value)}
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
            <div className="flex items-center space-x-2">
              <Checkbox
                id="parallel-processing"
                checked={parallelProcessing}
                onCheckedChange={(checked) => onParallelProcessingChange(checked === true)}
                disabled={disabled}
                data-testid="checkbox-parallel-processing"
              />
              <Label htmlFor="parallel-processing" className="text-sm font-normal cursor-pointer">
                Process files in parallel
              </Label>
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

          <div className="space-y-2">
            <Label>Output Format</Label>
            <RadioGroup
              value={outputFormat}
              onValueChange={onOutputFormatChange}
              disabled={disabled}
              className="flex gap-6"
              data-testid="radio-output-format"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="output-all" data-testid="radio-output-all" />
                <Label htmlFor="output-all" className="text-sm font-normal cursor-pointer">
                  All files
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="zip" id="output-zip" data-testid="radio-output-zip" />
                <Label htmlFor="output-zip" className="text-sm font-normal cursor-pointer">
                  ZIP archive
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
