import { useEffect, useMemo, useState } from 'react';
import { CaretDown, Check, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';
import { useSecrets } from '../../hooks/useSecrets';

interface SecretPickerProps {
  /** The secret's key. `undefined` means no secret. */
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  /**
   * What breaks when `value` names a secret that no longer exists. Shown with the
   * warning, because "not found" alone does not tell the reader what it costs them.
   */
  missingConsequence?: string;
}

/**
 * Picks an existing secret by name, with a filter because a real store has dozens.
 *
 * Deliberately not a text field: this holds a *name*, and a free-text box invites
 * typing the value instead — which produced configuration that could never work and
 * failed with an error blaming the caller.
 */
export function SecretPicker({ value, onChange, missingConsequence }: SecretPickerProps) {
  const { secrets, fetchSecrets } = useSecrets();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void fetchSecrets().finally(() => setHasLoaded(true));
  }, [fetchSecrets]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return secrets;
    return secrets.filter((secret) => secret.key.toLowerCase().includes(needle));
  }, [secrets, query]);

  // Only judged once the list is in: an empty list mid-fetch is not proof of absence.
  const isMissing = Boolean(value) && hasLoaded && !secrets.some((secret) => secret.key === value);

  const select = (key: string | undefined) => {
    onChange(key);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-1">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-7 w-full items-center gap-1.5 border bg-transparent px-2 text-xs outline-none transition-colors dark:bg-input/30',
              'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50',
              isMissing ? 'border-destructive text-destructive' : 'border-input'
            )}
          >
            <span className={cn('flex-1 truncate text-left', value ? 'font-mono' : 'text-muted-foreground')}>
              {value || 'No secret required'}
            </span>
            {isMissing && <Warning size={12} weight="fill" className="shrink-0" />}
            <CaretDown size={12} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56">
          <div className="flex items-center gap-1.5 border-b border-border px-2">
            <MagnifyingGlass size={12} className="shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search secrets…"
              className="h-7 border-0 px-0 text-xs focus-visible:ring-0 dark:bg-transparent"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-0.5">
            <button
              type="button"
              onClick={() => select(undefined)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <span className="w-3 shrink-0">{!value && <Check size={11} />}</span>
              No secret required
            </button>

            {matches.map((secret) => (
              <button
                key={secret.id}
                type="button"
                onClick={() => select(secret.key)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <span className="w-3 shrink-0">{value === secret.key && <Check size={11} />}</span>
                <span className="truncate font-mono">{secret.key}</span>
              </button>
            ))}

            {matches.length === 0 && (
              <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                {secrets.length === 0
                  ? 'No secrets yet — add one under Resources.'
                  : `No secret matches “${query}”.`}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {isMissing && (
        <p className="flex items-start gap-1 text-[9px] leading-normal text-destructive">
          <Warning size={11} weight="fill" className="mt-px shrink-0" />
          <span>
            No secret named <span className="font-mono">{value}</span> exists.
            {missingConsequence ? ` ${missingConsequence}` : ''} Pick one above, or create it
            under Resources.
          </span>
        </p>
      )}
    </div>
  );
}
