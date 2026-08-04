import { useEffect } from 'react';
import { Navbar } from './components/layout/Navbar.js';
import { SystemMap } from './components/map/SystemMap.js';
import { ResourcesPage } from './components/pages/ResourcesPage.js';
import { NotebooksPage } from './components/pages/NotebooksPage.js';
import { Login } from './components/pages/Login.js';
import { AppsPage } from './components/pages/AppsPage.js';
import { SharedPage } from './components/pages/SharedPage.js';
import { RendererGallery } from './components/pages/RendererGallery.js';
import { useUiStore } from './store/uiStore.js';
import { useAuthStore } from './store/authStore.js';
import { useAppLocation } from './hooks/useAppLocation.js';

function App() {
  const activeTab = useUiStore((s) => s.activeTab);

  // The URL owns which section is showing and which notebook is open.
  const { notebookId, openNotebook, closeNotebook } = useAppLocation();

  const token = useAuthStore((s) => s.token);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const isCreator = useAuthStore((s) => s.user?.role) === 'creator';

  // Auto verify session on mount
  useEffect(() => {
    if (token) {
      checkAuth();
    }
  }, [token, checkAuth]);

  // A shared notebook page, opened by someone with no account. Checked before the login
  // gate, because the token in the URL *is* the account.
  const path = window.location.pathname;
  const sharedToken = path.startsWith('/a/') ? path.slice(3) : null;
  if (sharedToken) return <SharedPage token={sharedToken} />;

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
        {activeTab === 'apps' && <AppsPage />}
        {activeTab === 'map' && <SystemMap onOpenNotebook={openNotebook} />}
        {/* A typed `#/notebooks` from a viewer lands on Apps rather than on an editor whose
            every save comes back 403. The navbar already hides these; this is the URL. */}
        {activeTab === 'notebooks' &&
          (isCreator ? (
            <NotebooksPage
              notebookId={notebookId}
              onOpenNotebook={openNotebook}
              onCloseNotebook={closeNotebook}
            />
          ) : (
            <AppsPage />
          ))}
        {activeTab === 'resources' && (isCreator ? <ResourcesPage /> : <AppsPage />)}
        {activeTab === 'gallery' && <RendererGallery />}
      </main>
    </div>
  );
}

export default App;
