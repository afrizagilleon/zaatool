import { useState, useEffect, useRef } from 'react';
import ReactGridLayout from 'react-grid-layout';
const Grid = ReactGridLayout as any;
import 'react-grid-layout/css/styles.css';
import { API_BASE_URL, WS_BASE_URL } from '../../lib/api.js';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { DataTable } from '../ui/DataTable';
import { Play, FileText, Image as ImageIcon, Spinner, Warning, Table as TableIcon } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';

interface PublishedDashboardProps {
  flowId: string;
}

export function PublishedDashboard({ flowId }: PublishedDashboardProps) {
  const [flowName, setFlowName] = useState('Workflow Dashboard');
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodeData, setNodeData] = useState<Record<string, any>>({});
  const [layout, setLayout] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formInputs, setFormInputs] = useState<Record<string, Record<string, any>>>({});
  const [executingNodes, setExecutingNodes] = useState<Record<string, boolean>>({});

  const wsRef = useRef<WebSocket | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 1280) : 1200);

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

  // Fetch public flow details
  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/public`);
        if (!res.ok) {
          throw new Error('Failed to load published workflow');
        }
        const data = await res.json();
        setFlowName(data.name);

        const graph = data.graph_json || { nodes: [] };
        // Extract only UI nodes
        const uiNodes = graph.nodes.filter((n: any) =>
          ['ui:input', 'ui:text', 'ui:table', 'ui:image', 'file'].includes(n.type)
        );
        setNodes(uiNodes);

        // Populate initial values and outputs
        const initialData: Record<string, any> = {};
        const initialFormInputs: Record<string, Record<string, any>> = {};

        uiNodes.forEach((n: any) => {
          initialData[n.id] = {
            inputs: n.data?.inputs || {},
            outputs: n.data?.outputs || {},
            values: n.data?.values || {},
            type: n.type,
            label: n.data?.label || n.type,
            tableConfig: n.data?.tableConfig || {},
            selectedRow: n.data?.selectedRow || null,
          };

          if (n.type === 'ui:input') {
            initialFormInputs[n.id] = n.data?.values || {};
          }
        });
        setNodeData(initialData);
        setFormInputs(initialFormInputs);

        // Set layout
        const savedLayout = data.dashboard_layout || { items: [] };
        const layoutItems = uiNodes.map((n: any) => {
          const item = savedLayout.items?.find((l: any) => l.i === n.id);
          return item || { i: n.id, x: 0, y: 0, w: 6, h: 4 };
        });
        setLayout(layoutItems);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFlow();
  }, [flowId]);

  // WebSocket connection for reactive updates
  useEffect(() => {
    const connectWs = () => {
      const ws = new WebSocket(WS_BASE_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, nodeId, output, error: nodeErr } = data;

          if (type === 'node:start' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
          } else if (type === 'node:done' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: false }));
            if (output) {
              setNodeData((prev) => {
                const current = prev[nodeId] || {};
                return {
                  ...prev,
                  [nodeId]: {
                    ...current,
                    outputs: output,
                  },
                };
              });

              // Propagate outputs downstream if relevant
              // Since the full graph is not processed locally, we let the backend handle propagation,
              // but we immediately display the updated outputs sent by the WS.
            }
          } else if (type === 'node:error' && nodeId) {
            setExecutingNodes((prev) => ({ ...prev, [nodeId]: false }));
            console.error(`Node ${nodeId} execution error:`, nodeErr);
          } else if (type === 'flow:done') {
            setExecutingNodes({});
          }
        } catch (err) {
          // Silent JSON parsing error
        }
      };

      ws.onclose = () => {
        // Retry connection in 3 seconds
        setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Trigger flow execution from an input form node
  const handleFormSubmit = async (nodeId: string) => {
    setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startNodeId: nodeId,
          inputs: formInputs[nodeId] || {},
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to run workflow trigger');
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleTableSelect = async (nodeId: string, row: any) => {
    setNodeData((prev) => {
      const current = prev[nodeId] || {};
      return {
        ...prev,
        [nodeId]: {
          ...current,
          selectedRow: row,
        },
      };
    });

    setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startNodeId: nodeId,
          inputs: { selectedRow: row },
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to run workflow trigger');
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleInputChange = (nodeId: string, fieldKey: string, val: any) => {
    setFormInputs((prev) => ({
      ...prev,
      [nodeId]: {
        ...(prev[nodeId] || {}),
        [fieldKey]: val,
      },
    }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground gap-4">
        <Spinner className="w-8 h-8 text-primary animate-spin" />
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Loading Dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground gap-4 px-4">
        <Warning className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-bold">Error</h2>
        <p className="text-muted-foreground text-sm">{error}</p>
      </div>
    );
  }

  const getResponsiveLayout = () => {
    if (width >= 768) {
      return layout;
    }
    const sortedItems = [...layout].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    let currentY = 0;
    return sortedItems.map((item) => {
      const h = item.h || 4;
      const responsiveItem = {
        ...item,
        x: 0,
        y: currentY,
        w: 12,
        h,
      };
      currentY += h;
      return responsiveItem;
    });
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col overflow-x-hidden">
      {/* Top dashboard header */}
      <header className="h-16 border-b border-border bg-card/80 backdrop-blur px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center border border-border shrink-0">
            <span className="font-bold text-sm tracking-wider">Z</span>
          </div>
          <span className="font-bold tracking-tight text-foreground truncate max-w-[140px] sm:max-w-xs md:max-w-lg" title={flowName}>
            {flowName}
          </span>
          <span className="text-[10px] bg-muted text-muted-foreground font-semibold px-2 py-0.5 rounded border border-border uppercase shrink-0">
            Shared App
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />
          <span className="hidden sm:inline">Live Session Connected</span>
        </div>
      </header>

      {/* Grid container */}
      <main className="flex-1 p-2 overflow-y-auto">
        <div ref={containerRef} className="max-w-7xl mx-auto">
          {nodes.length === 0 ? (
            <div className="py-24 text-center text-muted-foreground text-sm border border-dashed border-border rounded-2xl bg-card/30">
              No UI dashboard elements have been added to this workflow.
            </div>
          ) : (
            <Grid
              className="layout"
              layout={getResponsiveLayout()}
              cols={12}
              rowHeight={80}
              width={width}
              isDraggable={false}
              isResizable={false}
            >
              {nodes.map((node, idx) => {
                const data = nodeData[node.id] || {};
                const outputs = data.outputs || {};
                const type = node.type;
                const label = data.label;

                return (
                  <div key={node.id || `node-${idx}`}>
                    <div className="w-full h-full bg-card border border-border text-card-foreground rounded-xl overflow-hidden flex flex-col relative group shadow-md hover:border-muted-foreground/30 transition-all cursor-default">
                      {/* Header bar of grid element */}
                      <div className="h-10 px-4 border-b border-border bg-muted/60 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                          {type === 'ui:input' && <Play className="w-4 h-4 text-emerald-500" />}
                          {type === 'ui:text' && <FileText className="w-4 h-4 text-blue-500" />}
                          {type === 'ui:table' && <TableIcon className="w-4 h-4 text-purple-500" />}
                          {type === 'ui:image' && <ImageIcon className="w-4 h-4 text-orange-500" />}
                          {type === 'file' && <FileText className="w-4 h-4 text-yellow-500" />}
                          <span className="text-xs font-bold text-foreground">{label}</span>
                        </div>
                        {executingNodes[node.id] && (
                          <Spinner className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                        )}
                      </div>

                      {/* Content body */}
                      <div className="flex-1 p-4 overflow-auto min-h-0 text-sm text-foreground/85">
                        {/* TYPE: ui:input */}
                        {type === 'ui:input' && (
                          <div className="space-y-4 h-full flex flex-col justify-between">
                            <div className="space-y-3">
                              {node.data?.uiSchema?.fields?.map((f: any, idx: number) => (
                                <div key={f.id || idx} className="space-y-1.5">
                                  <Label className="text-xs font-semibold text-muted-foreground">{f.label || f.id}</Label>
                                  {f.type === 'textarea' ? (
                                    <textarea
                                      className="w-full min-h-[60px] bg-background border-border rounded-lg p-2 text-xs focus:outline-none focus:border-primary resize-none text-foreground"
                                      value={formInputs[node.id]?.[f.id] || ''}
                                      onChange={(e) => handleInputChange(node.id, f.id, e.target.value)}
                                    />
                                  ) : (
                                    <Input
                                      type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
                                      className="h-8.5 bg-background border-border text-xs text-foreground"
                                      value={formInputs[node.id]?.[f.id] || ''}
                                      onChange={(e) => handleInputChange(node.id, f.id, e.target.value)}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                            <Button
                              onClick={() => handleFormSubmit(node.id)}
                              className="w-full h-8.5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs flex items-center justify-center gap-1.5 mt-2 shrink-0 rounded-lg"
                              disabled={executingNodes[node.id]}
                            >
                              <Play weight="fill" className="w-3 h-3" />
                              Submit & Execute
                            </Button>
                          </div>
                        )}

                        {/* TYPE: ui:text */}
                        {type === 'ui:text' && (
                          <div className="h-full overflow-y-auto pr-1">
                            {(() => {
                              const value = outputs.value || outputs.text || data.inputs?.text || '';
                              if (!value) return <span className="text-muted-foreground text-xs italic">Waiting for text...</span>;

                              // Check if value is JSON
                              try {
                                if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                                  const parsed = JSON.parse(value);
                                  return (
                                    <pre className="bg-muted/30 p-2.5 rounded-lg text-[10px] font-mono overflow-x-auto text-foreground border border-border">
                                      {JSON.stringify(parsed, null, 2)}
                                    </pre>
                                  );
                                }
                              } catch (e) {
                                // Not JSON, continue to Markdown/Text
                              }

                              if (typeof value === 'object') {
                                return (
                                  <pre className="bg-muted/30 p-2.5 rounded-lg text-[10px] font-mono overflow-x-auto text-foreground border border-border">
                                    {JSON.stringify(value, null, 2)}
                                  </pre>
                                );
                              }

                              return (
                                <div className="prose dark:prose-invert max-w-none text-xs leading-relaxed text-foreground">
                                  <ReactMarkdown>{String(value)}</ReactMarkdown>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* TYPE: ui:table */}
                        {type === 'ui:table' && (
                          <div className="h-full flex flex-col min-h-0">
                            {(() => {
                              const rawData = outputs.data || data.inputs?.data || [];
                              const rows = Array.isArray(rawData) ? rawData : [];
                              if (rows.length === 0) {
                                return <span className="text-muted-foreground text-xs italic">No table data available.</span>;
                              }

                              // Dynamic column detection
                              const columns = Object.keys(rows[0] || {}).map(key => ({
                                key,
                                header: key.charAt(0).toUpperCase() + key.slice(1)
                              }));
                              const tableConfig = data.tableConfig || {};
                              const selectedRow = data.selectedRow;
                              return (
                                <div className="flex-1 min-h-0">
                                  <DataTable
                                    data={rows}
                                    columns={columns}
                                    selectable={!!tableConfig.selectable}
                                    striped={tableConfig.striped !== false}
                                    compact={tableConfig.compact !== false}
                                    selectedRow={selectedRow}
                                    onRowClick={(row) => handleTableSelect(node.id, row)}
                                    pageSizeDefault={tableConfig.pageSize || 5}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* TYPE: ui:image */}
                        {type === 'ui:image' && (
                          <div className="h-full flex items-center justify-center bg-muted/20 border border-border rounded-lg overflow-hidden">
                            {(() => {
                              const srcObj = outputs.src || data.inputs?.src || '';
                              let src = '';
                              if (typeof srcObj === 'object' && srcObj !== null) {
                                src = srcObj.url || srcObj.path || '';
                              } else {
                                src = String(srcObj);
                              }

                              if (!src) return <span className="text-muted-foreground text-xs italic">No image source</span>;

                              // Handle storage paths
                              const imgUrl = src.startsWith('http') ? src : `${API_BASE_URL}/storage/${src.replace(/^\/+/, '')}`;
                              return (
                                <img
                                  src={imgUrl}
                                  alt="Dynamic Preview"
                                  className="max-w-full max-h-full object-contain"
                                />
                              );
                            })()}
                          </div>
                        )}

                        {/* TYPE: file */}
                        {type === 'file' && (
                          <div className="h-full flex flex-col justify-center">
                            {(() => {
                              const fileObj = outputs.file || data.inputs?.file || null;
                              if (!fileObj) return <span className="text-muted-foreground text-xs italic">No file selected</span>;

                              const fileName = fileObj.name || (typeof fileObj === 'string' ? fileObj.split('/').pop() : 'unnamed_file');
                              const filePath = fileObj.path || (typeof fileObj === 'string' ? fileObj : '');

                              return (
                                <div className="p-3 bg-muted/20 rounded-lg border border-border flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                                      <FileText size={18} />
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-semibold text-foreground">{fileName}</span>
                                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[180px]">{filePath}</span>
                                    </div>
                                  </div>
                                  {filePath && (
                                    <a
                                      href={`${API_BASE_URL}/storage/${filePath.replace(/^\/+/, '')}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs font-bold text-primary hover:text-primary/80 underline cursor-pointer"
                                    >
                                      Download
                                    </a>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Grid>
          )}
        </div>
      </main>
    </div>
  );
}
