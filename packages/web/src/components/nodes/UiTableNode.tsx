import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Table as TableIcon, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect, useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../store/uiStore';
import { useFlowStore } from '../../store/flowStore';
import type { FlowNodeData } from '../../store/flowStore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

type UiTableNodeProps = NodeProps<Node<FlowNodeData, 'ui:table'>>;

export function UiTableNode({ id, data, selected }: UiTableNodeProps) {
  const tableConfig = data.tableConfig || { columns: [] };
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const isVertical = layoutDirection === 'TB';
  const updateNodeInternals = useUpdateNodeInternals();
  const [showPanel, setShowPanel] = useState(true);

  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const selectedRow = data.selectedRow;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isVertical, updateNodeInternals]);

  const columnsToRender = useMemo(() => {
    if (tableConfig.columns && tableConfig.columns.length > 0) {
      return tableConfig.columns;
    }
    const tableData = Array.isArray(data.inputs?.data) ? data.inputs.data : [];
    if (tableData.length > 0 && typeof tableData[0] === 'object' && tableData[0] !== null) {
      return Object.keys(tableData[0]).map(key => ({
        key,
        header: key.charAt(0).toUpperCase() + key.slice(1)
      }));
    }
    return [];
  }, [tableConfig.columns, data.inputs?.data]);

  const handleClass = "!w-2.5 !h-2.5 !border-[1.5px] !border-node-bg !bg-handle hover:!bg-primary transition-colors !rounded-none";

  const handleRowClick = (row: any) => {
    if (!tableConfig.selectable) return;
    updateNodeData(id, { selectedRow: row });
  };

  const isRowSelected = (row: any) => {
    if (!tableConfig.selectable || !selectedRow) return false;
    return JSON.stringify(row) === JSON.stringify(selectedRow);
  };

  const renderTablePreview = () => {
    if (!showPanel) return null;
    const rawTableData = Array.isArray(data.inputs?.data) ? data.inputs.data : [];
    const tableData = tableConfig.pagination
      ? rawTableData.slice(0, tableConfig.pageSize || 10)
      : rawTableData;
    
    return (
      <div className={cn(
        "nodrag nowheel absolute bg-card text-card-foreground shadow-lg border border-border p-4 rounded-md w-[400px] max-h-[300px] overflow-y-auto z-10",
        isVertical ? "top-0 left-full ml-4" : "top-full mt-4 left-0"
      )}>
        <div className="text-xs font-semibold mb-2 pb-2 border-b border-border flex justify-between items-center">
          <span>{data.label || 'Data Table Preview'}</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            {rawTableData.length > 0 ? `${rawTableData.length} rows` : 'No Data'}
            {tableConfig.pagination && rawTableData.length > (tableConfig.pageSize || 10) && ` (Showing first ${tableConfig.pageSize || 10})`}
          </span>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {columnsToRender.length > 0 ? (
                  columnsToRender.map((col: any) => (
                    <TableHead 
                      key={col.key} 
                      className={cn(
                        "text-[10px] font-semibold text-muted-foreground",
                        tableConfig.compact ? "h-6 px-2 py-1" : "h-8 px-4 py-2"
                      )}
                    >
                      {col.header}
                    </TableHead>
                  ))
                ) : (
                  <>
                    <TableHead className={cn("text-[10px]", tableConfig.compact ? "h-6 px-2" : "h-8 px-4")}>ID</TableHead>
                    <TableHead className={cn("text-[10px]", tableConfig.compact ? "h-6 px-2" : "h-8 px-4")}>Name</TableHead>
                    <TableHead className={cn("text-[10px]", tableConfig.compact ? "h-6 px-2" : "h-8 px-4")}>Status</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Render data rows */}
              {tableData.length > 0 ? (
                tableData.map((row: any, rowIdx: number) => {
                  const selected = isRowSelected(row);
                  return (
                    <TableRow 
                      key={rowIdx}
                      className={cn(
                        tableConfig.selectable && "cursor-pointer hover:bg-muted/50 transition-colors",
                        selected && "bg-primary/15 hover:bg-primary/20 font-medium",
                        tableConfig.striped && !selected && rowIdx % 2 === 1 && "bg-muted/30"
                      )}
                      onClick={() => handleRowClick(row)}
                    >
                      {columnsToRender.length > 0 ? (
                        columnsToRender.map((col: any) => (
                          <TableCell 
                            key={col.key} 
                            className={cn(
                              "text-xs text-foreground truncate max-w-[150px]",
                              tableConfig.compact ? "px-2 py-1" : "px-4 py-2"
                            )}
                          >
                            {row[col.key] !== undefined ? String(row[col.key]) : ''}
                          </TableCell>
                        ))
                      ) : (
                        <TableCell colSpan={3} className="py-2 text-xs text-muted-foreground">
                          Configure columns in properties panel
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={columnsToRender.length || 3} className="h-24 text-center text-muted-foreground text-xs">
                    No data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  if (isVertical) {
    return (
      <div
        id={`node-${id}`}
        className={cn(
          'min-w-48 border bg-node-bg shadow-sm transition-all relative',
          selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
        )}
      >
        <Handle type="target" position={Position.Top} id="data" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-3 pb-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground">data</span>
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase">ARRAY</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-y border-border/50 bg-muted/20">
          <div className="flex items-center justify-center w-5 h-5 bg-blue-500/10 text-blue-500">
            <TableIcon size={14} weight="duotone" />
          </div>
          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
            {data.label || 'Data Table'}
          </span>
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="text-muted-foreground hover:text-foreground transition-colors outline-none"
            title={showPanel ? "Hide Panel" : "Show Panel"}
          >
            {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
          </button>
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-blue-500/10 text-blue-500">UI</span>
        </div>

        <Handle type="source" position={Position.Bottom} id="selectedRow" style={{ left: '50%' }} className={handleClass} />

        <div className="flex justify-center px-3 pt-1 pb-3">
          <div className="flex flex-col items-center">
            <span className="text-[7px] font-medium text-muted-foreground/50 uppercase tracking-wide">OBJECT</span>
            <span className="text-[9px] text-muted-foreground">selectedRow</span>
          </div>
        </div>

        {renderTablePreview()}
      </div>
    );
  }

  // Horizontal layout
  return (
    <div
      id={`node-${id}`}
      className={cn(
        'w-48 border bg-node-bg shadow-sm transition-all relative',
        selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-node-border hover:shadow-md hover:border-border'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-center w-5 h-5 bg-blue-500/10 text-blue-500">
          <TableIcon size={14} weight="duotone" />
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {data.label || 'Data Table'}
        </span>
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="text-muted-foreground hover:text-foreground transition-colors outline-none"
          title={showPanel ? "Hide Panel" : "Show Panel"}
        >
          {showPanel ? <Eye size={14} weight="duotone" /> : <EyeSlash size={14} weight="duotone" />}
        </button>
        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-blue-500/10 text-blue-500">UI</span>
      </div>

      <div className="px-3 py-2">
        <div className="flex justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="relative flex items-center gap-1.5 h-4">
              <Handle type="target" position={Position.Left} id="data" className={cn(handleClass, "!left-[-12px]")} style={{ left: -15 }} />
              <span className="text-[10px] text-muted-foreground">data</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 items-end min-w-0 w-full">
            <div className="relative flex items-center justify-end gap-1.5 h-4 w-full">
              <span className="text-[10px] text-muted-foreground">selectedRow</span>
              <Handle type="source" position={Position.Right} id="selectedRow" className={cn(handleClass, "!right-[-12px]")} style={{ right: -15 }} />
            </div>
          </div>
        </div>
      </div>

      {renderTablePreview()}
    </div>
  );
}
