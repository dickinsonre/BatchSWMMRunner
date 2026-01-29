import { FileText, FileOutput, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ExpectedOutputs() {
  const outputs = [
    {
      icon: FileText,
      name: ".rpt files",
      description: "Detailed report files with simulation results and statistics"
    },
    {
      icon: FileOutput,
      name: ".out files", 
      description: "Binary output files with time-series data for analysis"
    },
    {
      icon: BarChart3,
      name: "Results Summary",
      description: "Overview of all processed files with success/failure status"
    }
  ];

  return (
    <Card data-testid="card-expected-outputs">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">What You'll Get</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {outputs.map((output, index) => {
            const Icon = output.icon;
            return (
              <div 
                key={index}
                className="flex gap-3"
                data-testid={`expected-output-${index + 1}`}
              >
                <div className="rounded-lg bg-muted p-2 h-fit">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium font-mono" data-testid={`output-name-${index + 1}`}>
                    {output.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid={`output-desc-${index + 1}`}>
                    {output.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
