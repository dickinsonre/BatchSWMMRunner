import { useMemo, useState } from "react";
import { FileText, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileItem {
  id: string;
  name: string;
  path: string;
  size?: number;
}

interface FileListPanelProps {
  files: FileItem[];
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function FileListPanel({ files, onRemoveFile, onClearAll }: FileListPanelProps) {
  const [search, setSearch] = useState("");

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [files, search]);

  const totalSize = useMemo(() => files.reduce((acc, f) => acc + (f.size || 0), 0), [files]);

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
        <div className="flex items-baseline gap-2 flex-wrap">
          <CardTitle className="text-lg" data-testid="text-file-list-title">
            Selected Files ({files.length})
          </CardTitle>
          {totalSize > 0 && (
            <span className="text-xs text-muted-foreground" data-testid="text-total-size">
              {formatFileSize(totalSize)} total
            </span>
          )}
        </div>
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
        {files.length > 5 && (
          <div className="relative mb-3">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files by name..."
              className="pl-9"
              data-testid="input-file-search"
            />
          </div>
        )}
        {search.trim() !== '' && (
          <p className="text-xs text-muted-foreground mb-2" data-testid="text-filter-count">
            Showing {filteredFiles.length} of {files.length} files
          </p>
        )}
        <ScrollArea className="max-h-96">
          <div className="space-y-2">
            {filteredFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-matches">
                No files match "{search}".
              </p>
            ) : filteredFiles.map((file) => (
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
                {file.size !== undefined && (
                  <span className="text-xs text-muted-foreground font-mono flex-shrink-0" data-testid={`text-filesize-${file.id}`}>
                    {formatFileSize(file.size)}
                  </span>
                )}
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
