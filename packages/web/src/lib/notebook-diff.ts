import type { NotebookCell, NotebookJson, NotebookStep } from '@zaa-tool/shared';

/**
 * What deploying would change.
 *
 * Not a text diff of the JSON — that would be technically complete and useless. The
 * question before deploying is "what will start behaving differently", so this reports
 * the things that behave: cells, triggers, secrets and the contract.
 */

export type CellChangeKind = 'added' | 'removed' | 'changed';

export interface CellChange {
  kind: CellChangeKind;
  cellId: string;
  label: string;
  author?: { by: string; at: string };
  before?: string;
  after?: string;
}

export interface SettingChange {
  what: string;
  before: string;
  after: string;
}

export interface NotebookDiff {
  cells: CellChange[];
  settings: SettingChange[];
  /** True when the two documents would behave identically. */
  isEmpty: boolean;
}

function indexCells(steps: NotebookStep[] | undefined, into: Map<string, NotebookCell>): void {
  for (const step of steps ?? []) {
    if (step.kind === 'parallel') {
      for (const lane of step.lanes ?? []) indexCells(lane.steps, into);
      continue;
    }
    into.set(step.id, step);
  }
}

function label(cell: NotebookCell): string {
  const heading = cell.note
    ?.split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0);
  if (heading) return heading.length > 50 ? `${heading.slice(0, 49)}…` : heading;

  const statement = cell.code
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('#'));
  if (statement) return statement.length > 50 ? `${statement.slice(0, 49)}…` : statement;

  return 'empty cell';
}

const describeTriggers = (document: NotebookJson): string =>
  (document.triggers ?? [])
    .map((trigger) =>
      trigger.kind === 'cron'
        ? `cron ${trigger.cron}${trigger.enabled === false ? ' (off)' : ''}`
        : `webhook /hooks/${trigger.slug}${trigger.enabled === false ? ' (off)' : ''}`
    )
    .join(', ') || 'none';

const describeContract = (document: NotebookJson): string =>
  `(${(document.inputs ?? []).map((input) => `${input.name}: ${input.type}`).join(', ') || 'no inputs'}) → {${
    (document.outputs ?? []).join(', ') || 'nothing'
  }}`;

export function diffNotebooks(deployed: NotebookJson, draft: NotebookJson): NotebookDiff {
  const before = new Map<string, NotebookCell>();
  const after = new Map<string, NotebookCell>();
  indexCells(deployed.steps, before);
  indexCells(draft.steps, after);

  const cells: CellChange[] = [];

  for (const [id, cell] of after) {
    const was = before.get(id);
    if (!was) {
      cells.push({ kind: 'added', cellId: id, label: label(cell), author: cell.author, after: cell.code });
      continue;
    }
    if (was.code !== cell.code || was.note !== cell.note) {
      cells.push({
        kind: 'changed',
        cellId: id,
        label: label(cell),
        author: cell.author,
        before: was.code,
        after: cell.code,
      });
    }
  }

  for (const [id, cell] of before) {
    if (!after.has(id)) {
      cells.push({ kind: 'removed', cellId: id, label: label(cell), before: cell.code });
    }
  }

  const settings: SettingChange[] = [];
  const compare = (what: string, was: string, now: string) => {
    if (was !== now) settings.push({ what, before: was, after: now });
  };

  compare('Name', deployed.name, draft.name);
  compare('Runtime', deployed.runtime, draft.runtime);
  compare('Triggers', describeTriggers(deployed), describeTriggers(draft));
  compare('Contract', describeContract(deployed), describeContract(draft));
  compare('Secrets', (deployed.secrets ?? []).join(', ') || 'none', (draft.secrets ?? []).join(', ') || 'none');

  return { cells, settings, isEmpty: cells.length === 0 && settings.length === 0 };
}
