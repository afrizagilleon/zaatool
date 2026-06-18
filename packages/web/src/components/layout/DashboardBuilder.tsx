import ReactGridLayout from 'react-grid-layout';
const Grid = ReactGridLayout as React.ComponentType<ReactGridLayout.ReactGridLayoutProps & { children?: React.ReactNode }>;
import 'react-grid-layout/css/styles.css';
import { useDashboardBuilder } from '../../hooks/useDashboardBuilder.js';
import { Button } from '../ui/button.js';
import {
  Layout, FloppyDisk, ArrowSquareOut, Play, FileText,
  Image as ImageIcon, Table as TableIcon, ChartBar,
} from '@phosphor-icons/react';
import type { FlowNode } from '../../store/flowStore.js';

function NodeIcon({ type }: { type: string }) {
  if (type === 'ui:input')  return <Play className="w-3.5 h-3.5 text-emerald-500" />;
  if (type === 'ui:text')   return <FileText className="w-3.5 h-3.5 text-blue-500" />;
  if (type === 'ui:table')  return <TableIcon className="w-3.5 h-3.5 text-purple-500" />;
  if (type === 'ui:chart')  return <ChartBar className="w-3.5 h-3.5 text-pink-500" />;
  if (type === 'ui:image')  return <ImageIcon className="w-3.5 h-3.5 text-orange-500" />;
  if (type === 'file')      return <FileText className="w-3.5 h-3.5 text-yellow-500" />;
  return null;
}

function NodeWidgetPreview({ node }: { node: FlowNode }) {
  if (node.type === 'ui:input') {
    const fields = node.data?.uiSchema?.fields ?? [];
    return (
      <div className="space-y-1.5">
        {fields.slice(0, 3).map((f, idx) => (
          <div key={f.id || idx} className="flex justify-between items-center text-[10px] border-b border-border/60 pb-1">
            <span className="text-muted-foreground font-semibold">{f.label || f.id}</span>
            <span className="text-muted-foreground/50 font-mono italic">[{f.type}]</span>
          </div>
        ))}
        {fields.length === 0 && <span className="italic">No fields configured</span>}
        {fields.length > 3 && (
          <span className="text-[9px] text-muted-foreground/60 font-medium block">
            + {fields.length - 3} more fields
          </span>
        )}
      </div>
    );
  }

  const labelMap: Record<string, string> = {
    'ui:text':  'Text/Markdown Renderer',
    'ui:table': 'Dynamic Data Table',
    'ui:chart': 'Chart Display Panel',
    'ui:image': 'UIImage Container',
    'file':     'FileInput Handler',
  };
  const label = labelMap[node.type ?? ''];
  if (!label) return null;

  return (
    <div className="h-full flex flex-col justify-center items-center gap-1.5 text-center">
      <NodeIcon type={node.type ?? ''} />
      <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-full">{label}</span>
    </div>
  );
}

export function DashboardBuilder() {
  const {
    uiNodes, layout, copied, isSaving, containerRef, width,
    dashboardPassword, setDashboardPassword, shareUrl,
    handleLayoutChange, handleSaveLayout, handleCopyUrl,
  } = useDashboardBuilder();

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden animate-in fade-in">
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card/60 backdrop-blur shrink-0 text-foreground">
        <div className="flex items-center gap-2">
          <Layout className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-bold uppercase tracking-wider">Dashboard Grid Builder</h1>
          <span className="text-[10px] text-muted-foreground font-mono">Arrange and resize widgets</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-muted border border-border rounded-lg px-3 py-1 text-xs gap-2">
            <span className="text-muted-foreground font-mono">Password:</span>
            <input
              type="password"
              placeholder="Set password (optional)"
              value={dashboardPassword}
              onChange={(e) => setDashboardPassword(e.target.value)}
              className="bg-background border border-border rounded px-2 py-0.5 text-xs w-36 outline-none focus:border-primary text-foreground font-mono"
            />
            {dashboardPassword && (
              <button onClick={() => setDashboardPassword('')} className="text-[10px] text-red-500 font-bold hover:underline shrink-0">
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center bg-muted border border-border rounded-lg px-3 py-1 text-xs">
            <span className="text-muted-foreground mr-2 font-mono">Public URL:</span>
            <span className="text-foreground font-mono select-all truncate max-w-[240px]">{shareUrl}</span>
            <button onClick={handleCopyUrl} className="ml-3 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer shrink-0">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <Button size="sm" variant="outline" className="border-border hover:bg-muted text-xs h-8 flex items-center gap-1.5" onClick={() => window.open(shareUrl, '_blank')}>
            <ArrowSquareOut className="w-4 h-4" />
            Launch App
          </Button>

          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-8 flex items-center gap-1.5" disabled={isSaving} onClick={handleSaveLayout}>
            <FloppyDisk className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Layout'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 bg-[radial-gradient(currentColor_1px,transparent_1px)] [background-size:24px_24px] text-border/30 bg-background">
        <div ref={containerRef} className="max-w-7xl mx-auto w-full">
          {uiNodes.length === 0 ? (
            <div className="py-24 text-center border border-dashed border-border rounded-2xl flex flex-col items-center justify-center gap-3 bg-card/30">
              <Layout className="w-10 h-10 text-muted-foreground/60" />
              <p className="text-muted-foreground text-sm font-medium">No UI nodes found in this workflow graph.</p>
              <p className="text-muted-foreground/80 text-xs max-w-sm">
                Add UI Input, Text Display, UIImage, File, or Data Table nodes in the Workflow editor canvas first.
              </p>
            </div>
          ) : (
            <Grid
              className="layout"
              layout={layout}
              cols={12}
              rowHeight={80}
              width={width}
              onLayoutChange={handleLayoutChange}
              draggableHandle=".grid-drag-handle"
              isDraggable
              isResizable
            >
              {uiNodes.map((node, idx) => (
                <div key={node.id || `node-${idx}`}>
                  <div className="w-full h-full bg-card border border-border rounded-xl overflow-hidden flex flex-col group select-none shadow-md hover:border-muted-foreground/30 transition-all cursor-default relative text-card-foreground">
                    <div className="grid-drag-handle h-9 px-3 border-b border-border bg-muted/60 flex items-center justify-between cursor-move shrink-0">
                      <div className="flex items-center gap-2">
                        <NodeIcon type={node.type ?? ''} />
                        <span className="text-xs font-bold text-foreground">{node.data?.label || node.type}</span>
                      </div>
                      <span className="text-[9px] text-muted-foreground font-mono">DRAG</span>
                    </div>
                    <div className="flex-1 p-3 flex flex-col justify-between overflow-hidden text-xs text-muted-foreground font-medium bg-muted/10">
                      <NodeWidgetPreview node={node} />
                    </div>
                  </div>
                </div>
              ))}
            </Grid>
          )}
        </div>
      </div>
    </div>
  );
}
