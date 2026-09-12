import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, AlertTriangle } from "lucide-react";
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
  knownIssue?: string;
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
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  const { data: samples = [], isLoading } = useQuery<SampleFile[]>({
    queryKey: ['/api/samples'],
  });

  const loadSample = async (name: string) => {
    if (!name) return;
    setLoading(true);
    setMessage("");
    setLoadError("");
    try {
      const response = await fetch(`/api/samples/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error('Failed to fetch sample');
      const blob = await response.blob();
      const file = new File([blob], name, { type: 'application/octet-stream' });
      onSamplesLoaded([file]);
      setMessage(`${name} added to the batch. Click Run below to start.`);
    } catch (error) {
      console.error('Failed to load sample model:', error);
      setLoadError(`Could not load ${name}. Check the connection and click Load Selected to retry.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (name: string) => {
    setSelectedName(name);
    loadSample(name);
  };

  const handleLoadAll = async () => {
    setLoading(true);
    setMessage("");
    setLoadError("");
    try {
      const files: File[] = [];
      const failed: string[] = [];
      for (const sample of samples) {
        const response = await fetch(`/api/samples/${encodeURIComponent(sample.name)}`);
        if (!response.ok) {
          failed.push(sample.name);
          continue;
        }
        const blob = await response.blob();
        files.push(new File([blob], sample.name, { type: 'application/octet-stream' }));
      }
      onSamplesLoaded(files);
      setMessage(`${files.length} sample files loaded. Click Run below to start.`);
      if (failed.length) setLoadError(`${failed.length} samples could not be loaded: ${failed.join(", ")}. Select a sample and click Load Selected to retry.`);
    } catch (error) {
      console.error('Failed to load sample models:', error);
      setLoadError("Could not finish loading samples. Check the connection and try again.");
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
            onValueChange={handleSelect}
            disabled={disabled || loading}
          >
            <SelectTrigger className="flex-1 min-w-[200px]" data-testid="select-sample-model" aria-label="Select a sample model">
              <SelectValue placeholder="Select a sample model..." />
            </SelectTrigger>
            <SelectContent>
              {samples.map(sample => (
                <SelectItem key={sample.name} value={sample.name} data-testid={`option-sample-${sample.name}`}>
                  <span className="font-mono text-xs">{sample.name}</span>
                  <span className="text-muted-foreground text-xs ml-2">({formatFileSize(sample.size)})</span>
                  {sample.knownIssue && (
                    <AlertTriangle className="inline h-3 w-3 ml-1.5 text-amber-500" aria-label="Known issue" />
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && (
            <span className="text-xs text-muted-foreground" data-testid="text-sample-loading">Loading...</span>
          )}
          <Button
            size="sm"
            onClick={() => void loadSample(selectedName)}
            disabled={disabled || loading || !selectedName}
            data-testid="button-load-selected-sample"
          >
            Load Selected
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
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        {selectedSample && (
          <p className="text-xs text-muted-foreground" data-testid="text-sample-description">
            {selectedSample.title}
          </p>
        )}
        {selectedSample?.knownIssue && (
          <div
            className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500"
            data-testid="text-sample-known-issue"
          >
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{selectedSample.knownIssue}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
