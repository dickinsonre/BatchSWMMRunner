import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileItem {
  id: string;
  name: string;
  path: string;
}

interface FileListPanelProps {
  files: FileItem[];
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
}

export default function FileListPanel({ files, onRemoveFile, onClearAll }: FileListPanelProps) {
  if (files.length === 0) {
    return (
      <Card data-testid="card-file-list-empty">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground" data-testid="text-empty-state">
            No files selected. Upload .inp files to begin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-file-list">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg" data-testid="text-file-list-title">
          Selected Files ({files.length})
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onClearAll}
          data-testid="button-clear-all"
        >
          Clear All
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-96">
          <div className="space-y-2">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-md border p-3 hover-elevate"
                data-testid={`card-file-${file.id}`}
              >
                <FileText className="h-5 w-5 text-primary flex-shrink-0" data-testid={`icon-file-${file.id}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid={`text-filename-${file.id}`}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate" data-testid={`text-filepath-${file.id}`}>
                    {file.path}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveFile(file.id)}
                  data-testid={`button-remove-${file.id}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
