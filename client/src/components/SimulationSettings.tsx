import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  onReportStepChange: (value: number) => void;
  onRoutingMethodChange: (value: string) => void;
  disabled?: boolean;
}

export default function SimulationSettings({
  reportStep,
  routingMethod,
  onReportStepChange,
  onRoutingMethodChange,
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
      </CardContent>
    </Card>
  );
}
