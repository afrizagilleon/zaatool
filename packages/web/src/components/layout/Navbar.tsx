import {
  Sun,
  Moon,
  Spinner,
  Sparkle,
  FloppyDisk,
  RocketLaunch,
  SignOut,
  User as UserIcon,
} from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore.js';
import { useFlowStore } from '../../store/flowStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs.js';
import { useNavbarActions } from '../../hooks/useNavbarActions.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog.js';

const navTabs = [
  { id: 'workflows' as const, label: 'Workflows', disabled: false },
  { id: 'editor' as const, label: 'Editor', disabled: false },
  { id: 'resources' as const, label: 'Resources', disabled: false },
  { id: 'deploys' as const, label: 'Dashboard', disabled: false },
] as const;

export function Navbar() {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const isAiPanelOpen = useUiStore((s) => s.isAiPanelOpen);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);

  const flowName = useFlowStore((s) => s.name);
  const setFlowName = useFlowStore((s) => s.setFlowName);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      setFlowName(tempName.trim());
    }
    setIsEditingName(false);
  };

  const { isSaving, save, load } = useNavbarActions();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    // Initial auto-load
    load();
  }, [load]);

  return (
    <header
      id="navbar"
      className="flex h-11 items-center border-b border-border bg-background/80 backdrop-blur-sm px-3 gap-1 shrink-0 z-50"
    >
      {/* Logo */}
      <div id="navbar-logo" className="flex items-center gap-2 mr-3 select-none">
        <div className="flex items-center justify-center w-6 h-6 bg-primary/15">
          <span className="text-[11px] font-black tracking-tighter text-primary leading-none">
            z
          </span>
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground">
          zaa
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-border mr-1" />

      {/* Current Workflow Label */}
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

      {/* Center: Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val: string) => setActiveTab(val as any)}
        className="w-[380px]"
      >
        <TabsList className="grid w-full grid-cols-4 h-7 p-0.5">
          {navTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs h-6" disabled={tab.disabled}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Storage Actions */}
      <div className="flex items-center gap-1 mr-2">
        <Button
          onClick={save}
          disabled={isSaving}
          variant="ghost"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isSaving ? (
            <Spinner size={14} className="animate-spin mr-1.5" />
          ) : (
            <FloppyDisk size={14} className="mr-1.5" />
          )}
          Save
        </Button>

        <div className="h-4 w-px bg-border mx-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground relative group"
          disabled
        >
          <RocketLaunch size={16} className="mr-1.5" />
          Deploy
          <span className="absolute -top-1 -right-2 text-[8px] bg-primary/20 text-primary px-1 font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            SOON
          </span>
        </Button>

        <div className="h-4 w-px bg-border mx-1" />
      </div>

      {/* AI Assistant toggle */}
      <Button
        id="navbar-toggle-ai"
        onClick={toggleAiPanel}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 mr-1',
          isAiPanelOpen ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
        )}
        title="Toggle AI Assistant"
      >
        <Sparkle size={15} weight="duotone" />
      </Button>

      {/* Dark mode toggle */}
      <Button
        id="navbar-theme-toggle"
        onClick={toggleDarkMode}
        variant="ghost"
        size="icon"
        className="w-7 h-7 text-muted-foreground"
        title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDarkMode ? <Sun size={15} weight="duotone" /> : <Moon size={15} weight="duotone" />}
      </Button>

      {/* User profile & Logout */}
      {user && (
        <>
          <div className="h-4 w-px bg-border mx-1" />
          <div className="flex items-center gap-2 pl-1">
            <button
              onClick={() => setIsProfileOpen(true)}
              className="text-[11px] font-semibold text-zinc-300 max-w-[80px] truncate hover:text-primary hover:underline transition-all outline-none bg-transparent border-none p-0 cursor-pointer"
              title="View User Profile"
            >
              {user.username}
            </button>
            <Button
              onClick={logout}
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-red-400 hover:text-red-300 hover:bg-red-950/20 rounded-md"
              title="Logout"
            >
              <SignOut size={14} weight="bold" />
            </Button>
          </div>

          {/* User Profile Dialog */}
          <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
            <DialogContent className="max-w-md bg-card border border-border text-card-foreground p-6 rounded-xl shadow-2xl">
              <DialogHeader className="pb-4 border-b border-border/50">
                <DialogTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                  <UserIcon size={16} className="text-primary" weight="duotone" />
                  User Profile
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Your account details and system privileges.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4 space-y-4 text-xs">
                <div className="flex justify-between items-center py-2 border-b border-border/20">
                  <span className="text-muted-foreground font-medium">Username</span>
                  <span className="font-bold text-foreground">{user.username}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/20">
                  <span className="text-muted-foreground font-medium">Email Address</span>
                  <span className="font-semibold text-foreground">{user.email || "N/A"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/20">
                  <span className="text-muted-foreground font-medium">System Role</span>
                  <span className="font-bold px-2 py-0.5 rounded bg-primary/10 text-primary uppercase text-[10px]">
                    {user.role || "viewer"}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button size="sm" onClick={() => setIsProfileOpen(false)} className="h-8 text-xs">
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </header>
  );
}
