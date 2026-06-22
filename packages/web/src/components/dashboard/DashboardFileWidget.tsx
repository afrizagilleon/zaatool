import { FileText, UploadSimple, Spinner } from '@phosphor-icons/react';
import { API_BASE_URL } from '../../lib/api.js';

interface DashboardFileWidgetProps {
  node: any;
  data: any;
  outputs: any;
  isExecuting: boolean;
  isUploading: boolean;
  onFileUpload: (file: File) => void;
  onFileRemove: () => void;
}

export function DashboardFileWidget({
  node: _node,
  data,
  outputs,
  isExecuting,
  isUploading,
  onFileUpload,
  onFileRemove
}: DashboardFileWidgetProps) {
  const fileObj = outputs.file || data.inputs?.file || null;
  const fileName = fileObj?.name || (typeof fileObj === 'string' ? fileObj.split('/').pop() : '');
  const filePath = fileObj?.path || (typeof fileObj === 'string' ? fileObj : '');
  const config = data.config || {};
  const isChangeable = config.changeable !== false;
  const fileTypeFilter = config.fileType || 'all';

  // Presets kept for backward compatibility with flows saved before "Allowed File Types"
  // became a free-text comma list.
  const LEGACY_PRESETS: Record<string, string> = {
    all: '',
    images: 'image/*',
    excel_csv: '.csv, .xls, .xlsx, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    videos: 'video/*',
    documents: '.pdf, .doc, .docx, .txt, .md, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  const getAcceptAttribute = (fileType?: string) => {
    if (!fileType) return undefined;
    if (fileType in LEGACY_PRESETS) return LEGACY_PRESETS[fileType] || undefined;

    const tokens = fileType
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.includes('/') || t.startsWith('.') ? t : `.${t}`));

    return tokens.length > 0 ? tokens.join(',') : undefined;
  };

  if (isUploading || isExecuting) {
    return (
      <div className="flex flex-col items-center justify-center p-4 border border-dashed border-border rounded-lg bg-muted/5 h-24">
        <Spinner className="w-6 h-6 text-primary animate-spin mb-2" />
        <span className="text-[10px] text-muted-foreground font-semibold">
          {isUploading ? "Uploading file..." : "Executing workflow..."}
        </span>
      </div>
    );
  }

  if (filePath) {
    return (
      <div className="p-3 bg-muted/20 rounded-lg border border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-muted rounded-md flex items-center justify-center text-muted-foreground shrink-0">
            <FileText size={18} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">{fileName || 'Selected File'}</span>
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[180px]">{filePath}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {isChangeable && (
            <label className="text-xs font-bold text-primary hover:text-primary/80 underline cursor-pointer">
              Change
              <input
                type="file"
                className="hidden"
                accept={getAcceptAttribute(fileTypeFilter)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileUpload(file);
                }}
              />
            </label>
          )}
          <a
            href={`${API_BASE_URL}/storage/${filePath.replace(/^\/+/, '')}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-primary hover:text-primary/80 underline cursor-pointer"
          >
            Download
          </a>
          {isChangeable && (
            <button
              type="button"
              onClick={onFileRemove}
              className="text-xs font-bold text-destructive hover:text-destructive/80 underline cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!isChangeable) {
    return (
      <div className="border border-border rounded-lg p-6 flex flex-col items-center justify-center gap-2 bg-muted/5 h-24">
        <span className="text-xs text-muted-foreground italic">No file uploaded</span>
      </div>
    );
  }

  return (
    <label className="border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all h-24">
      <UploadSimple size={24} className="text-muted-foreground" />
      <span className="text-xs text-muted-foreground font-medium">Click to upload file</span>
      <input
        type="file"
        className="hidden"
        accept={getAcceptAttribute(fileTypeFilter)}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileUpload(file);
        }}
      />
    </label>
  );
}
