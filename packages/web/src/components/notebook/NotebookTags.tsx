import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { normaliseTags, tagProblem } from '@zaa-tool/shared';
import { Input } from '../ui/input';

/**
 * What this notebook is for, in words a list can filter by.
 *
 * Tags rather than folders, because a notebook that fetches a rate *and* posts a report
 * belongs in two places and a folder makes it choose. They go in the document, so an
 * export carries them and an agent writing the text form can set them; the engine indexes
 * them into a column on save purely so the list does not have to parse every document.
 *
 * Refusals are shown while typing rather than on submit: a tag with a space in it would
 * become one unmatchable label, and finding that out after saving is finding out too
 * late.
 */
export function NotebookTags({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const problem = draft.trim() === '' ? null : tagProblem(draft);
  const isDuplicate = normaliseTags([draft]).some((tag) => tags.includes(tag));

  const add = () => {
    if (problem || draft.trim() === '') return;
    onChange(normaliseTags([...tags, draft]));
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags.length === 0 && (
          <span className="text-[11px] text-muted-foreground/70">
            No tags. A tag is how you find this one again in a long list.
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[11px] text-foreground"
          >
            #{tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(tags.filter((current) => current !== tag))}
              className="text-muted-foreground hover:text-status-error"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      <Input
        value={draft}
        aria-label="Add a tag"
        aria-invalid={problem !== null}
        placeholder="finance, daily, report…"
        className="h-7 text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter and comma both commit, because a comma is what people type when they
          // mean "and another one".
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />

      {problem && <p className="text-[11px] text-status-error">{problem}</p>}
      {!problem && isDuplicate && (
        <p className="text-[11px] text-muted-foreground/70">Already tagged with that.</p>
      )}
    </div>
  );
}
