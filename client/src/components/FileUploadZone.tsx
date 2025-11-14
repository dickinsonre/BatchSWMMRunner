import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface FileUploadZoneProps {
  onFilesSelected: (files: FileList) => void;
  selectedCount: number;
}

export default function FileUploadZone({ onFilesSelected, selectedCount }: FileUploadZoneProps) {
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
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
            Drag and drop .inp files here, or click to browse
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="default"
            onClick={() => document.getElementById('file-input')?.click()}
            data-testid="button-browse-files"
          >
            Browse Files
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
        </div>
        {selectedCount > 0 && (
          <p className="text-sm font-medium text-primary" data-testid="text-selected-count">
            {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>
    </Card>
  );
}
