import { ReactFlowProvider } from '@xyflow/react';
import { Navbar } from './components/layout/Navbar';
import { NodePalette } from './components/layout/NodePalette';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import { CodePanel } from './components/panels/CodePanel';
import { AiPanel } from './components/panels/AiPanel';
import { RunConsole } from './components/panels/RunConsole';
import { useUiStore } from './store/uiStore';

function App() {
  const isNodePaletteOpen = useUiStore((s) => s.isNodePaletteOpen);
  const isCodePanelOpen = useUiStore((s) => s.isCodePanelOpen);
  const isConsolePanelOpen = useUiStore((s) => s.isConsolePanelOpen);
  const isAiPanelOpen = useUiStore((s) => s.isAiPanelOpen);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Top navbar */}
      <Navbar />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Node palette */}
        {isNodePaletteOpen && <NodePalette />}

        {/* Center: Canvas + Console */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ReactFlowProvider>
            <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
              <FlowCanvas />
            </div>
          </ReactFlowProvider>
          {/* Bottom: Console (only under canvas) */}
          {isConsolePanelOpen && <RunConsole />}
        </div>

        {/* Right: Property Panel */}
        {isCodePanelOpen && <CodePanel />}

        {/* Far Right: AI Assistant */}
        {isAiPanelOpen && <AiPanel />}
      </div>
    </div>
  );
}

export default App;
