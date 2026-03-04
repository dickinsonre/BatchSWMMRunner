import { Upload, FileCheck, AlertCircle, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FileUploadZoneProps {
  onFilesSelected: (files: FileList) => void;
  selectedCount: number;
  totalSize?: number;
  invalidFiles?: string[];
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function FileUploadZone({ onFilesSelected, selectedCount, totalSize = 0, invalidFiles = [] }: FileUploadZoneProps) {
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
  };

  const handleDirectoryInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <Card
      className="border-2 border-dashed p-8 hover-elevate"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      data-testid="card-upload-zone"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Upload className="h-8 w-8 text-primary" data-testid="icon-upload" />
        </div>
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-upload-title">
            Upload SWMM5 Input Files
          </h3>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-upload-description">
            Drag and drop .inp files here, browse files, or load an entire directory
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="default"
            onClick={() => document.getElementById('file-input')?.click()}
            data-testid="button-browse-files"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            Browse Files
          </Button>
          <Button
            variant="outline"
            onClick={() => document.getElementById('directory-input')?.click()}
            data-testid="button-load-directory"
          >
            <FolderOpen className="h-4 w-4 mr-1.5" />
            Load Directory
          </Button>
          <input
            id="file-input"
            type="file"
            multiple
            accept=".inp"
            onChange={handleFileInput}
            className="hidden"
            data-testid="input-file"
          />
          <input
            id="directory-input"
            type="file"
            onChange={handleDirectoryInput}
            className="hidden"
            data-testid="input-directory"
            {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        </div>
        {selectedCount > 0 && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-primary" data-testid="text-selected-count">
                {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
              </p>
              {totalSize > 0 && (
                <Badge variant="secondary" data-testid="badge-total-size">
                  {formatFileSize(totalSize)}
                </Badge>
              )}
            </div>
            {invalidFiles.length > 0 && (
              <div className="flex items-center gap-2 text-destructive bg-destructive/10 px-3 py-2 rounded-md" data-testid="warning-invalid-files">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <div className="text-sm">
                  <span className="font-medium">{invalidFiles.length} file{invalidFiles.length !== 1 ? 's' : ''} skipped</span>
                  <span className="text-muted-foreground"> (only .inp files accepted)</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
