import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Navbar } from './components/layout/Navbar.js';
import { NodePalette } from './components/layout/NodePalette.js';
import { FlowCanvas } from './components/canvas/FlowCanvas.js';
import { PropertiesPanel } from './components/panels/PropertiesPanel.js';
import { AiPanel } from './components/panels/AiPanel.js';
import { RunConsole } from './components/panels/RunConsole.js';
import { ResourcesPage } from './components/pages/ResourcesPage.js';
import { WorkflowsPage } from './components/pages/WorkflowsPage.js';
import { Login } from './components/pages/Login.js';
import { PublishedDashboard } from './components/pages/PublishedDashboard.js';
import { DashboardBuilder } from './components/layout/DashboardBuilder.js';
import { CodeEditorDialog } from './components/panels/CodeEditorDialog.js';
import { useUiStore } from './store/uiStore.js';
import { useAuthStore } from './store/authStore.js';

function App() {
  const isNodePaletteOpen = useUiStore((s) => s.isNodePaletteOpen);
  const isCodePanelOpen = useUiStore((s) => s.isCodePanelOpen);
  const isConsolePanelOpen = useUiStore((s) => s.isConsolePanelOpen);
  const isAiPanelOpen = useUiStore((s) => s.isAiPanelOpen);
  const activeTab = useUiStore((s) => s.activeTab);

  const isCodeEditorOpen = useUiStore((s) => s.isCodeEditorOpen);
  const codeEditorNodeId = useUiStore((s) => s.codeEditorNodeId);
  const closeCodeEditor = useUiStore((s) => s.closeCodeEditor);

  console.log("[App] Render, isCodeEditorOpen:", isCodeEditorOpen, "codeEditorNodeId:", codeEditorNodeId);

  const token = useAuthStore((s) => s.token);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  // Auto verify session on mount
  useEffect(() => {
    if (token) {
      checkAuth();
    }
  }, [token, checkAuth]);

  // Pathname routing
  const path = window.location.pathname;
  const isSharePage = path.startsWith('/share/');
  const shareFlowId = isSharePage ? path.split('/').pop() : null;

  // Render public shared dashboard if URL matches
  if (isSharePage && shareFlowId) {
    return <PublishedDashboard flowId={shareFlowId} />;
  }

  // Enforce authentication for the manager app
  if (!token) {
    return <Login />;
  }

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
            {isCodePanelOpen && <PropertiesPanel />}
            {isCodeEditorOpen && codeEditorNodeId && (
              <CodeEditorDialog
                open={isCodeEditorOpen}
                onOpenChange={(open) => !open && closeCodeEditor()}
                nodeId={codeEditorNodeId}
              />
            )}
          </ReactFlowProvider>
        )}

        {activeTab === 'resources' && <ResourcesPage />}
        {activeTab === 'workflows' && <WorkflowsPage />}
        {activeTab === 'deploys' && <DashboardBuilder />}

        {/* Far Right: AI Assistant */}
        {isAiPanelOpen && <AiPanel />}
      </main>
    </div>
  );
}

export default App;
