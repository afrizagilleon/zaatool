import type { NotebookParam } from '@zaa-tool/shared';

/**
 * Reading an input's fixed set of values.
 *
 * An option is written either bare (`"usd_to_idr"`) or with a label for people to read
 * (`{ value: "usd_to_idr", label: "USD → IDR" }`). Both forms are kept exactly as
 * written — the editor here only adds and removes whole options, so a label an agent
 * wrote survives a person editing the list around it.
 *
 * Lives in web rather than shared because shared holds types only.
 */

export interface OptionChoice {
  value: string | number;
  label: string;
}

export function choicesOf(param: NotebookParam): OptionChoice[] {
  if (!Array.isArray(param.options)) return [];

  const choices: OptionChoice[] = [];
  for (const option of param.options) {
    if (typeof option === 'string' || typeof option === 'number') {
      choices.push({ value: option, label: String(option) });
    } else if (option && (typeof option.value === 'string' || typeof option.value === 'number')) {
      choices.push({ value: option.value, label: option.label ?? String(option.value) });
    }
  }
  return choices;
}

export function hasChoices(param: NotebookParam): boolean {
  return Array.isArray(param.options) && param.options.length > 0;
}
