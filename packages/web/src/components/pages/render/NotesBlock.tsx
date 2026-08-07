import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders prose notes for notebooks that have no contract (inputs/outputs).
 *
 * Shared across AppsPage, SharedPage, and PagePreview so prose notebooks render
 * identically across all preview and reading surfaces.
 */
export function NotesBlock({ notes }: { notes?: string[] | null }) {
  if (!notes || notes.length === 0) return null;

  return (
    <div className="prose-sm max-w-none space-y-4 border border-border p-5 text-sm [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:bg-muted/40 [&_pre]:p-2">
      {notes.map((note, index) => (
        <Markdown key={index} remarkPlugins={[remarkGfm]}>
          {note}
        </Markdown>
      ))}
    </div>
  );
}
