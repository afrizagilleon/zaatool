import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './table';
import { Input } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Button } from './button';
import { CaretUp, CaretDown, CaretUpDown, CaretLeft, CaretRight, MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

interface DataTableProps {
  data: any[];
  columns?: { key: string; header: string; format?: string }[];
  selectable?: boolean;
  striped?: boolean;
  compact?: boolean;
  selectedRow?: any;
  onRowClick?: (row: any) => void;
  pageSizeDefault?: number;
}

export function DataTable({
  data = [],
  columns,
  selectable = false,
  striped = false,
  compact = false,
  selectedRow,
  onRowClick,
  pageSizeDefault = 10
}: DataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeDefault);

  // Auto-detect columns if not specified
  const cols = useMemo(() => {
    if (columns && columns.length > 0) {
      return columns;
    }
    if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      return Object.keys(data[0]).map((key) => ({
        key,
        header: key.charAt(0).toUpperCase() + key.slice(1)
      }));
    }
    return [];
  }, [columns, data]);

  // Reset page when search changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  // Handle column sorting
  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  // Filtered and sorted data
  const processedData = useMemo(() => {
    let result = [...data];

    // Local Search filtering
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((row) =>
        cols.some((col) => {
          const val = row[col.key];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(query);
        })
      );
    }

    // Sorting
    if (sortConfig) {
      const { key, direction } = sortConfig;
      result.sort((a, b) => {
        const valA = a[key];
        const valB = b[key];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return direction === 'asc' ? valA - valB : valB - valA;
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return direction === 'asc' ? -1 : 1;
        if (strA > strB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, searchQuery, sortConfig, cols]);

  // Pagination calculations
  const totalRows = processedData.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, currentPage, pageSize]);

  const isRowSelected = (row: any) => {
    if (!selectable || !selectedRow) return false;
    return JSON.stringify(row) === JSON.stringify(selectedRow);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-card text-card-foreground">
      {/* Top Filter and Actions Toolbar */}
      <div className="flex items-center justify-between pb-3 gap-4 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            placeholder="Search all columns..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="h-8 pl-8 pr-2 text-xs bg-background border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Rows per page:</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(val) => {
              setPageSize(parseInt(val, 10));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[10px] w-16 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 10, 20, 50].map((size) => (
                <SelectItem key={size} value={size.toString()} className="text-[10px]">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0 bg-muted/10 relative">
        <Table className="border-collapse">
          {/* Header */}
          <TableHeader className="bg-muted sticky top-0 z-10 border-b border-border/80 shadow-[0_1px_0_0_rgba(0,0,0,0.1)]">
            <TableRow className="border-border hover:bg-muted">
              {cols.map((col) => {
                const isSorted = sortConfig?.key === col.key;
                return (
                  <TableHead
                    key={col.key}
                    onClick={() => requestSort(col.key)}
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider text-muted-foreground select-none cursor-pointer hover:bg-muted/80 hover:text-foreground transition-colors sticky top-0 bg-muted z-10",
                      compact ? "h-8 px-2.5 py-1.5" : "h-10 px-4 py-2"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{col.header}</span>
                      {isSorted ? (
                        sortConfig?.direction === 'asc' ? (
                          <CaretUp size={11} className="text-primary shrink-0" weight="fill" />
                        ) : (
                          <CaretDown size={11} className="text-primary shrink-0" weight="fill" />
                        )
                      ) : (
                        <CaretUpDown size={11} className="text-muted-foreground/45 shrink-0 hover:text-foreground" />
                      )}
                    </div>
                  </TableHead>
                );
              })}
              {cols.length === 0 && (
                <TableHead className={cn("text-[10px]", compact ? "h-8 px-2.5" : "h-10 px-4")}>
                  Columns
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          {/* Body */}
          <TableBody>
            {paginatedData.length > 0 ? (
              paginatedData.map((row, rowIdx) => {
                const selected = isRowSelected(row);
                return (
                  <TableRow
                    key={rowIdx}
                    className={cn(
                      "border-border/60 hover:bg-muted/30 transition-colors",
                      selectable && "cursor-pointer",
                      selected && "bg-primary/15 hover:bg-primary/20 font-medium",
                      striped && !selected && rowIdx % 2 === 1 && "bg-muted/20"
                    )}
                    onClick={() => selectable && onRowClick?.(row)}
                  >
                    {cols.map((col) => {
                      const val = row[col.key];
                      return (
                        <TableCell
                          key={col.key}
                          className={cn(
                            "text-xs text-foreground/80 truncate max-w-[200px] border-b border-border/40",
                            compact ? "px-2.5 py-1.5" : "px-4 py-2"
                          )}
                        >
                          {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={cols.length || 1}
                  className="h-24 text-center text-muted-foreground/60 text-xs italic"
                >
                  {data.length === 0 ? 'No data available' : 'No matching results found'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between pt-3 shrink-0">
        <div className="text-[10px] text-muted-foreground font-mono">
          Showing {totalRows > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
          {Math.min(currentPage * pageSize, totalRows)} of {totalRows} entries
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="w-7 h-7 bg-background border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center"
          >
            <CaretLeft size={12} weight="bold" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="h-7 text-[10px] px-2.5 bg-background border-border text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
          >
            Prev
          </Button>
          <span className="text-[10px] font-bold text-foreground font-mono px-2">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="h-7 text-[10px] px-2.5 bg-background border-border text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
          >
            Next
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="w-7 h-7 bg-background border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center"
          >
            <CaretRight size={12} weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  );
}
