import { useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';

/**
 * The notebook, as a file.
 *
 * There was never anything to build here: `toMarkdown` has been lossless since the format
 * existed, and it is already what an agent reads over MCP. What was missing was a way for
 * a person to get at it — so a notebook could not be backed up, moved to another machine,
 * kept in somebody's git repository, or sent to a colleague, without the database.
 *
 * Deliberately not a git integration. Two-way sync between a database and a repository is
 * a merge problem, and the file is the whole of what a repository would have held.
 */
export function ExportButton({ notebookId, name }: { notebookId: string; name: string }) {
  const [isWorking, setIsWorking] = useState(false);

  const download = async () => {
    setIsWorking(true);
    try {
      const text = await notebooksApi.text(notebookId);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name || 'notebook'}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Nothing to report but the absence of a file, which the browser already shows.
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
      onClick={() => void download()}
      disabled={isWorking}
      title="Download this notebook as .md — the same text an agent reads"
    >
      <ArrowSquareOut size={12} className="mr-1" />
      Export
    </Button>
  );
}
