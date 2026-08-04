import type { NotebookParam } from '@zaa-tool/shared';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Switch } from '../../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { choicesOf, hasChoices } from '../../../lib/notebook-options';

/**
 * One declared input, as a form field.
 *
 * Shared by the deployed page and the editor's preview of it, because a preview that
 * renders its own approximation of the form is a preview of nothing. Every field kind
 * lives here once.
 */

/** Reads the JSON the form keeps for a multiple-choice field, tolerating an empty one. */
export function selectedValues(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function initialValues(inputs: NotebookParam[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    values[input.name] =
      input.default === undefined
        ? input.type === 'boolean'
          ? 'false'
          : ''
        : typeof input.default === 'object'
          ? JSON.stringify(input.default, null, 2)
          : String(input.default);
  }
  return values;
}

/**
 * Turns the typed form back into arguments.
 *
 * Left as strings where it can be: the engine's contract already coerces "3" to 3 and
 * refuses what it cannot, and doing it twice would mean two places to disagree.
 */
export function toArgs(
  inputs: NotebookParam[],
  values: Record<string, string>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const input of inputs) {
    const raw = values[input.name] ?? '';

    // A multiple-choice field is stored as JSON, so an empty selection is a real answer
    // ("none of them") and has to survive the emptiness check below.
    if (input.multiple && hasChoices(input)) {
      const chosen = selectedValues(raw);
      if (chosen.length === 0 && !input.required) continue;
      args[input.name] = chosen;
      continue;
    }

    if (raw === '' && !input.required) continue;

    if (input.type === 'json') {
      try {
        args[input.name] = JSON.parse(raw || 'null');
      } catch {
        args[input.name] = raw;
      }
      continue;
    }
    args[input.name] = raw;
  }
  return args;
}

/**
 * Several values from a fixed set.
 *
 * A list of checkboxes rather than a multi-select, because a browser multi-select needs
 * ctrl-click to add a second item — a rule nobody was told and most people never learn.
 */
function ChoiceList({
  input,
  value,
  onChange,
}: {
  input: NotebookParam;
  value: string;
  onChange: (next: string) => void;
}) {
  const chosen = selectedValues(value);

  const toggle = (option: string) => {
    const next = chosen.includes(option)
      ? chosen.filter((one) => one !== option)
      : [...chosen, option];
    onChange(JSON.stringify(next));
  };

  return (
    <div className="space-y-1 border border-border p-2">
      {choicesOf(input).map((choice) => {
        const asText = String(choice.value);
        return (
          <label key={asText} className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={chosen.includes(asText)}
              onChange={() => toggle(asText)}
              className="accent-primary"
            />
            {choice.label}
          </label>
        );
      })}
    </div>
  );
}

export function InputField({
  input,
  value,
  onChange,
}: {
  input: NotebookParam;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {input.name}
        {input.required && <span className="text-status-error ml-1">*</span>}
      </span>
      {input.description && (
        <span className="block text-[11px] text-muted-foreground/70">{input.description}</span>
      )}

      {input.type === 'boolean' ? (
        <Switch checked={value === 'true'} onCheckedChange={(on) => onChange(String(on))} />
      ) : hasChoices(input) ? (
        input.multiple ? (
          <ChoiceList input={input} value={value} onChange={onChange} />
        ) : (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {choicesOf(input).map((choice) => (
                <SelectItem
                  key={String(choice.value)}
                  value={String(choice.value)}
                  className="text-xs"
                >
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : input.type === 'json' ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs min-h-24"
          placeholder="{ }"
        />
      ) : input.multiline ? (
        // Still a `string`; only the box is different. A one-line field is a promise
        // about length, and it was the wrong promise for a note or a reason.
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-20 text-xs"
        />
      ) : (
        <Input
          type={input.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 text-xs"
        />
      )}
    </label>
  );
}
