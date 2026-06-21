import { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { UploadSimple, FolderPlus, CaretRight, Spinner, MagnifyingGlass } from '@phosphor-icons/react';
import { FileListView } from './FileListView';
import { NameInputDialog } from './NameInputDialog';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { FileEntry } from '../../hooks/useStorage';

interface StorageTabProps {
  files: FileEntry[];
  currentPath: string[];
  searchTerm: string;
  isUploading: boolean;
  onSearchChange: (term: string) => void;
  onUpload: (file: File) => Promise<boolean>;
  onCreateFolder: (name: string) => Promise<boolean>;
  onRename: (id: string, newName: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onNavigateFolder: (name: string) => void;
  onNavigateIndex: (index: number) => void;
  onNavigateRoot: () => void;
}

export function StorageTab({
  files,
  currentPath,
  searchTerm,
  isUploading,
  onSearchChange,
  onUpload,
  onCreateFolder,
  onRename,
  onDelete,
  onNavigateFolder,
  onNavigateIndex,
  onNavigateRoot,
}: StorageTabProps) {
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="py-6 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-4 gap-3">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-semibold overflow-x-auto">
          <button
            onClick={onNavigateRoot}
            className="text-muted-foreground hover:text-foreground hover:underline transition-colors shrink-0"
          >
            storage
          </button>
          {currentPath.map((folder, index) => (
            <div key={index} className="flex items-center gap-1.5 shrink-0">
              <CaretRight size={10} className="text-muted-foreground/50" />
              <button
                onClick={() => onNavigateIndex(index)}
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

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search…"
              className="h-8 text-xs pl-8 w-44"
            />
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          <Button onClick={() => setIsNewFolderOpen(true)} variant="outline" size="sm" className="h-8">
            <FolderPlus className="mr-1.5" size={14} /> New Folder
          </Button>
          <Button onClick={handleUploadClick} size="sm" className="h-8" disabled={isUploading}>
            {isUploading ? (
              <Spinner className="animate-spin mr-1.5" size={14} />
            ) : (
              <UploadSimple className="mr-1.5" size={14} />
            )}
            Upload File
          </Button>
        </div>
      </div>

      <div className="border border-border/80 flex-1 overflow-auto min-h-0 bg-background">
        <FileListView
          files={files}
          mode="browse"
          showPath={!!searchTerm.trim()}
          onNavigate={onNavigateFolder}
          onPreview={setPreviewFile}
          onRename={setRenameTarget}
          onDelete={(file) => onDelete(file.id)}
          emptyMessage={searchTerm.trim() ? 'No matches found.' : 'Folder is empty.'}
        />
      </div>

      <NameInputDialog
        open={isNewFolderOpen}
        onOpenChange={setIsNewFolderOpen}
        title="New Folder"
        description="Create a nested directory in the current storage path."
        label="Folder Name"
        confirmLabel="Create Folder"
        onConfirm={onCreateFolder}
      />

      <NameInputDialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        title="Rename"
        label="New Name"
        initialValue={renameTarget?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={(newName) => (renameTarget ? onRename(renameTarget.id, newName) : Promise.resolve(false))}
      />

      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(open) => !open && setPreviewFile(null)}
      />
    </div>
  );
}
