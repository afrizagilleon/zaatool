import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Plus, Trash, PencilSimple } from '@phosphor-icons/react';
import { SkillEditorDialog, type Skill } from '../panels/SkillEditorDialog';

interface SkillsTabProps {
  skills: Skill[];
  onSave: (skill: Skill) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function SkillsTab({ skills, onSave, onDelete }: SkillsTabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

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
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Define custom prompts or instructions reused by your code nodes.</p>
        <Button onClick={handleCreate} size="sm">
          <Plus className="mr-2" size={14} /> Create Skill
        </Button>
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
