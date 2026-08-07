import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A notebook with no contract is not an app, it is something somebody wrote.
 *
 * These are filled only when the notebook declares no contract at all — see `notesOf`
 * and the `hasContract` gate in the pages controller. That rule is the reason no page
 * with results ever grows a wall of its author's working notes above them.
 *
 * One component for all three surfaces — the editor's preview, Apps, and a share link —
 * because prose that reads differently depending on which of them you opened is prose
 * you cannot trust the preview of.
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
