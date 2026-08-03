import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Plus, Trash, PencilSimple, Robot, Spinner } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { API_BASE_URL } from '../../lib/api';
import { SkillEditorDialog, type Skill } from './SkillEditorDialog';

interface SkillsTabProps {
  skills: Skill[];
  onSave: (skill: Skill) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function SkillsTab({ skills, onSave, onDelete }: SkillsTabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [conventions, setConventions] = useState<string | null>(null);
  const [showingConventions, setShowingConventions] = useState(false);

  /**
   * Skills reach agents through `zaa://conventions`, appended to the notebook format
   * reference. Nothing on this screen used to say so, so the honest fix is to show the
   * text itself rather than describe it.
   */
  const showConventions = async () => {
    setShowingConventions(true);
    setConventions(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/skills/conventions`, {
        headers: { 'Content-Type': 'application/json' },
      });
      setConventions((await res.json()).text as string);
    } catch (err: unknown) {
      setConventions(`Could not load it: ${(err as Error).message}`);
    }
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setIsOpen(true);
  };

  const handleCreate = () => {
    setEditingSkill(null);
    setIsOpen(true);
  };

  const handleSave = async (skill: Skill) => {
    const success = await onSave(skill);
    if (success) {
      setIsOpen(false);
      setEditingSkill(null);
    }
  };

  return (
    <div className="py-6">
      <Dialog open={showingConventions} onOpenChange={setShowingConventions}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">zaa://conventions</DialogTitle>
            <DialogDescription className="text-xs">
              Word for word, what an agent receives before it writes a notebook. The
              format reference is generated from the parser itself; your skills follow it.
            </DialogDescription>
          </DialogHeader>
          {conventions === null ? (
            <Spinner size={16} className="mx-auto my-8 animate-spin text-muted-foreground" />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
              <Markdown remarkPlugins={[remarkGfm]}>{conventions}</Markdown>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex justify-between items-center mb-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          House rules for this workspace. Every agent connected over MCP reads them as
          part of <code className="font-mono text-xs">zaa://conventions</code>, after the
          notebook format reference — so this is how Claude and Hermes learn how you like
          notebooks written.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => void showConventions()} size="sm" variant="ghost" className="text-xs">
            <Robot className="mr-1.5" size={14} /> What agents read
          </Button>
          <Button onClick={handleCreate} size="sm">
            <Plus className="mr-2" size={14} /> Create Skill
          </Button>
        </div>
      </div>

      <div className="border border-border/80">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>Skill Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.map((skill) => (
              <TableRow key={skill.id}>
                <TableCell className="font-semibold text-xs">{skill.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{skill.description || 'No description'}</TableCell>
                <TableCell className="text-right flex items-center justify-end gap-1.5 h-full">
                  <Button
                    onClick={() => handleEdit(skill)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-accent text-muted-foreground transition-colors"
                  >
                    <PencilSimple size={14} />
                  </Button>
                  <Button
                    onClick={() => onDelete(skill.id)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                  >
                    <Trash size={14} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {skills.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-xs text-muted-foreground">
                  No custom skills found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <SkillEditorDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        skill={editingSkill}
        onSave={handleSave}
      />
    </div>
  );
}
