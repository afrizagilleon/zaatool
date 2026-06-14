import { ReactFlowProvider } from '@xyflow/react';
import { Navbar } from './components/layout/Navbar';
import { NodePalette } from './components/layout/NodePalette';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import { CodePanel } from './components/panels/CodePanel';
import { AiPanel } from './components/panels/AiPanel';
import { RunConsole } from './components/panels/RunConsole';
import { ResourcesPage } from './components/pages/ResourcesPage';
import { WorkflowsPage } from './components/pages/WorkflowsPage';
import { useUiStore } from './store/uiStore';

function App() {
  const isNodePaletteOpen = useUiStore((s) => s.isNodePaletteOpen);
  const isCodePanelOpen = useUiStore((s) => s.isCodePanelOpen);
  const isConsolePanelOpen = useUiStore((s) => s.isConsolePanelOpen);
  const isAiPanelOpen = useUiStore((s) => s.isAiPanelOpen);
  const activeTab = useUiStore((s) => s.activeTab);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Top navbar */}
      <Navbar />

      {/* Main content area */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'editor' && (
          <ReactFlowProvider>
            {isNodePaletteOpen && <NodePalette />}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
              <FlowCanvas />
              {isConsolePanelOpen && <RunConsole />}
            </div>
            {isCodePanelOpen && <CodePanel />}
          </ReactFlowProvider>
        )}

        {activeTab === 'resources' && <ResourcesPage />}
        {activeTab === 'workflows' && <WorkflowsPage />}

        {/* Far Right: AI Assistant */}
        {isAiPanelOpen && <AiPanel />}
      </main>
    </div>
  );
}

export default App;
