import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, Warning, X } from '@phosphor-icons/react';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useSecrets } from '../../../hooks/useSecrets';

interface NodeSecretsPropertiesProps {
  /** Keys currently declared on the node (`data.config.secrets`). */
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
}

/** Below this many, the list is scannable and a search box is just clutter. */
const SEARCHABLE_FROM = 6;

/**
 * Picks which secrets a code node may read. Nothing is exposed to a node that
 * declares none, so this list is the whole of what its `process.env` will hold.
 */
export function NodeSecretsProperties({ selectedKeys, onChange }: NodeSecretsPropertiesProps) {
  const { secrets, isLoading, fetchSecrets } = useSecrets();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void fetchSecrets().finally(() => setHasLoaded(true));
  }, [fetchSecrets]);

  // Matching on the key only — searching values would put secrets in the DOM as you type.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return secrets;
    return secrets.filter((secret) => secret.key.toLowerCase().includes(needle));
  }, [secrets, query]);

  /**
   * Declared keys with nothing behind them — a secret deleted after this node was
   * configured. They are invisible in the list above, so the node would quietly run
   * without an environment variable it asks for. Only judged once the list is in.
   */
  const orphaned = useMemo(() => {
    if (!hasLoaded) return [];
    return selectedKeys.filter((key) => !secrets.some((secret) => secret.key === key));
  }, [hasLoaded, selectedKeys, secrets]);

  const toggle = (key: string, checked: boolean) => {
    onChange(checked ? [...selectedKeys, key] : selectedKeys.filter((k) => k !== key));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Secrets
        </span>
        {selectedKeys.length > 0 && (
          <span className="text-[9px] text-muted-foreground/70">
            {selectedKeys.length} selected
          </span>
        )}
      </div>

      {isLoading && <p className="text-[9px] text-muted-foreground">Loading secrets…</p>}

      {!isLoading && secrets.length === 0 && (
        <p className="text-[9px] text-muted-foreground leading-normal">
          No secrets defined yet. Add them under Resources.
        </p>
      )}

      {secrets.length >= SEARCHABLE_FROM && (
        <div className="relative">
          <MagnifyingGlass
            size={11}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search secrets…"
            className="h-6 pl-5 text-[11px]"
          />
        </div>
      )}

      {secrets.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {matches.map((secret) => (
            <div key={secret.id} className="flex items-center gap-2">
              <Checkbox
                id={`node-secret-${secret.id}`}
                checked={selectedKeys.includes(secret.key)}
                onCheckedChange={(checked) => toggle(secret.key, checked === true)}
              />
              <Label
                htmlFor={`node-secret-${secret.id}`}
                className="text-[11px] font-mono font-normal cursor-pointer truncate"
              >
                {secret.key}
              </Label>
            </div>
          ))}

          {matches.length === 0 && (
            <p className="py-2 text-center text-[9px] text-muted-foreground">
              No secret matches “{query}”.
            </p>
          )}
        </div>
      )}

      {orphaned.length > 0 && (
        <div className="space-y-1 border-t border-border pt-1.5">
          <p className="flex items-start gap-1 text-[9px] leading-normal text-destructive">
            <Warning size={11} weight="fill" className="mt-px shrink-0" />
            <span>Declared but no longer in the store — nothing is passed for these.</span>
          </p>
          {orphaned.map((key) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="flex-1 truncate font-mono text-[11px] text-destructive">{key}</span>
              <button
                type="button"
                onClick={() => toggle(key, false)}
                title={`Stop declaring ${key}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[9px] text-muted-foreground leading-normal">
        Only the checked keys are exposed to this node as environment variables.
      </p>
    </div>
  );
}
