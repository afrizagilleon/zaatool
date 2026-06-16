import { useState, useEffect, useRef } from 'react';
import ReactGridLayout from 'react-grid-layout';
const Grid = ReactGridLayout as any;
import 'react-grid-layout/css/styles.css';
import { useFlowStore } from '../../store/flowStore.js';
import { Button } from '../ui/button.js';
import { Layout, FloppyDisk, ArrowSquareOut, Play, FileText, Image as ImageIcon, Table as TableIcon } from '@phosphor-icons/react';
import { API_BASE_URL } from '../../lib/api.js';

export function DashboardBuilder() {
  const flowId = useFlowStore((s) => s.id);
  const flowName = useFlowStore((s) => s.name);
  const nodes = useFlowStore((s) => s.nodes);
  const dashboardLayout = useFlowStore((s) => s.dashboardLayout);
  const setDashboardLayout = useFlowStore((s) => s.setDashboardLayout);

  const [uiNodes, setUiNodes] = useState<any[]>([]);
  const [layout, setLayout] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) {
          setWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Filter nodes whenever they change in flowStore
  useEffect(() => {
    const filtered = nodes.filter((n) =>
      ['ui:input', 'ui:text', 'ui:table', 'ui:image', 'file'].includes(n.type || '')
    );
    setUiNodes(filtered);

    // Synchronize or generate default grid layout items
    const savedItems = dashboardLayout?.items || [];
    const newLayout = filtered.map((node) => {
      const existing = savedItems.find((item: any) => item.i === node.id);
      if (existing) return existing;

      // Default layout config per node type
      let w = 6, h = 4;
      if (node.type === 'ui:input') { w = 4; h = 5; }
      else if (node.type === 'ui:text') { w = 6; h = 4; }
      else if (node.type === 'ui:table') { w = 8; h = 6; }
      else if (node.type === 'ui:image') { w = 4; h = 4; }

      return {
        i: node.id,
        x: (filtered.indexOf(node) * 4) % 12,
        y: Math.floor(filtered.indexOf(node) / 3) * 5,
        w,
        h,
      };
    });

    setLayout(newLayout);
  }, [flowId, nodes.length]);

  const handleLayoutChange = (newLayout: any) => {
    const formatted = newLayout.map((item: any) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
    setLayout(formatted);
    setDashboardLayout({ items: formatted });
  };

  const handleSaveLayout = async () => {
    setIsSaving(true);
    try {
      const flowStore = useFlowStore.getState();
      const graph = flowStore.getGraphJson();
      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: flowId,
          name: flowName,
          graph_json: graph,
          dashboard_layout: { items: layout },
        }),
      });

      if (!res.ok) throw new Error('Failed to save layout');
    } catch (e) {
      console.error(e);
      alert('Failed to save layout to engine.');
    } finally {
      setIsSaving(false);
    }
  };

  const shareUrl = `${window.location.origin}/share/${flowId}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden animate-in fade-in">
      {/* Top action toolbar */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card/60 backdrop-blur shrink-0 text-foreground">
        <div className="flex items-center gap-2">
          <Layout className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-bold uppercase tracking-wider">Dashboard Grid Builder</h1>
          <span className="text-[10px] text-muted-foreground font-mono">Arrange and resize widgets</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-muted border border-border rounded-lg px-3 py-1 text-xs">
            <span className="text-muted-foreground mr-2 font-mono">Public URL:</span>
            <span className="text-foreground font-mono select-all truncate max-w-[240px]">{shareUrl}</span>
            <button
              onClick={handleCopyUrl}
              className="ml-3 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="border-border hover:bg-muted text-xs h-8 flex items-center gap-1.5"
            onClick={() => window.open(shareUrl, '_blank')}
          >
            <ArrowSquareOut className="w-4 h-4" />
            Launch App
          </Button>

          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-8 flex items-center gap-1.5"
            disabled={isSaving}
            onClick={handleSaveLayout}
          >
            <FloppyDisk className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Layout'}
          </Button>
        </div>
      </div>

      {/* Grid Canvas */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-8 bg-[radial-gradient(currentColor_1px,transparent_1px)] [background-size:24px_24px] text-border/30 bg-background">
        <div className="max-w-7xl">
          {uiNodes.length === 0 ? (
            <div className="py-24 text-center border border-dashed border-border rounded-2xl flex flex-col items-center justify-center gap-3 bg-card/30">
              <Layout className="w-10 h-10 text-muted-foreground/60" />
              <p className="text-muted-foreground text-sm font-medium">
                No UI nodes found in this workflow graph.
              </p>
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
              isDraggable={true}
              isResizable={true}
            >
              {uiNodes.map((node, idx) => (
                <div key={node.id || `node-${idx}`}>
                  {/* Inner Card filling the react-grid-item space */}
                  <div className="w-full h-full bg-card border border-border rounded-xl overflow-hidden flex flex-col group select-none shadow-md hover:border-muted-foreground/30 transition-all cursor-default relative text-card-foreground">
                    {/* Drag Handle Top Bar */}
                    <div className="grid-drag-handle h-9 px-3 border-b border-border bg-muted/60 flex items-center justify-between cursor-move shrink-0">
                      <div className="flex items-center gap-2">
                        {node.type === 'ui:input' && <Play className="w-3.5 h-3.5 text-emerald-500" />}
                        {node.type === 'ui:text' && <FileText className="w-3.5 h-3.5 text-blue-500" />}
                        {node.type === 'ui:table' && <TableIcon className="w-3.5 h-3.5 text-purple-500" />}
                        {node.type === 'ui:image' && <ImageIcon className="w-3.5 h-3.5 text-orange-500" />}
                        {node.type === 'file' && <FileText className="w-3.5 h-3.5 text-yellow-500" />}
                        <span className="text-xs font-bold text-foreground">
                          {node.data?.label || node.type}
                        </span>
                      </div>
                      <span className="text-[9px] text-muted-foreground font-mono">DRAG</span>
                    </div>

                    {/* Widget Body Preview */}
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
                </div>
              ))}
            </Grid>
          )}
        </div>
      </div>
    </div>
  );
}
