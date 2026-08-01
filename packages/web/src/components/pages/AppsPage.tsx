import { useEffect, useState } from 'react';
import { Play, Spinner, AppWindow, ArrowLeft } from '@phosphor-icons/react';
import type { NotebookPage, NotebookParam } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { notebooksApi } from '../../lib/notebooks-api';
import { choicesOf, hasChoices } from '../../lib/notebook-options';
import { cn } from '../../lib/utils';

/**
 * A page for every deployed notebook, built from its contract.
 *
 * There is no layout to design and no widgets to drag, because a notebook that declares
 * what it takes and what it returns has already described its own page. The dashboard
 * builder this replaces asked you to say all of it a second time, in a different place,
 * and then to keep the two in step.
 *
 * It runs the *deployed* version. Someone using a page is not editing a notebook, and
 * the draft is where the editing happens.
 */

function initialValues(inputs: NotebookParam[]): Record<string, string> {
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
function toArgs(inputs: NotebookParam[], values: Record<string, string>): Record<string, unknown> {
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

/** Reads the JSON the form keeps for a multiple-choice field, tolerating an empty one. */
function selectedValues(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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

function Field({
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
                <SelectItem key={String(choice.value)} value={String(choice.value)} className="text-xs">
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

function Result({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 italic">nothing</span>;
  }
  if (typeof value === 'object') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-[11px] bg-muted/40 p-2 overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="font-mono text-sm">{String(value)}</span>;
}

function PageRunner({ page, onBack }: { page: NotebookPage; onBack: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(page.inputs));
  const [isRunning, setIsRunning] = useState(false);
  const [outputs, setOutputs] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await notebooksApi.runDeployed(page.id, toArgs(page.inputs, values));
      if (result.status === 'failed') {
        setError(result.error ?? 'It failed.');
        setOutputs(null);
      } else {
        setOutputs(result.outputs ?? {});
      }
    } catch (err: unknown) {
      setError((err as Error).message);
      setOutputs(null);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="w-7 h-7 mt-0.5" onClick={onBack} title="Back">
            <ArrowLeft size={14} />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{page.name}</h1>
            {page.description && (
              <p className="text-sm text-muted-foreground mt-1">{page.description}</p>
            )}
          </div>
        </div>

        {page.inputs.length > 0 && (
          <div className="space-y-4 border border-border p-4">
            {page.inputs.map((input) => (
              <Field
                key={input.name}
                input={input}
                value={values[input.name] ?? ''}
                onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
              />
            ))}
          </div>
        )}

        <Button onClick={() => void run()} disabled={isRunning} className="h-9 px-5">
          {isRunning ? (
            <Spinner size={15} className="animate-spin mr-2" />
          ) : (
            <Play size={15} weight="fill" className="mr-2" />
          )}
          Run
        </Button>

        {error && (
          <div className="border border-status-error/40 bg-status-error/5 p-3 text-xs text-status-error">
            {error}
          </div>
        )}

        {outputs && (
          <div className="space-y-3">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Result
            </h2>
            {page.outputs.length === 0 && (
              <p className="text-xs text-muted-foreground">It declares no outputs.</p>
            )}
            {page.outputs.map((name) => (
              <div key={name} className="border border-border p-3 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {name}
                </div>
                <Result value={outputs[name]} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AppsPage() {
  const [pages, setPages] = useState<NotebookPage[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    notebooksApi
      .pages()
      .then(setPages)
      .catch(() => setPages([]));
  }, []);

  const open = pages?.find((page) => page.id === openId);
  if (open) return <PageRunner page={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Apps
        </h1>

        {pages?.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-16">
            <AppWindow size={28} weight="duotone" className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No pages yet.</p>
            <p className="text-xs text-muted-foreground/70 max-w-sm">
              Every deployed notebook that declares inputs or outputs appears here as a page.
              Nothing to lay out — the contract already says what to ask for and what to show.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {(pages ?? []).map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setOpenId(page.id)}
              className={cn(
                'w-full text-left border border-border px-4 py-3 bg-card',
                'hover:border-primary/50 transition-colors'
              )}
            >
              <div className="text-sm font-bold">{page.name}</div>
              {page.description && (
                <div className="text-xs text-muted-foreground mt-0.5">{page.description}</div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-1.5 font-mono">
                ({page.inputs.map((input) => input.name).join(', ') || 'no inputs'}) →{' '}
                {page.outputs.join(', ') || 'nothing'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
