import { useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { Button } from '../../ui/button';
import { formatCopyValue } from '../../../lib/csv';

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
