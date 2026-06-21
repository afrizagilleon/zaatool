import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useUiStore } from '../../store/uiStore';
import { API_BASE_URL } from '../../lib/api.js';
import type { FileEntry } from '../../hooks/useStorage';

interface FilePreviewDialogProps {
  file: FileEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isTextLike(mime: string) {
  return mime.startsWith('text/') || mime === 'application/json';
}

function monacoLanguageFor(mime: string, name: string) {
  if (mime === 'application/json' || name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (mime === 'text/javascript') return 'javascript';
  if (mime === 'text/typescript') return 'typescript';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/css') return 'css';
  return 'plaintext';
}

export function FilePreviewDialog({ file, open, onOpenChange }: FilePreviewDialogProps) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);

  const fileUrl = file ? `${API_BASE_URL}/storage/${file.path.replace(/^\/+/, '')}` : '';

  useEffect(() => {
    if (!open || !file || !isTextLike(file.mime_type)) {
      setTextContent(null);
      return;
    }
    setIsLoadingText(true);
    fetch(fileUrl)
      .then((res) => res.text())
      .then(setTextContent)
      .catch(() => setTextContent(null))
      .finally(() => setIsLoadingText(false));
  }, [open, file, fileUrl]);

  if (!file) return null;

  const isImage = file.mime_type.startsWith('image/');
  const isVideo = file.mime_type.startsWith('video/');
  const isPdf = file.mime_type === 'application/pdf';
  const isText = isTextLike(file.mime_type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{file.name}</DialogTitle>
        </DialogHeader>

        <div className="h-[60vh] bg-muted/10 border border-border flex items-center justify-center overflow-hidden">
          {isImage && (
            <img src={fileUrl} alt={file.name} className="max-h-full max-w-full object-contain" />
          )}
          {isVideo && <video src={fileUrl} controls className="max-h-full max-w-full" />}
          {isPdf && <iframe src={fileUrl} title={file.name} className="w-full h-full" />}
          {isText &&
            (isLoadingText ? (
              <span className="text-xs text-muted-foreground">Loading preview…</span>
            ) : (
              <Editor
                height="100%"
                width="100%"
                language={monacoLanguageFor(file.mime_type, file.name)}
                theme={isDarkMode ? 'vs-dark' : 'light'}
                value={textContent ?? ''}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                }}
              />
            ))}
          {!isImage && !isVideo && !isPdf && !isText && (
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <span className="text-xs text-muted-foreground italic">
                No preview available for this file type.
              </span>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-primary hover:text-primary/80 underline"
              >
                Download {file.name}
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
