import { DataTable } from '../ui/DataTable';

interface DashboardTableWidgetProps {
  node: any;
  data: any;
  outputs: any;
  onRowClick: (row: any) => void;
}

export function DashboardTableWidget({ node: _node, data, outputs, onRowClick }: DashboardTableWidgetProps) {
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
        onRowClick={onRowClick}
        pageSizeDefault={tableConfig.pageSize || 5}
      />
    </div>
  );
}
