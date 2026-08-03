import { Sun, Moon, SignOut, List, User as UserIcon } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { Button } from '../ui/button.js';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import type { LocationTab } from '../../lib/app-location.js';

/**
 * Apps first, and it is also where the app opens.
 *
 * The order is the order of use: what the workspace *serves*, then how it fits together,
 * then where it is written, then what it is written with. Workflows used to sit first and
 * open by default, which meant the retired canvas was the front door for months.
 */
const navTabs = [
  { id: 'apps' as const, label: 'Apps' },
  { id: 'map' as const, label: 'Map' },
  { id: 'notebooks' as const, label: 'Notebooks' },
  { id: 'resources' as const, label: 'Resources' },
] as const;

export function Navbar() {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const activeLabel = navTabs.find((tab) => tab.id === activeTab)?.label ?? 'Menu';

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

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
        <span className="text-sm font-bold tracking-tight text-foreground">zaa</span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-border mr-1" />

      {/* Section switcher. Collapses to a menu where four tabs would crowd the actions
          on the right. Same list, same state, one source. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            title="Go to section"
          >
            <List size={15} className="mr-1.5" />
            {activeLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup
            value={activeTab}
            onValueChange={(val: string) => setActiveTab(val as LocationTab)}
          >
            {navTabs.map((tab) => (
              <DropdownMenuRadioItem key={tab.id} value={tab.id}>
                {tab.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tabs
        value={activeTab}
        onValueChange={(val: string) => setActiveTab(val as LocationTab)}
        className="hidden lg:block w-[380px]"
      >
        <TabsList className="grid w-full grid-cols-4 h-7 p-0.5">
          {navTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs h-6">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Spacer */}
      <div className="flex-1" />

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
              className="text-[11px] font-semibold text-muted-foreground max-w-[110px] truncate hover:text-primary hover:underline transition-all outline-none bg-transparent border-none p-0 cursor-pointer"
              title={`${user.username} — view profile`}
            >
              {user.username}
            </button>
            <Button
              onClick={logout}
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-destructive hover:bg-destructive/10 rounded-md"
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
                  <span className="font-semibold text-foreground">{user.email || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/20">
                  <span className="text-muted-foreground font-medium">System Role</span>
                  <span className="font-bold px-2 py-0.5 rounded bg-primary/10 text-primary uppercase text-[10px]">
                    {user.role || 'viewer'}
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
