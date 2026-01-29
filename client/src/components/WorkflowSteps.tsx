import { Upload, Settings, CheckCircle } from "lucide-react";

type Step = 'upload' | 'process' | 'results';

interface WorkflowStepsProps {
  currentStep: Step;
}

export default function WorkflowSteps({ currentStep }: WorkflowStepsProps) {
  const steps = [
    { id: 'upload' as Step, label: 'Upload', icon: Upload, description: 'Select .inp files' },
    { id: 'process' as Step, label: 'Process', icon: Settings, description: 'Run SWMM simulations' },
    { id: 'results' as Step, label: 'Results', icon: CheckCircle, description: 'View outputs' },
  ];

  const getStepStatus = (stepId: Step) => {
    const order = ['upload', 'process', 'results'];
    const currentIndex = order.indexOf(currentStep);
    const stepIndex = order.indexOf(stepId);
    
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className="flex items-center justify-center gap-2 md:gap-4" data-testid="workflow-steps">
      {steps.map((step, index) => {
        const status = getStepStatus(step.id);
        const Icon = step.icon;
        
        return (
          <div key={step.id} className="flex items-center gap-2 md:gap-4">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`rounded-full p-3 transition-colors ${
                  status === 'completed' 
                    ? 'bg-green-600 text-white' 
                    : status === 'current' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted text-muted-foreground'
                }`}
                data-testid={`step-icon-${step.id}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-center">
                <p 
                  className={`text-sm font-medium ${
                    status === 'current' ? 'text-primary' : 
                    status === 'completed' ? 'text-green-600' : 'text-muted-foreground'
                  }`}
                  data-testid={`step-label-${step.id}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground hidden md:block" data-testid={`step-description-${step.id}`}>
                  {step.description}
                </p>
              </div>
            </div>
            
            {index < steps.length - 1 && (
              <div 
                className={`h-0.5 w-8 md:w-16 ${
                  getStepStatus(steps[index + 1].id) !== 'upcoming' 
                    ? 'bg-primary' 
                    : 'bg-muted'
                }`}
                data-testid={`step-connector-${index}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
