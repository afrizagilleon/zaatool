import { useState, type DragEvent } from 'react';
import {
  Code,
  BracketsCurly,
  GitBranch,
  ArrowsClockwise,
  MagnifyingGlass,
  AppWindow,
  Table as TableIcon,
  TextAa,
  Image as ImageIcon,
  File as FileIcon
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';

interface PaletteItem {
  type: string;
  runtime?: 'node' | 'python';
  label: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
  bgClass: string;
}

const paletteItems: PaletteItem[] = [
  {
    type: 'code',
    runtime: 'node',
    label: 'Code (JS)',
    description: 'JavaScript function',
    icon: <Code size={16} weight="duotone" />,
    accentClass: 'text-node-code',
    bgClass: 'bg-node-code/10 group-hover:bg-node-code/15',
  },
  {
    type: 'code',
    runtime: 'python',
    label: 'Code (Python)',
    description: 'Python function',
    icon: <BracketsCurly size={16} weight="duotone" />,
    accentClass: 'text-node-code-py',
    bgClass: 'bg-node-code-py/10 group-hover:bg-node-code-py/15',
  },
  {
    type: 'if',
    label: 'If / Branch',
    description: 'Conditional routing',
    icon: <GitBranch size={16} weight="duotone" />,
    accentClass: 'text-node-if',
    bgClass: 'bg-node-if/10 group-hover:bg-node-if/15',
  },
  {
    type: 'loop',
    label: 'Loop',
    description: 'Iterate over array',
    icon: <ArrowsClockwise size={16} weight="duotone" />,
    accentClass: 'text-node-loop',
    bgClass: 'bg-node-loop/10 group-hover:bg-node-loop/15',
  },
  {
    type: 'ui:input',
    label: 'Input Form',
    description: 'Interactive form inputs',
    icon: <AppWindow size={16} weight="duotone" />,
    accentClass: 'text-primary',
    bgClass: 'bg-primary/10 group-hover:bg-primary/15',
  },
  {
    type: 'ui:table',
    label: 'Data Table',
    description: 'Display array data',
    icon: <TableIcon size={16} weight="duotone" />,
    accentClass: 'text-blue-500',
    bgClass: 'bg-blue-500/10 group-hover:bg-blue-500/15',
  },
  {
    type: 'ui:text',
    label: 'Text Display',
    description: 'Render text/markdown',
    icon: <TextAa size={16} weight="duotone" />,
    accentClass: 'text-green-500',
    bgClass: 'bg-green-500/10 group-hover:bg-green-500/15',
  },
  {
    type: 'ui:image',
    label: 'Image',
    description: 'Display an image URL',
    icon: <ImageIcon size={16} weight="duotone" />,
    accentClass: 'text-purple-500',
    bgClass: 'bg-purple-500/10 group-hover:bg-purple-500/15',
  },
  {
    type: 'file',
    label: 'File Input',
    description: 'Upload / pick a file',
    icon: <FileIcon size={16} weight="duotone" />,
    accentClass: 'text-orange-500',
    bgClass: 'bg-orange-500/10 group-hover:bg-orange-500/15',
  },
];

const categories = [
  { label: 'Code', items: paletteItems.filter((i) => i.type === 'code') },
  { label: 'Control Flow', items: paletteItems.filter((i) => i.type === 'if' || i.type === 'loop') },
  { label: 'UI Components', items: paletteItems.filter((i) => i.type.startsWith('ui:')) },
  { label: 'Data', items: paletteItems.filter((i) => i.type === 'file') },
];

export function NodePalette() {
  const [search, setSearch] = useState('');

  const filteredCategories = categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.label.toLowerCase().includes(search.toLowerCase()) ||
          item.description.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((cat) => cat.items.length > 0);

  const onDragStart = (event: DragEvent, item: PaletteItem) => {
    const dragData = JSON.stringify({
      type: item.type,
      runtime: item.runtime,
      label: item.label,
    });
    event.dataTransfer.setData('application/reactflow', dragData);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside
      id="node-palette"
      className="flex flex-col w-56 border-r border-border bg-background shrink-0 animate-slide-in-left"
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Nodes
        </h2>
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            id="palette-search"
            type="text"
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-2 text-xs"
          />
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {filteredCategories.map((cat) => (
          <div key={cat.label}>
            <div className="px-1 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {cat.label}
            </div>
            <div className="space-y-0.5">
              {cat.items.map((item) => (
                <div
                  key={`${item.type}-${item.runtime ?? ''}`}
                  id={`palette-item-${item.type}-${item.runtime ?? 'default'}`}
                  className="group flex items-center gap-2.5 px-2.5 py-2 cursor-grab border border-transparent hover:border-border bg-transparent hover:bg-accent/50 transition-all active:scale-[0.97] active:cursor-grabbing select-none"
                  draggable
                  onDragStart={(e) => onDragStart(e, item)}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-7 h-7 transition-colors',
                      item.bgClass,
                      item.accentClass,
                    )}
                  >
                    {item.icon}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium text-foreground truncate">
                      {item.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 truncate">
                      {item.description}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
            No nodes match "{search}"
          </div>
        )}
      </div>
    </aside>
  );
}
