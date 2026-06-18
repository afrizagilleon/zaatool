import { useState } from 'react';
import { Panel } from '@xyflow/react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { Node } from '@xyflow/react';

interface CanvasSearchProps {
  nodes: Node[];
  setActiveNodeId: (id: string | null) => void;
  setCodePanelOpen: (open: boolean) => void;
  setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
}

export function CanvasSearch({ nodes, setActiveNodeId, setCodePanelOpen, setCenter }: CanvasSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = nodes.filter((n) => {
      const label = n.data?.label || '';
      const id = n.id || '';
      const type = n.type || '';
      return (
        label.toLowerCase().includes(query.toLowerCase()) ||
        id.toLowerCase().includes(query.toLowerCase()) ||
        type.toLowerCase().includes(query.toLowerCase())
      );
    });
    setSearchResults(filtered);
  };

  const handleResultClick = (node: any) => {
    setSearchQuery('');
    setSearchResults([]);
    setActiveNodeId(node.id);
    setCodePanelOpen(true);
    setCenter(node.position.x + 100, node.position.y + 50, { zoom: 1.2, duration: 800 });
  };

  return (
    <Panel position="top-center" className="w-[260px] relative z-50">
      <div className="flex flex-col bg-background/90 backdrop-blur-sm border border-border p-1 rounded-md shadow-md">
        <div className="relative flex items-center">
          <MagnifyingGlass size={13} className="absolute left-2.5 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search nodes by name/ID..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-transparent h-7 pl-8 pr-2 text-xs outline-none text-foreground"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover text-popover-foreground border border-border rounded-md shadow-lg max-h-48 overflow-y-auto z-[60] py-1">
            {searchResults.map((n) => (
              <button
                key={n.id}
                onClick={() => handleResultClick(n)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground flex flex-col gap-0.5 border-b border-border/40 last:border-0 cursor-pointer"
              >
                <span className="font-semibold truncate">{n.data?.label || 'Untitled Node'}</span>
                <span className="text-[10px] text-muted-foreground truncate">{n.id} • {n.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
