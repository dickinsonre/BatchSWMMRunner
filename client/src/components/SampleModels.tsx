import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SampleFile {
  name: string;
  size: number;
  title: string;
}

interface SampleModelsProps {
  onSamplesLoaded: (files: File[]) => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SampleModels({ onSamplesLoaded, disabled }: SampleModelsProps) {
  const [selectedName, setSelectedName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const { data: samples = [], isLoading } = useQuery<SampleFile[]>({
    queryKey: ['/api/samples'],
  });

  const handleLoad = async () => {
    if (!selectedName) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/samples/${selectedName}`);
      if (!response.ok) throw new Error('Failed to fetch sample');
      const blob = await response.blob();
      const file = new File([blob], selectedName, { type: 'application/octet-stream' });
      onSamplesLoaded([file]);
    } catch (error) {
      console.error('Failed to load sample model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadAll = async () => {
    setLoading(true);
    try {
      const files: File[] = [];
      for (const sample of samples) {
        const response = await fetch(`/api/samples/${sample.name}`);
        if (!response.ok) continue;
        const blob = await response.blob();
        files.push(new File([blob], sample.name, { type: 'application/octet-stream' }));
      }
      onSamplesLoaded(files);
    } catch (error) {
      console.error('Failed to load sample models:', error);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) return null;
  if (samples.length === 0) return null;

  const selectedSample = samples.find(s => s.name === selectedName);

  return (
    <Card data-testid="card-sample-models">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium" data-testid="text-sample-models-title">Sample Models</span>
          <Badge variant="secondary">{samples.length}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={selectedName}
            onValueChange={setSelectedName}
            disabled={disabled || loading}
          >
            <SelectTrigger className="flex-1 min-w-[200px]" data-testid="select-sample-model">
              <SelectValue placeholder="Select a sample model..." />
            </SelectTrigger>
            <SelectContent>
              {samples.map(sample => (
                <SelectItem key={sample.name} value={sample.name} data-testid={`option-sample-${sample.name}`}>
                  <span className="font-mono text-xs">{sample.name}</span>
                  <span className="text-muted-foreground text-xs ml-2">({formatFileSize(sample.size)})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={disabled || !selectedName || loading}
            data-testid="button-load-sample"
          >
            <Download className="h-3 w-3 mr-1" />
            {loading ? "Loading..." : "Load"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadAll}
            disabled={disabled || loading}
            data-testid="button-load-samples"
          >
            Load All
          </Button>
        </div>
        {selectedSample && (
          <p className="text-xs text-muted-foreground" data-testid="text-sample-description">
            {selectedSample.title}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
