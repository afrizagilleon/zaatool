import { useState } from 'react';
import { Warning, X } from '@phosphor-icons/react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { ALLOWED_JS_PACKAGES } from '@zaa-tool/shared';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { packageProblem } from '../../lib/notebook-packages';

interface NotebookPackagesProps {
  runtime: NotebookRuntime;
  /** Requirements currently declared in the notebook's front matter. */
  packages: string[];
  onChange: (packages: string[]) => void;
}

/**
 * Picks which libraries this notebook's cells may import.
 *
 * The two runtimes get two controls because they are two different questions. A
 * JavaScript package is one of a handful that ship inside the engine — a closed list, so
 * a list is what you are shown. A Python requirement is anything on PyPI, installed into
 * a throwaway environment for the run — an open field, so a field is what you get, with
 * the shape checked as you type.
 *
 * Until this existed, `packages:` could only be written by an agent or by importing a
 * `.md`, and opening such a notebook in the editor and pressing Save silently deleted it.
 */
export function NotebookPackages({ runtime, packages, onChange }: NotebookPackagesProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const name = draft.trim();
    setDraft('');
    if (!name || packages.includes(name)) return;
    onChange([...packages, name]);
  };

  const remove = (name: string) => onChange(packages.filter((entry) => entry !== name));

  const draftProblem = draft.trim() === '' ? null : packageProblem(runtime, draft);

  /**
   * Entries the engine will refuse. Most often a Python notebook switched to JavaScript
   * after the fact — the requirements stay in the document and stop being answerable, and
   * nothing else in the editor would say so before the run.
   */
  const refused = packages.filter((entry) => packageProblem(runtime, entry) !== null);

  if (runtime === 'node') {
    return (
      <div className="space-y-1.5">
        <div className="space-y-1.5">
          {ALLOWED_JS_PACKAGES.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <Checkbox
                id={`notebook-package-${name}`}
                checked={packages.includes(name)}
                onCheckedChange={(checked) =>
                  checked === true ? onChange([...packages, name]) : remove(name)
                }
              />
              <Label
                htmlFor={`notebook-package-${name}`}
                className="text-[11px] font-mono font-normal cursor-pointer"
              >
                {name}
              </Label>
            </div>
          ))}
        </div>

        {refused.length > 0 && (
          <div className="space-y-1 border-t border-border pt-1.5">
            <p className="flex items-start gap-1 text-[9px] leading-normal text-destructive">
              <Warning size={11} weight="fill" className="mt-px shrink-0" />
              <span>Declared but not available to JavaScript cells — the run is refused.</span>
            </p>
            {refused.map((name) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className="flex-1 truncate font-mono text-[11px] text-destructive">{name}</span>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  title={`Stop declaring ${name}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[9px] text-muted-foreground leading-normal">
          A short list on purpose: these load into the engine's own process, so nothing is
          fetched at run time. Python cells may name anything on PyPI.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {packages.length > 0 && (
        <div className="space-y-1">
          {packages.map((name) => (
            <div key={name} className="flex items-center gap-1.5">
              <span className="flex-1 truncate bg-muted px-1.5 py-1 font-mono text-[11px]">
                {name}
              </span>
              <button
                type="button"
                onClick={() => remove(name)}
                title={`Stop installing ${name}`}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

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
        placeholder="pandas, or pandas==2.2.0"
        aria-label="Add a Python requirement"
        aria-invalid={draftProblem !== null}
        className="h-7 w-full text-xs font-mono"
      />

      {draftProblem && (
        <p className="flex items-start gap-1 text-[9px] leading-normal text-destructive">
          <Warning size={11} weight="fill" className="mt-px shrink-0" />
          <span>{draftProblem}</span>
        </p>
      )}

      <p className="text-[9px] text-muted-foreground leading-normal">
        Installed into a fresh environment for each run, so a version here is the version
        that runs. Nothing is installed for a notebook that declares none.
      </p>
    </div>
  );
}
