import type { NotebookParam } from '@zaa-tool/shared';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Switch } from '../../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { choicesOf, hasChoices } from '../../../lib/notebook-options';
import { selectedValues } from '../../../lib/app-inputs';
import { FileField } from './FileField';

/**
 * One declared input, as a form field.
 *
 * Shared by the deployed page and the editor's preview of it, because a preview that
 * renders its own approximation of the form is a preview of nothing. Every field kind
 * lives here once.
 */


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
  notebookId,
  shareToken,
}: {
  input: NotebookParam;
  value: string;
  onChange: (next: string) => void;
  /** Where an attached file goes. Only a `file` input needs it. */
  notebookId?: string;
  /** Set on a shared page, where the link is the credential. */
  shareToken?: string;
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
      ) : input.type === 'file' ? (
        <FileField
          input={input}
          value={value}
          onChange={onChange}
          notebookId={notebookId ?? ''}
          shareToken={shareToken}
        />
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
