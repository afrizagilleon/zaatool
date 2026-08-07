import type { NotebookOutput } from '@zaa-tool/shared';

/**
 * Derives the display title for an output tile.
 *
 * If `output.description` is provided and non-empty, use it as the tile title.
 * Otherwise, fall back to `output.name`.
 */
export function tileTitle(output: NotebookOutput): string {
  return output.description?.trim() ? output.description.trim() : output.name;
}
