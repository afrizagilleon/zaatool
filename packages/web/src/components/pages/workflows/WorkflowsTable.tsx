import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import { Button } from '../../ui/button';
import { Play, Clock, PencilSimple, Trash } from '@phosphor-icons/react';
import { formatDistanceToNow } from 'date-fns';
import type { Workflow } from '../../../hooks/useWorkflows';

interface WorkflowsTableProps {
  filtered: Workflow[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  parseUtcDate: (dateStr: string) => Date;
}

export function WorkflowsTable({ filtered, isLoading, onOpen, onDelete, parseUtcDate }: WorkflowsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[300px]">Name</TableHead>
          <TableHead>Last Edited</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
              Loading workflows...
            </TableCell>
          </TableRow>
        ) : filtered.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
              No workflows found.
            </TableCell>
          </TableRow>
        ) : (
          filtered.map((w) => (
            <TableRow key={w.id} className="group transition-colors cursor-pointer" onClick={() => onOpen(w.id)}>
              <TableCell className="font-semibold text-[13px]">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-primary/10 text-primary flex items-center justify-center">
                    <Play size={12} weight="fill" />
                  </div>
                  {w.name}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock size={14} />
                  {formatDistanceToNow(parseUtcDate(w.updated_at), { addSuffix: true })}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {parseUtcDate(w.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <div
                  className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="outline" size="icon-sm" onClick={() => onOpen(w.id)}>
                    <PencilSimple size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => onDelete(w.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 border-transparent hover:border-destructive/20"
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
