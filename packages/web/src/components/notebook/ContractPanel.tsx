import { useState } from 'react';
import {  Plus, Trash, Copy, Check, X, Warning } from '@phosphor-icons/react';
import type {
  NotebookOutput,
  NotebookOutputRender,
  NotebookParam,
  NotebookParamType,
  NotebookRuntime,
} from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { choicesOf } from '../../lib/notebook-options';
import { RENDERS, specsOf, toDeclaration } from '../../lib/notebook-outputs';

const TYPES: NotebookParamType[] = ['string', 'number', 'boolean', 'json'];

/**
 * The values an input accepts, when there is a fixed set of them.
 *
 * Adds and removes whole options rather than editing them in place, which is what lets
 * a label written elsewhere survive: this panel never rewrites an option it did not
 * create. Typing a value adds it bare; the label, if any, is only displayed.
 */
function OptionsEditor({
  param,
  onChange,
}: {
  param: NotebookParam;
  onChange: (patch: Partial<NotebookParam>) => void;
}) {
  const [draft, setDraft] = useState('');
  const choices = choicesOf(param);

  const add = () => {
    const trimmed = draft.trim();
    setDraft('');
    if (!trimmed) return;

    const value = param.type === 'number' ? Number(trimmed) : trimmed;
    if (param.type === 'number' && !Number.isFinite(value as number)) return;
    if (choices.some((choice) => String(choice.value) === String(value))) return;

    onChange({ options: [...(param.options ?? []), value] });
  };

  const remove = (value: string | number) => {
    const kept = (param.options ?? []).filter((option) => {
      const optionValue = typeof option === 'object' ? option.value : option;
      return String(optionValue) !== String(value);
    });
    // Nothing left to choose between, so the flag that says "pick several" goes too.
    onChange({ options: kept.length > 0 ? kept : undefined, ...(kept.length ? {} : { multiple: undefined }) });
  };

  return (
    <div className="space-y-1">
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {choices.map((choice) => (
            <span
              key={String(choice.value)}
              className="flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[10px] font-mono"
              title={String(choice.value)}
            >
              {choice.label}
              <button
                type="button"
                onClick={() => remove(choice.value)}
                className="text-muted-foreground hover:text-foreground"
                title={`Stop accepting ${choice.value}`}
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={choices.length ? 'Another allowed value' : 'Allowed value (optional)'}
          className="h-7 flex-1 text-xs font-mono"
        />
        {choices.length > 0 && (
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Switch
              checked={param.multiple === true}
              onCheckedChange={(checked) => onChange({ multiple: checked ? true : undefined })}
            />
            Many
          </label>
        )}
      </div>

      {choices.length > 0 && (
        <p className="text-[9px] leading-normal text-muted-foreground/60">
          A dropdown on the page, an enum for agents, and anything else refused before the
          run starts.
        </p>
      )}
    </div>
  );
}

interface ContractPanelProps {
  name: string;
  runtime: NotebookRuntime;
  inputs: NotebookParam[];
  outputs: Array<string | NotebookOutput>;
  testArgs: Record<string, string>;
  onAddInput: () => void;
  onUpdateInput: (index: number, patch: Partial<NotebookParam>) => void;
  onRemoveInput: (index: number) => void;
  onOutputsChange: (outputs: Array<string | NotebookOutput>) => void;
  onTestArgChange: (name: string, value: string) => void;
}

/** What another notebook would write to call this one. */
function callSignature(name: string, runtime: NotebookRuntime, inputs: NotebookParam[]): string {
  const reference = `'${name.replace(/'/g, "\\'")}'`;

  if (inputs.length === 0) {
    return runtime === 'python' ? `notebooks.run(${reference})` : `await notebooks.run(${reference})`;
  }

  const args = inputs
    .map((input) => (runtime === 'python' ? `"${input.name}": …` : `${input.name}: …`))
    .join(', ');

  return runtime === 'python'
    ? `notebooks.run(${reference}, { ${args} })`
    : `await notebooks.run(${reference}, { ${args} })`;
}

/**
 * Declares the notebook's reuse boundary.
 *
 * Everything inside a notebook talks through shared scope, which is what makes it
 * readable straight down. That stops being safe the moment another notebook depends on
 * it — so what a caller may pass and what it may read are written down here, and only
 * here. A notebook with an empty contract still runs; it just cannot be called usefully.
 */
export function ContractPanel({
  name,
  runtime,
  inputs,
  outputs,
  testArgs,
  onAddInput,
  onUpdateInput,
  onRemoveInput,
  onOutputsChange,
  onTestArgChange,
}: ContractPanelProps) {
  const [newOutput, setNewOutput] = useState('');
  const [copied, setCopied] = useState(false);

  const specs = specsOf(outputs);

  const addOutput = () => {
    const trimmed = newOutput.trim();
    if (!trimmed || specs.some((spec) => spec.name === trimmed)) {
      setNewOutput('');
      return;
    }
    onOutputsChange([...outputs, trimmed]);
    setNewOutput('');
  };

  const signature = callSignature(name, runtime, inputs);

  /**
   * A required input with neither a test value nor a default cannot run from here.
   * Saying so next to the fields beats letting the reader press Run and read it back
   * as a failure — the run never even starts.
   */
  const missingTestValues = inputs
    .filter(
      (input) =>
        input.required &&
        input.default === undefined &&
        (testArgs[input.name] ?? '').trim() === ''
    )
    .map((input) => input.name);

  return (
    <div className="w-full p-3 space-y-3">
      {inputs.length === 0 && outputs.length === 0 && (
        <p className="text-[10px] text-muted-foreground leading-normal">
          Nothing declared. This notebook runs on its own, but another notebook calling it
          cannot pass anything in or read anything out.
        </p>
      )}

      {/* ── Inputs ── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
            Inputs
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={onAddInput}
          >
            <Plus size={10} className="mr-1" />
            Input
          </Button>
        </div>

        {inputs.map((input, index) => (
          <div key={index} className="border border-border p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                value={input.name}
                onChange={(e) => onUpdateInput(index, { name: e.target.value })}
                placeholder="name"
                className="h-7 flex-1 text-xs font-mono"
              />
              <Select
                value={input.type}
                onValueChange={(type) => onUpdateInput(index, { type: type as NotebookParamType })}
              >
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="text-xs">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-red-400 hover:text-red-300"
                title="Remove input"
                onClick={() => onRemoveInput(index)}
              >
                <Trash size={11} />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Switch
                  checked={input.required === true}
                  onCheckedChange={(checked) => onUpdateInput(index, { required: checked })}
                />
                Required
              </label>
              <Input
                value={input.default === undefined ? '' : String(input.default)}
                onChange={(e) =>
                  onUpdateInput(index, {
                    default: e.target.value === '' ? undefined : e.target.value,
                  })
                }
                placeholder="default (optional)"
                className="h-7 flex-1 text-xs"
              />
            </div>

            {/* Written by whoever writes the notebook, which is as often an agent as a
                person. It reaches the page, the tool schema and this panel — so leaving
                it out of the editor made a field only an agent could change. */}
            <Input
              value={input.description ?? ''}
              onChange={(e) =>
                onUpdateInput(index, {
                  description: e.target.value === '' ? undefined : e.target.value,
                })
              }
              placeholder="What this is for (shown on the page and to agents)"
              className="h-7 w-full text-xs"
            />

            {(input.type === 'string' || input.type === 'number') && (
              <OptionsEditor
                param={input}
                onChange={(patch) => onUpdateInput(index, patch)}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Outputs ── */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          Outputs
        </span>

        {specs.length > 0 && (
          <div className="space-y-1">
            {specs.map((spec, index) => (
              <div key={spec.name} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate bg-muted px-1.5 py-1 text-[10px] font-mono">
                  {spec.name}
                </span>

                {/* `auto` is the value's own shape deciding, which is right almost
                    always — this is here for the times it is not. */}
                <Select
                  value={spec.render ?? 'auto'}
                  onValueChange={(render) =>
                    onOutputsChange(
                      specs.map((existing, at) =>
                        at === index
                          ? render === 'auto'
                            ? existing.name
                            : { ...existing, render: render as NotebookOutputRender }
                          : toDeclaration(existing)
                      )
                    )
                  }
                >
                  <SelectTrigger className="h-6 w-20 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RENDERS.map((render) => (
                      <SelectItem key={render} value={render} className="text-xs">
                        {render}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <button
                  type="button"
                  onClick={() =>
                    onOutputsChange(
                      specs.filter((_, at) => at !== index).map(toDeclaration)
                    )
                  }
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title={`Stop returning ${spec.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Enter and blur both commit, but neither is visible — so the button is
            what tells a first-time reader this field expects one name at a time. */}
        <div className="flex items-center gap-1">
          <Input
            value={newOutput}
            onChange={(e) => setNewOutput(e.target.value)}
            onBlur={addOutput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addOutput();
            }}
            placeholder="Name from scope"
            className="h-7 flex-1 text-xs font-mono"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-muted-foreground shrink-0"
            disabled={newOutput.trim() === ''}
            onClick={addOutput}
          >
            <Plus size={10} className="mr-1" />
            Add
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground/60 leading-normal">
          Only these are handed back. A declared name the run never wrote comes back as
          null, so a caller can tell it apart from a value that was simply absent.
        </p>
      </div>

      {/* ── How to call it ── */}
      <div className="space-y-1">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          Called as
        </span>
        <div className="flex items-center gap-1">
          <code className="flex-1 min-w-0 truncate bg-muted px-1.5 py-1 text-[10px] font-mono text-foreground/80">
            {signature}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 shrink-0"
            title="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(signature).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check size={11} className="text-status-done" /> : <Copy size={11} />}
          </Button>
        </div>
      </div>

      {/* ── Test values ── */}
      {inputs.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
            Test values
          </span>
          {inputs.map((input) => (
            <div key={input.name} className="flex items-center gap-1.5">
              <span className="w-24 shrink-0 truncate text-[10px] font-mono text-muted-foreground">
                {input.name}
              </span>
              {choicesOf(input).length > 0 && !input.multiple ? (
                <Select
                  value={testArgs[input.name] ?? ''}
                  onValueChange={(value) => onTestArgChange(input.name, value)}
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue
                      placeholder={input.default === undefined ? 'Choose…' : String(input.default)}
                    />
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
              ) : (
                <Input
                  value={testArgs[input.name] ?? ''}
                  onChange={(e) => onTestArgChange(input.name, e.target.value)}
                  placeholder={input.default === undefined ? input.type : String(input.default)}
                  className="h-7 flex-1 text-xs"
                />
              )}
            </div>
          ))}
          {missingTestValues.length > 0 && (
            <p className="flex items-start gap-1 text-[9px] leading-normal text-amber-500">
              <Warning size={11} weight="fill" className="mt-px shrink-0" />
              <span>
                {missingTestValues.map((name) => `"${name}"`).join(', ')}{' '}
                {missingTestValues.length === 1 ? 'is' : 'are'} required, so running from
                here is refused until filled in.
              </span>
            </p>
          )}

          <p className="text-[9px] text-muted-foreground/60 leading-normal">
            Used when you run from here, so the contract can be exercised without a caller.
            Not saved with the notebook.
          </p>
        </div>
      )}
    </div>
  );
}
