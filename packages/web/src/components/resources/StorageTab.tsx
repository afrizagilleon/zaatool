import { useState, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Trash, Folder, UploadSimple, FolderPlus, CaretRight, Spinner } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

interface FileEntry {
  id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface StorageTabProps {
  files: FileEntry[];
  currentPath: string[];
  isUploading: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onCreateFolder: (name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onNavigateFolder: (name: string) => void;
  onNavigateIndex: (index: number) => void;
  onNavigateRoot: () => void;
}

export function StorageTab({
  files,
  currentPath,
  isUploading,
  onUpload,
  onCreateFolder,
  onDelete,
  onNavigateFolder,
  onNavigateIndex,
  onNavigateRoot,
}: StorageTabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFolder = async () => {
    const success = await onCreateFolder(folderName);
    if (success) {
      setIsOpen(false);
      setFolderName('');
    }
  };

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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="py-6 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-4">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <button
            onClick={onNavigateRoot}
            className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
          >
            storage
          </button>
          {currentPath.map((folder, index) => (
            <div key={index} className="flex items-center gap-1.5">
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

        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <Button onClick={() => setIsOpen(true)} variant="outline" size="sm" className="h-8">
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
        <Table>
          <TableHeader className="bg-muted/30 sticky top-0 z-10">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="font-medium text-xs">
                  {file.mime_type === 'inode/directory' ? (
                    <button
                      onClick={() => onNavigateFolder(file.name)}
                      className="flex items-center gap-2 hover:underline text-left text-primary font-semibold"
                    >
                      <Folder size={16} className="text-amber-500 fill-amber-500" />
                      {file.name}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {file.name}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground/75">
                  {file.mime_type === 'inode/directory' ? 'folder' : file.mime_type || 'file'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground/75 font-mono">
                  {file.mime_type === 'inode/directory' ? '—' : formatBytes(file.size_bytes)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    onClick={() => onDelete(file.id)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                  >
                    <Trash size={14} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {files.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-xs text-muted-foreground">
                  Folder is empty.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>Create a nested directory in the current storage path.</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label className="text-xs font-bold text-muted-foreground uppercase block mb-1.5">Folder Name</label>
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. assets"
              className="h-9 bg-background"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
