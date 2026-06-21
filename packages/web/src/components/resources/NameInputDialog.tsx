import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface NameInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => Promise<boolean> | boolean;
}

export function NameInputDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = '',
  confirmLabel = 'Save',
  onConfirm,
}: NameInputDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const handleConfirm = async () => {
    if (!value.trim()) return;
    const success = await onConfirm(value.trim());
    if (success) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="py-4">
          <label className="text-xs font-bold text-muted-foreground uppercase block mb-1.5">{label}</label>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) handleConfirm();
            }}
            className="h-9 bg-background"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
