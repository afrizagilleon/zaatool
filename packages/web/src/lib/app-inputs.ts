import type { NotebookParam } from '@zaa-tool/shared';
import { hasChoices } from './notebook-options';

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

    // A file is kept as the descriptor the engine returned, JSON-encoded like a
    // multiple-choice selection — the form still holds nothing but strings.
    if (input.type === 'file') {
      try {
        args[input.name] = JSON.parse(raw);
      } catch {
        continue;
      }
      continue;
    }

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
