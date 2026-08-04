import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DownloadSimple } from '@phosphor-icons/react';
import type { NotebookOutput } from '@zaa-tool/shared';
import { asRows, renderFor } from '../../../lib/notebook-outputs';
import { API_BASE_URL } from '../../../lib/api';
import { TableView } from './TableView';
import { ChartView, type ChartForm } from './ChartView';

/**
 * Shows one output.
 *
 * The declaration decides only when it disagrees with the value; otherwise the shape
 * decides, so a notebook whose author never thought about presentation still reads
 * well. Where a declaration cannot be honoured — `render: chart` on something that is
 * not rows — the value is shown as what it actually is rather than as an error. A page
 * that refuses to display an answer it already has is worse than one that shows it
 * plainly.
 */

function Empty() {
  return <span className="italic text-muted-foreground/60">nothing</span>;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * A file a cell produced.
 *
 * The link has to come from the engine — it is signed, and it is what makes the file
 * readable to a shared page whose reader has no account. Building `/storage/<path>` here
 * used to point at the dev server rather than the engine, and now would not be served at
 * all, so a value without a `url` is shown as the value it is instead of as a dead link.
 */
function FileLink({ value }: { value: unknown }) {
  const file = value as { name?: string; path?: string; url?: string };
  if (!file?.url) return <Json value={value} />;

  return (
    <a
      href={`${API_BASE_URL}${file.url}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
    >
      <DownloadSimple size={13} />
      {file.name ?? file.path}
    </a>
  );
}

export function OutputView({ output, value }: { output: NotebookOutput; value: unknown }) {
  if (value === null || value === undefined) return <Empty />;

  const rows = asRows(value);

  switch (renderFor(output, value)) {
    case 'table':
      return rows ? <TableView rows={rows} /> : <Json value={value} />;

    case 'chart':
      return rows ? <ChartView rows={rows} x={output.x} /> : <Json value={value} />;

    // Four questions rather than four skins — see ChartView.
    case 'bar':
    case 'line':
    case 'area':
    case 'pie':
      return rows ? (
        <ChartView rows={rows} x={output.x} form={renderFor(output, value) as ChartForm} />
      ) : (
        <Json value={value} />
      );

    case 'image':
      return typeof value === 'string' ? (
        <img src={value} alt={output.name} className="max-w-full border border-border" />
      ) : (
        <Json value={value} />
      );

    case 'file':
      return <FileLink value={value} />;

    case 'markdown':
      return (
        // A markdown output that is a table is a *table*, and plain CommonMark has no
        // such thing — without GFM the pipes collapse into one long paragraph, which is
        // exactly what an agent's summary looked like.
        <div className="prose-sm max-w-none space-y-2 text-sm [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:bg-muted/40 [&_pre]:p-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
          <Markdown remarkPlugins={[remarkGfm]}>{String(value)}</Markdown>
        </div>
      );

    case 'json':
      return <Json value={value} />;

    default:
      return <span className="font-mono text-sm break-words">{String(value)}</span>;
  }
}
