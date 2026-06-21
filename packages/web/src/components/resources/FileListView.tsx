import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Folder, FileText, PencilSimple, Eye, Trash } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import type { FileEntry } from '../../hooks/useStorage';

export type FileListMode = 'browse' | 'pick-file' | 'pick-folder';

interface FileListViewProps {
  files: FileEntry[];
  mode: FileListMode;
  showPath?: boolean;
  onNavigate: (folderName: string) => void;
  onSelect?: (file: FileEntry) => void;
  onRename?: (file: FileEntry) => void;
  onPreview?: (file: FileEntry) => void;
  onDelete?: (file: FileEntry) => void;
  emptyMessage?: string;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isDirectory(file: FileEntry) {
  return file.mime_type === 'inode/directory';
}

export function FileListView({
  files,
  mode,
  showPath = false,
  onNavigate,
  onSelect,
  onRename,
  onPreview,
  onDelete,
  emptyMessage = 'Folder is empty.',
}: FileListViewProps) {
  const hasActions = mode === 'browse' && !!(onRename || onPreview || onDelete);

  return (
    <Table>
      <TableHeader className="bg-muted/30 sticky top-0 z-10">
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          {hasActions && <TableHead className="w-[110px] text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const dir = isDirectory(file);
          const selectable = !dir && mode === 'pick-file';
          const rowDisabled = !dir && mode === 'pick-folder';

          return (
            <TableRow key={file.id} className={cn('group', rowDisabled && 'opacity-40')}>
              <TableCell className="font-medium text-xs">
                {dir ? (
                  <button
                    onClick={() => onNavigate(file.name)}
                    className="flex items-center gap-2 hover:underline text-left text-primary font-semibold"
                  >
                    <Folder size={16} className="text-amber-500 fill-amber-500" />
                    {file.name}
                  </button>
                ) : selectable ? (
                  <button
                    onClick={() => onSelect?.(file)}
                    className="flex items-center gap-2 hover:underline text-left text-foreground"
                  >
                    <FileText size={16} className="text-muted-foreground" />
                    {file.name}
                  </button>
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <FileText size={16} className="text-muted-foreground/60" />
                    {file.name}
                  </span>
                )}
                {showPath && (
                  <div className="text-[10px] text-muted-foreground/60 font-mono pl-6 truncate max-w-[260px]">
                    {file.path}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground/75">
                {dir ? 'folder' : file.mime_type || 'file'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground/75 font-mono">
                {dir ? '—' : formatBytes(file.size_bytes)}
              </TableCell>
              {hasActions && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onPreview && !dir && (
                      <Button variant="outline" size="icon-sm" onClick={() => onPreview(file)} title="Preview">
                        <Eye size={14} />
                      </Button>
                    )}
                    {onRename && (
                      <Button variant="outline" size="icon-sm" onClick={() => onRename(file)} title="Rename">
                        <PencilSimple size={14} />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => onDelete(file)}
                        title="Delete"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 border-transparent hover:border-destructive/20"
                      >
                        <Trash size={14} />
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
        {files.length === 0 && (
          <TableRow>
            <TableCell colSpan={hasActions ? 4 : 3} className="text-center py-12 text-xs text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
