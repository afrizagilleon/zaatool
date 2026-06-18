import { useState, useEffect, useRef } from 'react';
import ReactGridLayout from 'react-grid-layout';
const Grid = ReactGridLayout as any;
import 'react-grid-layout/css/styles.css';
import { API_BASE_URL, WS_BASE_URL } from '../../lib/api.js';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { DataTable } from '../ui/DataTable';
import { Play, FileText, Image as ImageIcon, Spinner, Warning, Table as TableIcon, UploadSimple, Sun, Moon, Camera, ChartBar } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../lib/utils.js';
import { useUiStore } from '../../store/uiStore.js';
import html2canvas from 'html2canvas-pro';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

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
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);

  const [executingNodes, setExecutingNodes] = useState<Record<string, boolean>>({});
  const [uploadingNodes, setUploadingNodes] = useState<Record<string, boolean>>({});
  const [copiedTextNode, setCopiedTextNode] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 1280) : 1200);

  const [fontSizes, setFontSizes] = useState<Record<string, number>>({});

  const getAcceptAttribute = (fileType?: string) => {
    if (!fileType) return undefined;
    switch (fileType) {
      case 'images':
        return 'image/*';
      case 'excel_csv':
        return '.csv, .xls, .xlsx, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'videos':
        return 'video/*';
      case 'documents':
        return '.pdf, .doc, .docx, .txt, .md, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      default:
        return undefined;
    }
  };
  const [imageZooms, setImageZooms] = useState<Record<string, number>>({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenshotSuccess, setScreenshotSuccess] = useState(false);

  const handleScreenshot = async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      setIsCapturing(true);

      const canvas = await html2canvas(element, {
        backgroundColor: isDarkMode ? '#09090b' : '#ffffff',
        useCORS: true,
        logging: false,
        scale: 2,
        onclone: (clonedDoc) => {
          const originalTextareas = element.querySelectorAll('textarea');
          const clonedTextareas = clonedDoc.querySelectorAll('textarea');
          
          clonedTextareas.forEach((clonedTextarea, idx) => {
            const originalTextarea = originalTextareas[idx];
            if (!originalTextarea) return;

            const div = clonedDoc.createElement('div');
            div.innerText = clonedTextarea.value;
            div.className = clonedTextarea.className;

            // Copy crucial computed styles from the original textarea
            const computedStyle = window.getComputedStyle(originalTextarea);
            div.style.padding = computedStyle.padding;
            div.style.fontSize = computedStyle.fontSize;
            div.style.fontFamily = computedStyle.fontFamily;
            div.style.lineHeight = computedStyle.lineHeight;
            div.style.color = computedStyle.color;
            div.style.backgroundColor = computedStyle.backgroundColor;
            div.style.border = computedStyle.border;
            div.style.borderRadius = computedStyle.borderRadius;
            div.style.boxSizing = 'border-box';
            
            // Layout and wrapping styles
            div.style.whiteSpace = 'pre-wrap';
            div.style.wordBreak = 'break-word';
            div.style.overflowY = 'auto';
            div.style.display = 'block';
            
            // Use offsetWidth and offsetHeight for identical boundaries
            div.style.width = originalTextarea.offsetWidth + 'px';
            div.style.height = originalTextarea.offsetHeight + 'px';

            clonedTextarea.parentNode?.replaceChild(div, clonedTextarea);
          });
        }
      });

      canvas.toBlob(async (blob) => {
        if (!blob) {
          alert('Failed to generate image from dashboard.');
          setIsCapturing(false);
          return;
        }

        try {
          const data = [new ClipboardItem({ [blob.type]: blob })];
          await navigator.clipboard.write(data);
          setScreenshotSuccess(true);
          setTimeout(() => setScreenshotSuccess(false), 2000);
        } catch (clipErr) {
          console.error('Clipboard write failed, fallback to download:', clipErr);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-dashboard.png`;
          link.click();
          URL.revokeObjectURL(url);
          
          alert('Could not copy image to clipboard automatically (browser security policy). The screenshot has been downloaded instead!');
        } finally {
          setIsCapturing(false);
        }
      }, 'image/png');

    } catch (err: any) {
      console.error('Screenshot failed:', err);
      alert(`Screenshot failed: ${err.message}`);
      setIsCapturing(false);
    }
  };

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
          ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'].includes(n.type) &&
          n.data?.showInDashboard !== false
        );
        setNodes(uiNodes);

        // Populate initial values and outputs
        const initialData: Record<string, any> = {};
        const initialFormInputs: Record<string, Record<string, any>> = {};

        uiNodes.forEach((n: any) => {
          let inputs = n.data?.inputs || {};
          let outputs = n.data?.outputs || {};

          // File changeable logic: if changeable (default true), initialize file as null/blank
          if (n.type === 'file') {
            const config = n.data?.config || {};
            const isChangeable = config.changeable !== false;
            if (isChangeable) {
              inputs = { ...inputs, file: null };
              outputs = { ...outputs, file: null };
            }
          }

          initialData[n.id] = {
            inputs,
            outputs,
            values: n.data?.values || {},
            type: n.type,
            label: n.data?.label || n.type,
            tableConfig: n.data?.tableConfig || {},
            chartConfig: n.data?.chartConfig || {},
            config: n.data?.config || {},
            selectedRow: n.data?.selectedRow || null,
          };

          if (n.type === 'ui:input') {
            initialFormInputs[n.id] = {
              ...(n.data?.values || {}),
              ...(n.data?.outputs?.values || {}),
            };
          }
        });
        setNodeData(initialData);
        setFormInputs(initialFormInputs);

        // Set layout
        const savedLayout = data.dashboard_layout || { items: [] };
        const layoutItems = uiNodes.map((n: any) => {
          const item = savedLayout.items?.find((l: any) => l.i === n.id);
          const base = item || { i: n.id, x: 0, y: 0, w: 6, h: 4 };
          return {
            ...base,
            isDraggable: false,
            isResizable: false
          };
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

              if (output.values) {
                setFormInputs((prev) => ({
                  ...prev,
                  [nodeId]: {
                    ...(prev[nodeId] || {}),
                    ...output.values,
                  },
                }));
              }
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

  const handleFileUpload = async (nodeId: string, file: File) => {
    setUploadingNodes((prev) => ({ ...prev, [nodeId]: true }));
    const formData = new FormData();
    formData.append('file', file);

    const config = nodeData[nodeId]?.config || {};
    const folder = config.folder || '';
    const queryParams = folder ? `?dir=${encodeURIComponent(folder)}` : '';

    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/files${queryParams}`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const uploaded = await res.json();
        // Update outputs locally
        setNodeData((prev) => ({
          ...prev,
          [nodeId]: {
            ...prev[nodeId],
            outputs: { file: uploaded },
          },
        }));

        // Trigger execution downstream
        setExecutingNodes((prev) => ({ ...prev, [nodeId]: true }));
        await fetch(`${API_BASE_URL}/api/flows/${flowId}/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startNodeId: nodeId,
            inputs: { file: uploaded.path },
          }),
        });
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setUploadingNodes((prev) => ({ ...prev, [nodeId]: false }));
    }
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
      return layout.map(item => ({ ...item, isDraggable: false, isResizable: false }));
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
        isDraggable: false,
        isResizable: false,
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
          <div className="w-8 h-8 bg-gradient-to-tr from-primary to-primary-foreground rounded-lg flex items-center justify-center shadow-md shadow-primary/20 animate-pulse shrink-0">
            <span className="font-black text-sm text-white tracking-wider">Z</span>
          </div>
          <span className="font-bold tracking-tight text-foreground truncate max-w-[140px] sm:max-w-xs md:max-w-lg" title={flowName}>
            {flowName}
          </span>
          <span className="text-[10px] bg-muted text-muted-foreground font-semibold px-2 py-0.5 rounded border border-border uppercase shrink-0">
            Shared App
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleScreenshot}
            disabled={isCapturing}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all cursor-pointer shadow-sm disabled:opacity-50"
            title="Copy dashboard screenshot to clipboard"
          >
            {isCapturing ? (
              <Spinner size={15} className="animate-spin" />
            ) : screenshotSuccess ? (
              <span className="text-[10px] text-green-500 font-bold">✓</span>
            ) : (
              <Camera size={15} weight="duotone" />
            )}
          </button>
          <button
            onClick={toggleDarkMode}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all cursor-pointer shadow-sm"
            title="Toggle theme"
          >
            {isDarkMode ? <Sun size={15} weight="duotone" /> : <Moon size={15} weight="duotone" />}
          </button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />
            <span className="hidden sm:inline">Live Session Connected</span>
          </div>
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
                          {type === 'ui:chart' && <ChartBar className="w-4 h-4 text-pink-500" />}
                          {type === 'ui:image' && <ImageIcon className="w-4 h-4 text-orange-500" />}
                          {type === 'file' && <FileText className="w-4 h-4 text-yellow-500" />}
                          <span className="text-xs font-bold text-foreground">{label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {(type === 'ui:text' || type === 'ui:chart') && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setFontSizes(prev => {
                                    const current = prev[node.id] || (type === 'ui:chart' ? 10 : 13);
                                    return { ...prev, [node.id]: Math.max(8, current - 2) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom out text"
                              >
                                A-
                              </button>
                              <button
                                onClick={() => {
                                  setFontSizes(prev => {
                                    const current = prev[node.id] || (type === 'ui:chart' ? 10 : 13);
                                    return { ...prev, [node.id]: Math.min(28, current + 2) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom in text"
                              >
                                A+
                              </button>
                              {type === 'ui:text' && (
                                <button
                                  onClick={() => {
                                    const val = outputs.value || outputs.text || data.inputs?.text || '';
                                    const textStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
                                    navigator.clipboard.writeText(textStr);
                                    setCopiedTextNode(node.id);
                                    setTimeout(() => setCopiedTextNode(null), 2000);
                                  }}
                                  className="text-[10px] font-bold text-primary hover:text-primary/80 hover:underline cursor-pointer select-none ml-1"
                                  title="Copy content"
                                >
                                  {copiedTextNode === node.id ? 'Copied!' : 'Copy'}
                                </button>
                              )}
                            </div>
                          )}
                          {type === 'ui:image' && (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  setImageZooms(prev => {
                                    const current = prev[node.id] || 1.0;
                                    return { ...prev, [node.id]: Math.max(0.2, Number((current - 0.1).toFixed(1))) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom out image"
                              >
                                -
                              </button>
                              <span className="text-[9px] font-mono text-muted-foreground w-8 text-center">
                                {Math.round((imageZooms[node.id] || 1.0) * 100)}%
                              </span>
                              <button
                                onClick={() => {
                                  setImageZooms(prev => {
                                    const current = prev[node.id] || 1.0;
                                    return { ...prev, [node.id]: Math.min(5.0, Number((current + 0.1).toFixed(1))) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom in image"
                              >
                                +
                              </button>
                            </div>
                          )}
                          {type === 'ui:input' && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setFontSizes(prev => {
                                    const current = prev[node.id] || 12;
                                    return { ...prev, [node.id]: Math.max(9, current - 1) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom out text"
                              >
                                A-
                              </button>
                              <button
                                onClick={() => {
                                  setFontSizes(prev => {
                                    const current = prev[node.id] || 12;
                                    return { ...prev, [node.id]: Math.min(24, current + 1) };
                                  });
                                }}
                                className="text-[10px] font-extrabold bg-muted hover:bg-muted-foreground/10 text-foreground px-1.5 py-0.5 rounded cursor-pointer select-none"
                                title="Zoom in text"
                              >
                                A+
                              </button>
                            </div>
                          )}
                          {executingNodes[node.id] && (
                            <Spinner className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                          )}
                        </div>
                      </div>

                      {/* Content body */}
                      <div className="flex-1 p-4 overflow-auto min-h-0 text-sm text-foreground/85">
                        {/* TYPE: ui:input */}
                        {type === 'ui:input' && (
                          <div className="h-full flex flex-col justify-between">
                            <div className="flex-1 flex flex-col space-y-3 min-h-0 overflow-y-auto pb-2">
                              {node.data?.uiSchema?.fields?.map((f: any, idx: number) => {
                                const size = fontSizes[node.id] || 12;
                                return (
                                  <div key={f.id || idx} className={cn("space-y-1.5 flex flex-col", f.type === 'textarea' ? "flex-1 min-h-0" : "shrink-0")}>
                                    <Label className="font-semibold text-muted-foreground" style={{ fontSize: `${size - 1}px` }}>{f.label || f.id}</Label>
                                    {f.type === 'textarea' ? (
                                      <textarea
                                        className="flex-1 min-h-[100px] w-full bg-background border border-border rounded-lg p-3 font-mono focus:outline-none focus:border-primary resize-none text-foreground leading-relaxed"
                                        style={{ fontSize: `${size}px` }}
                                        value={formInputs[node.id]?.[f.id] || ''}
                                        onChange={(e) => handleInputChange(node.id, f.id, e.target.value)}
                                      />
                                    ) : (
                                      <Input
                                        type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
                                        className="h-8.5 bg-background border-border text-foreground shrink-0"
                                        style={{ fontSize: `${size}px` }}
                                        value={formInputs[node.id]?.[f.id] || ''}
                                        onChange={(e) => handleInputChange(node.id, f.id, e.target.value)}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <Button
                              onClick={() => handleFormSubmit(node.id)}
                              className="w-full h-8.5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs flex items-center justify-center gap-1.5 mt-2 shrink-0 rounded-lg"
                              disabled={executingNodes[node.id]}
                            >
                              <Play weight="fill" className="w-3 h-3" />
                              {node.data?.uiSchema?.layout?.submitLabel || 'Submit'}
                            </Button>
                          </div>
                        )}

                        {/* TYPE: ui:text */}
                        {type === 'ui:text' && (
                          <div className="h-full overflow-y-auto pr-1" style={{ fontSize: `${fontSizes[node.id] || 13}px` }}>
                            {(() => {
                              const value = outputs.value || outputs.text || data.inputs?.text || '';
                              if (!value) return <span className="text-muted-foreground text-xs italic">Waiting for text...</span>;

                              // Check if value is JSON
                              try {
                                if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                                  const parsed = JSON.parse(value);
                                  return (
                                    <pre style={{ fontSize: 'inherit' }} className="bg-muted/30 p-2.5 rounded-lg font-mono overflow-x-auto text-foreground border border-border">
                                      {JSON.stringify(parsed, null, 2)}
                                    </pre>
                                  );
                                }
                              } catch (e) {
                                // Not JSON, continue to Markdown/Text
                              }

                              if (typeof value === 'object') {
                                return (
                                  <pre style={{ fontSize: 'inherit' }} className="bg-muted/30 p-2.5 rounded-lg font-mono overflow-x-auto text-foreground border border-border">
                                    {JSON.stringify(value, null, 2)}
                                  </pre>
                                );
                              }

                              return (
                                <div style={{ fontSize: 'inherit' }} className="prose dark:prose-invert max-w-none leading-relaxed text-foreground">
                                  <ReactMarkdown>{String(value).replace(/\\n/g, '\n')}</ReactMarkdown>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* TYPE: ui:chart */}
                        {type === 'ui:chart' && (
                          <div className="h-full w-full flex flex-col min-h-0">
                            {(() => {
                              const rawData = outputs.data || data.inputs?.data;
                              const chartConfig = data.chartConfig || {};
                              const advancedConfig = (() => {
                                if (!chartConfig.jsonConfig) return {};
                                try {
                                  return JSON.parse(chartConfig.jsonConfig);
                                } catch (e) {
                                  return {};
                                }
                              })();

                              const finalData = Array.isArray(rawData) && rawData.length > 0
                                ? rawData
                                : [
                                    { name: 'Jan', value: 400, profit: 240, cost: 160 },
                                    { name: 'Feb', value: 300, profit: 139, cost: 161 },
                                    { name: 'Mar', value: 200, profit: 980, cost: 220 },
                                    { name: 'Apr', value: 278, profit: 390, cost: 180 },
                                    { name: 'May', value: 189, profit: 480, cost: 190 },
                                    { name: 'Jun', value: 239, profit: 380, cost: 250 },
                                  ];

                              let xAxisKey = chartConfig.xAxisKey || '';
                              let yAxisKeys = chartConfig.yAxisKeys || [];

                              if (finalData.length > 0) {
                                const firstRow = finalData[0];
                                if (typeof firstRow === 'object' && firstRow !== null) {
                                  const keys = Object.keys(firstRow);
                                  if (!xAxisKey) {
                                    const stringKey = keys.find(k => typeof firstRow[k] === 'string');
                                    xAxisKey = stringKey || keys[0] || '';
                                  }
                                  if (yAxisKeys.length === 0) {
                                    yAxisKeys = keys.filter(k => k !== xAxisKey && typeof firstRow[k] === 'number');
                                    if (yAxisKeys.length === 0 && keys.length > 1) {
                                      const foundY = keys.find(k => k !== xAxisKey);
                                      yAxisKeys = foundY ? [foundY] : [];
                                    }
                                  }
                                }
                              }

                              const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
                              const chartColors = chartConfig.colors && chartConfig.colors.length > 0
                                ? chartConfig.colors
                                : DEFAULT_COLORS;

                              const fontSize = fontSizes[node.id] || 10;
                              const typeOfChart = chartConfig.type || 'bar';

                              const defaultYAxisTickFormatter = (value: any) => {
                                if (typeof value === 'number') {
                                  return new Intl.NumberFormat().format(value);
                                }
                                return value;
                              };
                              const defaultTooltipFormatter = (value: any) => {
                                return typeof value === 'number' ? new Intl.NumberFormat().format(value) : value;
                              };

                              const gridProps = { stroke: "var(--border)", strokeDasharray: "3 3", ...(advancedConfig.grid || {}) };
                              const xAxisProps = { dataKey: xAxisKey, stroke: "var(--muted-foreground)", fontSize, tickLine: false, axisLine: false, ...(advancedConfig.xAxis || {}) };
                              const yAxisProps = {
                                stroke: "var(--muted-foreground)",
                                fontSize,
                                tickLine: false,
                                axisLine: false,
                                tickFormatter: defaultYAxisTickFormatter,
                                ...(advancedConfig.yAxis || {})
                              };
                              const tooltipProps = {
                                contentStyle: {
                                  backgroundColor: "var(--popover)",
                                  borderColor: "var(--border)",
                                  color: "var(--popover-foreground)",
                                  borderRadius: "var(--radius)",
                                  fontSize: `${fontSize}px`
                                },
                                formatter: defaultTooltipFormatter,
                                ...(advancedConfig.tooltip || {})
                              };
                              const legendProps = {
                                wrapperStyle: { fontSize: `${fontSize}px`, marginTop: "4px" },
                                ...(advancedConfig.legend || {})
                              };

                              return (
                                <div className="flex-1 min-h-0 w-full h-full relative p-2">
                                  <ResponsiveContainer width="100%" height="100%">
                                    {(() => {
                                      if (typeOfChart === 'pie') {
                                        const pieData = finalData.map(d => ({
                                          name: String(d[xAxisKey] || ''),
                                          value: Number(d[yAxisKeys[0] || ''] || 0)
                                        }));
                                        const pieProps = {
                                          data: pieData,
                                          cx: "50%",
                                          cy: "50%",
                                          outerRadius: "70%",
                                          fill: chartColors[0],
                                          dataKey: "value",
                                          label: { fontSize, fill: "var(--foreground)" },
                                          ...(advancedConfig.pie || {})
                                        };
                                        return (
                                          <PieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                            <Pie {...pieProps}>
                                              {pieData.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                                              ))}
                                            </Pie>
                                            <Tooltip {...tooltipProps} />
                                            <Legend {...legendProps} />
                                          </PieChart>
                                        );
                                      }

                                      if (typeOfChart === 'line') {
                                        return (
                                          <LineChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                            <CartesianGrid {...gridProps} />
                                            <XAxis {...xAxisProps} />
                                            <YAxis {...yAxisProps} />
                                            <Tooltip {...tooltipProps} />
                                            <Legend {...legendProps} />
                                            {yAxisKeys.map((key: string, index: number) => {
                                              const lineProps = {
                                                type: "monotone" as const,
                                                dataKey: key,
                                                stroke: chartColors[index % chartColors.length],
                                                strokeWidth: 2,
                                                dot: { r: 3 },
                                                activeDot: { r: 5 },
                                                ...(advancedConfig.line || {})
                                              };
                                              return <Line key={key} {...lineProps} />;
                                            })}
                                          </LineChart>
                                        );
                                      }

                                      if (typeOfChart === 'area') {
                                        return (
                                          <AreaChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                            <CartesianGrid {...gridProps} />
                                            <XAxis {...xAxisProps} />
                                            <YAxis {...yAxisProps} />
                                            <Tooltip {...tooltipProps} />
                                            <Legend {...legendProps} />
                                            {yAxisKeys.map((key: string, index: number) => {
                                              const areaColor = chartColors[index % chartColors.length];
                                              const areaProps = {
                                                type: "monotone" as const,
                                                dataKey: key,
                                                stroke: areaColor,
                                                fill: areaColor,
                                                fillOpacity: 0.2,
                                                strokeWidth: 2,
                                                ...(advancedConfig.area || {})
                                              };
                                              return <Area key={key} {...areaProps} />;
                                            })}
                                          </AreaChart>
                                        );
                                      }

                                      // Default: bar
                                      return (
                                        <BarChart data={finalData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                          <CartesianGrid {...gridProps} />
                                          <XAxis {...xAxisProps} />
                                          <YAxis {...yAxisProps} />
                                          <Tooltip {...tooltipProps} />
                                          <Legend {...legendProps} />
                                          {yAxisKeys.map((key: string, index: number) => {
                                            const barProps = {
                                              dataKey: key,
                                              fill: chartColors[index % chartColors.length],
                                              radius: [4, 4, 0, 0] as [number, number, number, number],
                                              ...(advancedConfig.bar || {})
                                            };
                                            return <Bar key={key} {...barProps} />;
                                          })}
                                        </BarChart>
                                      );
                                    })()}
                                  </ResponsiveContainer>
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
                          <div className="h-full flex items-center justify-center bg-muted/20 border border-border rounded-lg overflow-auto">
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
                              const zoom = imageZooms[node.id] || 1.0;
                              return (
                                <div className="w-full h-full flex items-center justify-center min-w-full min-h-full p-2 overflow-auto">
                                  <img
                                    src={imgUrl}
                                    alt="Dynamic Preview"
                                    className="max-w-full max-h-full object-contain transition-transform duration-200"
                                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* TYPE: file */}
                        {type === 'file' && (() => {
                          const fileObj = outputs.file || data.inputs?.file || null;
                          const fileName = fileObj?.name || (typeof fileObj === 'string' ? fileObj.split('/').pop() : '');
                          const filePath = fileObj?.path || (typeof fileObj === 'string' ? fileObj : '');
                          const isUploading = uploadingNodes[node.id];
                          const config = data.config || {};
                          const isChangeable = config.changeable !== false;
                          const fileTypeFilter = config.fileType || 'all';

                          if (isUploading || executingNodes[node.id]) {
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
                                          if (file) handleFileUpload(node.id, file);
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
                                  if (file) handleFileUpload(node.id, file);
                                }} 
                              />
                            </label>
                          );
                        })()}
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
