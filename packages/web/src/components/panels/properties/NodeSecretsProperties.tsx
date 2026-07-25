import { useEffect } from 'react';
import { Checkbox } from '../../ui/checkbox';
import { Label } from '../../ui/label';
import { useSecrets } from '../../../hooks/useSecrets';

interface NodeSecretsPropertiesProps {
  /** Keys currently declared on the node (`data.config.secrets`). */
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
}

/**
 * Picks which secrets a code node may read. Nothing is exposed to a node that
 * declares none, so this list is the whole of what its `process.env` will hold.
 */
export function NodeSecretsProperties({ selectedKeys, onChange }: NodeSecretsPropertiesProps) {
  const { secrets, isLoading, fetchSecrets } = useSecrets();

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const toggle = (key: string, checked: boolean) => {
    onChange(checked ? [...selectedKeys, key] : selectedKeys.filter((k) => k !== key));
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Secrets
      </span>

      {isLoading && <p className="text-[9px] text-muted-foreground">Loading secrets…</p>}

      {!isLoading && secrets.length === 0 && (
        <p className="text-[9px] text-muted-foreground leading-normal">
          No secrets defined yet. Add them under Resources.
        </p>
      )}

      {secrets.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {secrets.map((secret) => (
            <div key={secret.id} className="flex items-center gap-2">
              <Checkbox
                id={`node-secret-${secret.id}`}
                checked={selectedKeys.includes(secret.key)}
                onCheckedChange={(checked) => toggle(secret.key, checked === true)}
              />
              <Label
                htmlFor={`node-secret-${secret.id}`}
                className="text-[11px] font-mono font-normal cursor-pointer"
              >
                {secret.key}
              </Label>
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
