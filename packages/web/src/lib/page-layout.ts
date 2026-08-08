import type { NotebookLayoutItem, NotebookOutput } from '@zaa-tool/shared';

/** A tile tall enough to be worth showing, per what the renderer usually needs. */
export function derivedHeight(output: NotebookOutput): number {
  switch (output.render) {
    case 'chart':
    case 'bar':
    case 'line':
    case 'area':
    case 'pie':
      return 10;
    case 'table':
      // FX8 T-09: Table tile height set to h=12 (outer height 612px) so 10-row tables
      // (content height ~447px including search, header, 10 rows & pagination) fit
      // without internal vertical scrolling.
      return 12;

    case 'text':
      return 3;
    default:
      return 6;
  }
}

export function derivedLayout(outputs: NotebookOutput[]): NotebookLayoutItem[] {
  let y = 0;
  return outputs.map((output) => {
    const h = derivedHeight(output);
    const item = { i: output.name, x: 0, y, w: 12, h };
    y += h;
    return item;
  });
}
