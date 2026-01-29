import { FileInput, Play, BarChart3, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function InstructionsPanel() {
  const steps = [
    {
      icon: FileInput,
      title: "1. Upload Files",
      description: "Drag & drop .inp files or click browse to select SWMM input files for batch processing."
    },
    {
      icon: Play,
      title: "2. Start Processing",
      description: "Click 'Start Batch Processing' to run SWMM simulations sequentially on all selected files."
    },
    {
      icon: BarChart3,
      title: "3. View Results",
      description: "Monitor real-time progress and view consolidated results with success/failure status for each file."
    }
  ];

  return (
    <Card data-testid="card-instructions">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4" />
          How to Use
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div 
                key={index} 
                className="flex gap-3"
                data-testid={`instruction-step-${index + 1}`}
              >
                <div className="rounded-lg bg-primary/10 p-2 h-fit">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium" data-testid={`instruction-title-${index + 1}`}>
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid={`instruction-desc-${index + 1}`}>
                    {step.description}
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
