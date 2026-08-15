"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  Folder,
  FolderOpen,
  ImageIcon,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, deleteFile, getFilePreviewUrl } from "@/lib/api-client";
import { buildFileTree, type TreeFolder, type TreeNode } from "@/lib/file-tree";
import { manifestKeyFor } from "@/lib/run-paths";
import { formatDate } from "@/lib/utils";
import type { FileEntry } from "@genblaze-gmicloud-pipeline/shared";

import { FilePreview } from "./file-preview";

interface FileBrowserProps {
  files: FileEntry[];
  loading: boolean;
  onRefresh: () => void;
}

function FileTypeIcon({
  contentType,
  className,
}: {
  contentType: string;
  className?: string;
}) {
  if (contentType.startsWith("image/")) return <ImageIcon className={className} />;
  if (contentType === "application/pdf") return <FileTextIcon className={className} />;
  if (contentType.startsWith("video/")) return <FileVideoIcon className={className} />;
  if (contentType.startsWith("audio/")) return <FileAudioIcon className={className} />;
  if (contentType === "application/zip") return <FileArchiveIcon className={className} />;
  return <FileIcon className={className} />;
}

function countFiles(node: TreeFolder): number {
  let count = 0;
  for (const child of node.children) {
    if (child.type === "file") count++;
    else count += countFiles(child);
  }
  return count;
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onPreview: (file: FileEntry) => void;
  onDownload: (file: FileEntry) => void;
  onDelete: (file: FileEntry) => void;
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onPreview,
  onDownload,
  onDelete,
}: TreeRowProps) {
  if (node.type === "folder") {
    const isOpen = expanded.has(node.path);
    const fileCount = countFiles(node);
    return (
      <>
        <button
          onClick={() => onToggle(node.path)}
          className="group flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent/60"
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {isOpen ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-[var(--attention,theme(colors.amber.500))]" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-[var(--attention,theme(colors.amber.500))]" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
        </button>
        {isOpen &&
          node.children.map((child) => (
            <TreeRow
              key={child.type === "folder" ? child.path : child.data.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onPreview={onPreview}
              onDownload={onDownload}
              onDelete={onDelete}
            />
          ))}
      </>
    );
  }

  const file = node.data;

  return (
    <div
      onDoubleClick={() => onPreview(file)}
      className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors select-none hover:bg-accent/60"
      style={{ paddingLeft: `${depth * 20 + 32}px` }}
    >
      <FileTypeIcon
        contentType={file.content_type}
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-4">
        <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
          {file.size_human}
        </span>
        <span className="hidden text-xs text-muted-foreground md:inline">
          {formatDate(file.uploaded_at)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onPreview(file)}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload(file)}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(file)}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

export function FileBrowser({ files, loading, onRefresh }: FileBrowserProps) {
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(
    new Set()
  );
  const [collapsedDefaults, setCollapsedDefaults] = useState<Set<string>>(
    new Set()
  );
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

  const defaultExpanded = useMemo(() => {
    const tree = buildFileTree(files);
    return new Set(
      tree
        .filter((n): n is TreeFolder => n.type === "folder")
        .map((f) => f.path)
    );
  }, [files]);

  const expanded = useMemo(() => {
    const next = new Set(expandedOverrides);
    for (const path of defaultExpanded) {
      if (!collapsedDefaults.has(path)) next.add(path);
    }
    return next;
  }, [collapsedDefaults, defaultExpanded, expandedOverrides]);

  const toggleFolder = useCallback((path: string) => {
    if (defaultExpanded.has(path)) {
      setCollapsedDefaults((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      return;
    }

    setExpandedOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, [defaultExpanded]);

  const handleDownload = async (file: FileEntry) => {
    try {
      const { url } = await getFilePreviewUrl(file.key);
      window.open(url, "_blank");
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Failed to get download URL";
      toast.error(detail);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteFile(deleteTarget.key);
      toast.success(`${deleteTarget.filename} deleted`);
      onRefresh();
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Failed to delete file";
      toast.error(detail);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handlePreview = (file: FileEntry) => {
    setPreviewFile(file);
    setPreviewOpen(true);
  };

  // When previewing a media file, attach its run's manifest (if one exists
  // in the fetched list) so the modal renders with Media/Manifest tabs.
  const manifestForPreview: FileEntry | null = (() => {
    if (!previewFile) return null;
    if (
      !previewFile.content_type.startsWith("image/") &&
      !previewFile.content_type.startsWith("video/")
    ) {
      return null;
    }
    const key = manifestKeyFor(previewFile.key);
    if (!key) return null;
    return files.find((f) => f.key === key) ?? null;
  })();

  const tree = buildFileTree(files);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4">
          <CardTitle className="text-sm font-semibold">All files</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="h-7 text-xs"
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-3">
          {loading && files.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="This bucket is empty"
              description="Kick off a generation run to populate runs/ with image and video assets."
            />
          ) : (
            <div className="space-y-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.type === "folder" ? node.path : node.data.key}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <FilePreview
        file={previewFile}
        manifestFile={manifestForPreview}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.filename}</strong>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
