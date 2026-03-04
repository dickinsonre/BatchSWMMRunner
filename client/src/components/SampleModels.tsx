import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, FolderOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const { data: samples = [], isLoading } = useQuery<SampleFile[]>({
    queryKey: ['/api/samples'],
  });

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === samples.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(samples.map(s => s.name)));
    }
  };

  const handleLoad = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      const files: File[] = [];
      for (const name of selected) {
        const response = await fetch(`/api/samples/${name}`);
        if (!response.ok) continue;
        const blob = await response.blob();
        const file = new File([blob], name, { type: 'application/octet-stream' });
        files.push(file);
      }
      onSamplesLoaded(files);
      setSelected(new Set());
    } catch (error) {
      console.error('Failed to load sample models:', error);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) return null;
  if (samples.length === 0) return null;

  return (
    <Card data-testid="card-sample-models">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid="text-sample-models-title">Sample Models</span>
            <Badge variant="secondary">{samples.length}</Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAll}
              disabled={disabled}
              data-testid="button-select-all-samples"
            >
              {selected.size === samples.length ? "Deselect All" : "Select All"}
            </Button>
            <Button
              size="sm"
              onClick={handleLoad}
              disabled={disabled || selected.size === 0 || loading}
              data-testid="button-load-samples"
            >
              <Download className="h-3 w-3 mr-1" />
              {loading ? "Loading..." : `Load ${selected.size > 0 ? selected.size : ""} Selected`}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {samples.map(sample => {
            const isSelected = selected.has(sample.name);
            return (
              <button
                key={sample.name}
                onClick={() => !disabled && toggleSelect(sample.name)}
                disabled={disabled}
                className={`flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors hover-elevate ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'border border-transparent'
                }`}
                data-testid={`button-sample-${sample.name}`}
              >
                <div className={`flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center ${
                  isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'
                }`}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate" data-testid={`text-sample-name-${sample.name}`}>{sample.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{sample.title} ({formatFileSize(sample.size)})</div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
