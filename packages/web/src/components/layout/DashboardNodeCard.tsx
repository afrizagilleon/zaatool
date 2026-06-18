import { Play, FileText, Image as ImageIcon, Table as TableIcon, ChartBar } from '@phosphor-icons/react';

interface DashboardNodeCardProps {
  node: any;
}

export function DashboardNodeCard({ node }: DashboardNodeCardProps) {
  return (
    <div className="w-full h-full bg-card border border-border rounded-xl overflow-hidden flex flex-col group select-none shadow-md hover:border-muted-foreground/30 transition-all cursor-default relative text-card-foreground">
      <div className="grid-drag-handle h-9 px-3 border-b border-border bg-muted/60 flex items-center justify-between cursor-move shrink-0">
        <div className="flex items-center gap-2">
          {node.type === 'ui:input' && <Play className="w-3.5 h-3.5 text-emerald-500" />}
          {node.type === 'ui:text' && <FileText className="w-3.5 h-3.5 text-blue-500" />}
          {node.type === 'ui:table' && <TableIcon className="w-3.5 h-3.5 text-purple-500" />}
          {node.type === 'ui:chart' && <ChartBar className="w-3.5 h-3.5 text-pink-500" />}
          {node.type === 'ui:image' && <ImageIcon className="w-3.5 h-3.5 text-orange-500" />}
          {node.type === 'file' && <FileText className="w-3.5 h-3.5 text-yellow-500" />}
          <span className="text-xs font-bold text-foreground">
            {node.data?.label || node.type}
          </span>
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">DRAG</span>
      </div>

      <div className="flex-1 p-3 flex flex-col justify-between overflow-hidden text-xs text-muted-foreground font-medium bg-muted/10">
        {node.type === 'ui:input' && (
          <div className="space-y-1.5">
            {node.data?.uiSchema?.fields?.slice(0, 3).map((f: any, idx: number) => (
              <div key={f.id || f.key || idx} className="flex justify-between items-center text-[10px] border-b border-border/60 pb-1">
                <span className="text-muted-foreground font-semibold">{f.label || f.key || `field-${idx}`}</span>
                <span className="text-muted-foreground/50 font-mono italic">[{f.type}]</span>
              </div>
            )) || <span className="italic">No fields configured</span>}
            {node.data?.uiSchema?.fields?.length > 3 && (
              <span className="text-[9px] text-muted-foreground/60 font-medium block">
                + {node.data.uiSchema.fields.length - 3} more fields
              </span>
            )}
          </div>
        )}

        {node.type === 'ui:text' && (
          <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
            <FileText className="w-6 h-6 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">
              Text/Markdown Renderer
            </span>
          </div>
        )}

        {node.type === 'ui:table' && (
          <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
            <TableIcon className="w-6 h-6 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">
              Dynamic Data Table
            </span>
          </div>
        )}

        {node.type === 'ui:chart' && (
          <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
            <ChartBar className="w-6 h-6 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">
              Chart Display Panel
            </span>
          </div>
        )}

        {node.type === 'ui:image' && (
          <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
            <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">
              UIImage Container
            </span>
          </div>
        )}

        {node.type === 'file' && (
          <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
            <FileText className="w-6 h-6 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">
              FileInput Handler
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
