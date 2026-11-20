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

  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const isCreator = useAuthStore((s) => s.user?.role) === 'creator';

  // Ask the engine who this browser is. The session is an HttpOnly cookie this script
  // cannot see, so `/api/auth/me` is the only way to know whether there is one.
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // A shared notebook page, opened by someone with no account. Checked before the login
  // gate, because the token in the URL *is* the account.
  const path = window.location.pathname;
  const sharedToken = path.startsWith('/a/') ? path.slice(3) : null;
  if (sharedToken) return <SharedPage token={sharedToken} />;

  // Nothing is known yet: neither the login form nor the app would be the right thing
  // to flash for the length of one request.
  if (!user && !checked) return null;

  // Enforce authentication for the manager app
  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Top navbar */}
      <Navbar />

      {/* Main content area */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'apps' && <AppsPage />}
        {/* `#/map/<id>` opens the map already inside that notebook. Keyed on the id so
            arriving from the editor re-enters even when the map was already mounted. */}
        {activeTab === 'map' && (
          <SystemMap key={notebookId ?? 'system'} openInside={notebookId} onOpenNotebook={openNotebook} />
        )}
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
