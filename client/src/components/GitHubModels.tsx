import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Github, ChevronDown, ChevronRight, Loader2, FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface GithubModelFile {
  path: string;
  size: number;
}

interface GithubModelTree {
  repo: string;
  branch: string;
  truncated: boolean;
  files: GithubModelFile[];
  fetchedAt: string;
}

interface GitHubModelsProps {
  onModelsLoaded: (files: File[]) => void;
  disabled?: boolean;
}

// Guardrails per pull — mirror the server upload limits (100 files / 250 MB
// total) so GitHub-sourced batches behave exactly like uploaded ones.
export const MAX_GITHUB_FILES = 100;
export const MAX_GITHUB_TOTAL_BYTES = 250 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function topFolder(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '(repo root)' : path.slice(0, i);
}

export default function GitHubModels({ onModelsLoaded, disabled }: GitHubModelsProps) {
  const [expanded, setExpanded] = useState(false);
  const [folder, setFolder] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const cancelRef = useRef(false);
  const { toast } = useToast();

  const { data: tree, isLoading, error } = useQuery<GithubModelTree>({
    queryKey: ['/api/github-models/tree'],
    enabled: expanded,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const folders = useMemo(() => {
    if (!tree) return [];
    const map = new Map<string, number>();
    for (const f of tree.files) {
      const top = topFolder(f.path);
      map.set(top, (map.get(top) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tree]);

  const folderFiles = useMemo(() => {
    if (!tree || !folder) return [];
    const needle = filter.trim().toLowerCase();
    return tree.files
      .filter(f => topFolder(f.path) === folder)
      .filter(f => !needle || f.path.toLowerCase().includes(needle))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [tree, folder, filter]);

  const selectedFiles = useMemo(() => {
    if (!tree) return [];
    return tree.files.filter(f => selected.has(f.path));
  }, [tree, selected]);
  const selectedBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  const overFileCap = selectedFiles.length > MAX_GITHUB_FILES;
  const overSizeCap = selectedBytes > MAX_GITHUB_TOTAL_BYTES;

  const toggleFile = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectVisibleFolderFiles = () => {
    setSelected(prev => {
      const next = new Set(prev);
      let bytes = Array.from(next).reduce((acc, p) => {
        const f = tree?.files.find(x => x.path === p);
        return acc + (f?.size || 0);
      }, 0);
      let capped = false;
      for (const f of folderFiles) {
        if (next.has(f.path)) continue;
        if (next.size >= MAX_GITHUB_FILES || bytes + f.size > MAX_GITHUB_TOTAL_BYTES) {
          capped = true;
          break;
        }
        next.add(f.path);
        bytes += f.size;
      }
      if (capped) {
        toast({
          title: "Selection capped",
          description: `A single pull is limited to ${MAX_GITHUB_FILES} files / ${formatFileSize(MAX_GITHUB_TOTAL_BYTES)} total. Not all files in this folder were selected.`,
        });
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleLoadSelected = async () => {
    if (!tree || selectedFiles.length === 0) return;
    if (overFileCap || overSizeCap) return;
    const [owner, repo] = tree.repo.split('/');
    setDownloading(true);
    setDownloadDone(0);
    setDownloadTotal(selectedFiles.length);
    cancelRef.current = false;
    const loaded: File[] = [];
    const failed: string[] = [];
    try {
      for (const f of selectedFiles) {
        if (cancelRef.current) break;
        try {
          const url = `https://raw.githubusercontent.com/${owner}/${repo}/${tree.branch}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const name = f.path.split('/').pop() || f.path;
          loaded.push(new File([blob], name, { type: 'text/plain' }));
        } catch {
          failed.push(f.path);
        }
        setDownloadDone(d => d + 1);
      }
      if (loaded.length > 0) {
        onModelsLoaded(loaded);
        setSelected(new Set());
        toast({
          title: "Models loaded from GitHub",
          description: `${loaded.length} model${loaded.length !== 1 ? 's' : ''} added to the batch${failed.length > 0 ? ` — ${failed.length} failed to download` : ''}.`,
        });
      } else if (failed.length > 0) {
        toast({
          title: "Download failed",
          description: `Could not download any of the selected models (${failed.length} failed). GitHub may be unreachable.`,
          variant: "destructive",
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card data-testid="card-github-models">
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setExpanded(e => !e)}
          data-testid="button-toggle-github-models"
        >
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Github className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium" data-testid="text-github-models-title">Load from GitHub Model Library</span>
          {tree && <Badge variant="secondary">{tree.files.length.toLocaleString()} models</Badge>}
        </button>

        {expanded && (
          <>
            <p className="text-xs text-muted-foreground">
              Browse the public{' '}
              <a
                href="https://github.com/SWMMBobSWMM6/1729-SWMM5-Models-2030"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-0.5"
                data-testid="link-github-repo"
              >
                SWMM5 model library
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              and pull models straight into a batch (up to {MAX_GITHUB_FILES} files / {formatFileSize(MAX_GITHUB_TOTAL_BYTES)} per pull).
            </p>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-github-loading">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading model library index…
              </div>
            )}

            {error != null && (
              <p className="text-sm text-destructive" data-testid="text-github-error">
                Could not load the model library: {error instanceof Error ? error.message : 'unknown error'}
              </p>
            )}

            {tree && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={folder} onValueChange={f => { setFolder(f); setFilter(''); }} disabled={disabled || downloading}>
                    <SelectTrigger className="flex-1 min-w-[200px]" data-testid="select-github-folder" aria-label="Select a model library folder">
                      <SelectValue placeholder="Select a folder…" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map(([name, count]) => (
                        <SelectItem key={name} value={name} data-testid={`option-github-folder-${name}`}>
                          <span className="font-mono text-xs">{name}</span>
                          <span className="text-muted-foreground text-xs ml-2">({count})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {folder && (
                    <Input
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="Filter files…"
                      className="w-48"
                      disabled={disabled || downloading}
                      data-testid="input-github-filter"
                    />
                  )}
                </div>

                {folder && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={selectVisibleFolderFiles}
                        disabled={disabled || downloading || folderFiles.length === 0}
                        data-testid="button-github-select-folder"
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        Select all shown ({folderFiles.length})
                      </Button>
                      {selected.size > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearSelection} disabled={downloading} data-testid="button-github-clear-selection">
                          Clear selection
                        </Button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto border rounded-md divide-y" data-testid="list-github-files">
                      {folderFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No .inp files match.</p>
                      ) : folderFiles.map(f => (
                        <label
                          key={f.path}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                          data-testid={`row-github-file-${f.path}`}
                        >
                          <Checkbox
                            checked={selected.has(f.path)}
                            onCheckedChange={() => toggleFile(f.path)}
                            disabled={disabled || downloading}
                            aria-label={`Select ${f.path}`}
                          />
                          <span className="font-mono truncate flex-1">{f.path.slice(folder.length + 1) || f.path}</span>
                          <span className="text-muted-foreground whitespace-nowrap">{formatFileSize(f.size)}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {selected.size > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        onClick={handleLoadSelected}
                        disabled={disabled || downloading || overFileCap || overSizeCap}
                        data-testid="button-github-load-selected"
                      >
                        {downloading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Github className="h-3.5 w-3.5 mr-1.5" />}
                        {downloading ? `Downloading ${downloadDone}/${downloadTotal}…` : `Add ${selected.size} model${selected.size !== 1 ? 's' : ''} to batch`}
                      </Button>
                      {downloading && (
                        <Button variant="outline" size="sm" onClick={() => { cancelRef.current = true; }} data-testid="button-github-cancel-download">
                          Stop
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground" data-testid="text-github-selection-summary">
                        {selected.size} selected · {formatFileSize(selectedBytes)}
                      </span>
                    </div>
                    {downloading && downloadTotal > 0 && (
                      <Progress value={(downloadDone / downloadTotal) * 100} data-testid="progress-github-download" />
                    )}
                    {(overFileCap || overSizeCap) && (
                      <p className="text-xs text-destructive" data-testid="text-github-cap-warning">
                        {overFileCap
                          ? `Too many files selected — a single pull is limited to ${MAX_GITHUB_FILES} files.`
                          : `Selection too large — a single pull is limited to ${formatFileSize(MAX_GITHUB_TOTAL_BYTES)} total.`}
                      </p>
                    )}
                  </div>
                )}

                {tree.truncated && (
                  <p className="text-xs text-muted-foreground">
                    Note: GitHub truncated the file listing — some models may not appear here.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
