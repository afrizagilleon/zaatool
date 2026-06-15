import { useFlowStore } from '../../../store/flowStore';
import type { UiTableConfig, UiTableColumn } from '@zaa-tool/shared';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Plus, Trash } from '@phosphor-icons/react';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

export function UiTableProperties({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore(s => s.nodes);
  const updateNodeData = useFlowStore(s => s.updateNodeData);
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const tableConfig: UiTableConfig = node.data.tableConfig || { columns: [] };
  const columns = tableConfig.columns || [];

  const updateConfig = (newConfig: Partial<UiTableConfig>) => {
    updateNodeData(nodeId, { tableConfig: { ...tableConfig, ...newConfig } });
  };

  const addColumn = () => {
    const newCol: UiTableColumn = {
      key: `col_${Date.now()}`,
      header: 'New Column',
      format: 'text'
    };
    updateConfig({ columns: [...columns, newCol] });
  };

  const updateColumn = (idx: number, patch: Partial<UiTableColumn>) => {
    const newCols = [...columns];
    newCols[idx] = { ...newCols[idx], ...patch };
    updateConfig({ columns: newCols });
  };

  const removeColumn = (idx: number) => {
    updateConfig({ columns: columns.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Columns</span>
        <Button variant="ghost" size="sm" onClick={addColumn} className="h-6 px-2 text-[10px]">
          <Plus size={10} className="mr-1" /> Add
        </Button>
      </div>

      <div className="space-y-3">
        {columns.length === 0 && <div className="text-xs text-muted-foreground italic">No columns defined. Auto-detect from data enabled.</div>}
        
        {columns.map((col, idx) => (
          <div key={idx} className="border border-border rounded-md p-3 space-y-3 relative group bg-muted/10">
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => removeColumn(idx)}
            >
              <Trash size={12} />
            </Button>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Data Key</Label>
                <Input value={col.key} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateColumn(idx, { key: e.target.value })} className="h-7 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Format</Label>
                <Select value={col.format || 'text'} onValueChange={(v: any) => updateColumn(idx, { format: v })}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="badge">Badge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-1">
              <Label className="text-[10px]">Header Label</Label>
              <Input value={col.header} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateColumn(idx, { header: e.target.value })} className="h-7 text-xs" />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Table Options</span>

        <div className="flex items-center justify-between py-1">
          <Label htmlFor="table-pagination" className="text-xs">Pagination</Label>
          <Switch 
            id="table-pagination"
            checked={!!tableConfig.pagination} 
            onCheckedChange={(val) => updateConfig({ pagination: val })}
          />
        </div>

        {tableConfig.pagination && (
          <div className="space-y-1.5 pl-2 border-l border-border/50">
            <Label htmlFor="table-pagesize" className="text-[10px]">Page Size</Label>
            <Input 
              id="table-pagesize"
              type="number"
              value={tableConfig.pageSize || 10} 
              onChange={(e) => updateConfig({ pageSize: parseInt(e.target.value) || 10 })} 
              className="h-7 text-xs w-20"
            />
          </div>
        )}

        <div className="flex items-center justify-between py-1">
          <Label htmlFor="table-selectable" className="text-xs">Selectable Rows</Label>
          <Switch 
            id="table-selectable"
            checked={!!tableConfig.selectable} 
            onCheckedChange={(val) => updateConfig({ selectable: val })}
          />
        </div>

        <div className="flex items-center justify-between py-1">
          <Label htmlFor="table-striped" className="text-xs">Zebra Striped</Label>
          <Switch 
            id="table-striped"
            checked={!!tableConfig.striped} 
            onCheckedChange={(val) => updateConfig({ striped: val })}
          />
        </div>

        <div className="flex items-center justify-between py-1">
          <Label htmlFor="table-compact" className="text-xs">Compact Padding</Label>
          <Switch 
            id="table-compact"
            checked={!!tableConfig.compact} 
            onCheckedChange={(val) => updateConfig({ compact: val })}
          />
        </div>
      </div>
    </div>
  );
}
