import { useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { Button } from '../../ui/button';
import { asRows, columnsOf } from '../../../lib/notebook-outputs';
import { exportToCsv } from './TableView';

/**
 * Formats a tile output value for copying:
 * - Table/rows -> CSV
 * - String -> string as-is
 * - Objects -> pretty JSON
 * - Primitives -> string representation
 */
export function formatCopyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  const rows = asRows(value);
  if (rows && rows.length > 0) {
    const columns = columnsOf(rows);
    return exportToCsv(columns, rows);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

export function CopyTileValueButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);

  if (value === undefined) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
      title="Copy value"
      onClick={(e) => {
        e.stopPropagation();
        const text = formatCopyValue(value);
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }
      }}
    >
      {copied ? <Check size={11} className="text-status-done" /> : <Copy size={11} />}
    </Button>
  );
}
