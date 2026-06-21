import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { CaretRight, Folder, MagnifyingGlass } from '@phosphor-icons/react';
import { useStorage } from '../../hooks/useStorage';
import { FileListView } from './FileListView';
import type { FileEntry } from '../../hooks/useStorage';

interface FileExplorerPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'file' | 'folder';
  /** Currently configured file or folder path, used to open the picker already browsed to that location. */
  initialPath?: string;
  onSelect: (path: string) => void;
}

export function FileExplorerPickerDialog({
  open,
  onOpenChange,
  mode,
  initialPath,
  onSelect,
}: FileExplorerPickerDialogProps) {
  const {
    files,
    currentPath,
    searchTerm,
    setSearchTerm,
    isLoading,
    navigateToFolder,
    navigateToIndex,
    navigateToRoot,
    navigateToPath,
  } = useStorage();

  useEffect(() => {
    if (!open) return;
    const segments = initialPath ? initialPath.split('/').filter(Boolean) : [];
    // For a file path, browse to its parent folder so the file itself is visible in the list.
    navigateToPath(mode === 'file' ? segments.slice(0, -1) : segments);
    // Only re-run when the dialog opens, not on every currentPath change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelectFile = (file: FileEntry) => {
    onSelect(file.path);
    onOpenChange(false);
  };

  const handleConfirmFolder = () => {
    onSelect(currentPath.join('/'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle>{mode === 'file' ? 'Select a File' : 'Select a Folder'}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1.5 text-xs font-semibold overflow-x-auto pb-1">
          <button
            onClick={navigateToRoot}
            className="text-muted-foreground hover:text-foreground hover:underline transition-colors shrink-0"
          >
            storage
          </button>
          {currentPath.map((folder, index) => (
            <div key={index} className="flex items-center gap-1.5 shrink-0">
              <CaretRight size={10} className="text-muted-foreground/50" />
              <button
                onClick={() => navigateToIndex(index)}
                className={
                  index === currentPath.length - 1
                    ? 'text-foreground font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:underline transition-colors'
                }
              >
                {folder}
              </button>
            </div>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search files and folders…"
            className="h-8 text-xs pl-8"
          />
        </div>

        <ScrollArea className="h-[340px] border border-border/80 bg-background">
          <FileListView
            files={files}
            mode={mode === 'file' ? 'pick-file' : 'pick-folder'}
            showPath={!!searchTerm.trim()}
            onNavigate={navigateToFolder}
            onSelect={handleSelectFile}
            emptyMessage={isLoading ? 'Loading…' : searchTerm ? 'No matches found.' : 'Folder is empty.'}
          />
        </ScrollArea>

        {mode === 'folder' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmFolder}>
              <Folder size={14} className="mr-1.5" />
              Use "{currentPath.length ? currentPath[currentPath.length - 1] : 'storage'}"
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
