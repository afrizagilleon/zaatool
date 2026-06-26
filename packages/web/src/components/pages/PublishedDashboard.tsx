import ReactGridLayout, { type GridLayoutProps } from 'react-grid-layout';
const Grid = ReactGridLayout as React.ComponentType<GridLayoutProps>;
import 'react-grid-layout/css/styles.css';
import { Play, FileText, Image as ImageIcon, Spinner, Warning, Table as TableIcon, Sun, Moon, Camera, ChartBar } from '@phosphor-icons/react';
import { usePublishedDashboardState } from '../../hooks/usePublishedDashboardState';
import { DashboardInputWidget } from '../dashboard/DashboardInputWidget';
import { DashboardTextWidget } from '../dashboard/DashboardTextWidget';
import { DashboardChartWidget } from '../dashboard/DashboardChartWidget';
import { DashboardTableWidget } from '../dashboard/DashboardTableWidget';
import { DashboardImageWidget } from '../dashboard/DashboardImageWidget';
import { DashboardFileWidget } from '../dashboard/DashboardFileWidget';
import { DashboardPasswordLock } from '../dashboard/DashboardPasswordLock';

interface PublishedDashboardProps {
  flowId: string;
}

// Must match the grid resolution used in DashboardBuilder.tsx so saved
// layouts render at the same physical size in the published view: width is
// native 12-col, only the vertical axis is scaled.
const GRID_COLS = 12;
const ROW_SCALE = 2;
const GRID_ROW_HEIGHT = 80 / ROW_SCALE;
const GRID_MARGIN: [number, number] = [8, 6];

export function PublishedDashboard({ flowId }: PublishedDashboardProps) {
  const {
    flowName,
    nodes,
    nodeData,
    isLoading,
    error,
    isLocked,
    passwordInput,
    lockError,
    isUnlocking,
    formInputs,
    isDarkMode,
    toggleDarkMode,
    showPassword,
    executingNodes,
    uploadingNodes,
    copiedTextNode,
    containerRef,
    width,
    fontSizes,
    imageZooms,
    isCapturing,
    screenshotSuccess,
    getFieldOptions,
    handleScreenshot,
    handleUnlock,
    handleFormSubmit,
    handleInputChange,
    handleFileUpload,
    handleFileRemove,
    handleTableSelect,
    getResponsiveLayout,
    setFontSizes,
    setImageZooms,
    setCopiedTextNode,
    setPasswordInput,
    setShowPassword,
  } = usePublishedDashboardState(flowId);

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
      <main className="flex-1 p-2 overflow-y-auto bg-background">
        {isLocked ? (
          <DashboardPasswordLock
            passwordInput={passwordInput}
            setPasswordInput={setPasswordInput}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            lockError={lockError}
            isUnlocking={isUnlocking}
            handleUnlock={handleUnlock}
          />
        ) : (
          <div ref={containerRef} className="max-w-7xl mx-auto w-full">
            {nodes.length === 0 ? (
              <div className="py-24 text-center text-muted-foreground text-sm border border-dashed border-border rounded-2xl bg-card/30 w-full">
                No UI dashboard elements have been added to this workflow.
              </div>
            ) : (
              <Grid
                className="layout"
                layout={getResponsiveLayout().map((item: any) => ({
                  ...item,
                  w: Math.min(12, Math.max(2, Math.round(item.w))),
                  y: item.y * ROW_SCALE,
                  h: Math.max(1, item.h) * ROW_SCALE,
                }))}
                width={width}
                gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: GRID_MARGIN }}
                dragConfig={{ enabled: false }}
                resizeConfig={{ enabled: false }}
              >
              {nodes.map((node, idx) => {
                const data = (nodeData[node.id] || {}) as any;
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
                        {type === 'ui:input' && (
                          <DashboardInputWidget
                            node={node}
                            formInputs={formInputs[node.id] || {}}
                            onInputChange={(fieldKey, val) => handleInputChange(node.id, fieldKey, val)}
                            onFormSubmit={() => handleFormSubmit(node.id)}
                            onAutoTrigger={(latestInputs) => handleFormSubmit(node.id, latestInputs)}
                            isExecuting={!!executingNodes[node.id]}
                            getFieldOptions={(field) => getFieldOptions(node, field)}
                            fontSize={fontSizes[node.id]}
                          />
                        )}
                        {type === 'ui:text' && (
                          <DashboardTextWidget
                            node={node}
                            data={data}
                            outputs={outputs}
                            fontSize={fontSizes[node.id]}
                          />
                        )}
                        {type === 'ui:chart' && (
                          <DashboardChartWidget
                            node={node}
                            data={data}
                            outputs={outputs}
                            fontSize={fontSizes[node.id]}
                          />
                        )}
                        {type === 'ui:table' && (
                          <DashboardTableWidget
                            node={node}
                            data={data}
                            outputs={outputs}
                            onRowClick={(row) => handleTableSelect(node.id, row)}
                          />
                        )}
                        {type === 'ui:image' && (
                          <DashboardImageWidget
                            node={node}
                            outputs={outputs}
                            data={data}
                            zoom={imageZooms[node.id]}
                          />
                        )}
                        {type === 'file' && (
                          <DashboardFileWidget
                            node={node}
                            data={data}
                            outputs={outputs}
                            isExecuting={!!executingNodes[node.id]}
                            isUploading={!!uploadingNodes[node.id]}
                            onFileUpload={(file) => handleFileUpload(node.id, file)}
                            onFileRemove={() => handleFileRemove(node.id)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Grid>
          )}
        </div>
      )}
      </main>
    </div>
  );
}
