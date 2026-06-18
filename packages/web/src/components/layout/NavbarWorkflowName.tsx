import { useState } from 'react';

interface NavbarWorkflowNameProps {
  flowName: string;
  onRename: (name: string) => void;
}

export function NavbarWorkflowName({ flowName, onRename }: NavbarWorkflowNameProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      onRename(tempName.trim());
    }
    setIsEditingName(false);
  };

  return (
    <div className="flex flex-col justify-center px-2 mr-2 max-w-[180px]">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5 select-none">
        Workflow
      </span>
      {isEditingName ? (
        <input
          type="text"
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') setIsEditingName(false);
          }}
          className="text-xs font-semibold text-foreground bg-muted border border-border px-1 py-0.5 rounded outline-none w-full max-w-[140px] h-5"
          autoFocus
        />
      ) : (
        <span
          onClick={() => {
            setTempName(flowName || 'Untitled Flow');
            setIsEditingName(true);
          }}
          className="text-xs font-semibold text-foreground truncate leading-none cursor-pointer hover:underline"
          title="Click to rename workflow"
        >
          {flowName || 'Untitled Flow'}
        </span>
      )}
    </div>
  );
}
