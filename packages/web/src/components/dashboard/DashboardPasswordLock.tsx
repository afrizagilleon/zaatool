import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Warning, Eye, EyeSlash } from '@phosphor-icons/react';

interface DashboardPasswordLockProps {
  passwordInput: string;
  setPasswordInput: (val: string) => void;
  showPassword: boolean;
  setShowPassword: (val: boolean) => void;
  lockError: string | null;
  isUnlocking: boolean;
  handleUnlock: (e: React.FormEvent) => void;
}

export function DashboardPasswordLock({
  passwordInput,
  setPasswordInput,
  showPassword,
  setShowPassword,
  lockError,
  isUnlocking,
  handleUnlock,
}: DashboardPasswordLockProps) {
  return (
    <div className="min-h-[75vh] w-full flex items-center justify-center">
      <div className="w-full max-w-md bg-card border border-border text-card-foreground rounded-2xl shadow-2xl p-8 space-y-6 my-12">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Warning size={24} weight="duotone" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Password Protected</h2>
          <p className="text-sm text-muted-foreground">
            This shared dashboard is password protected. Enter the password to access it.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-pass">Password</Label>
            <div className="relative">
              <Input
                id="dashboard-pass"
                type={showPassword ? "text" : "password"}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password..."
                className="h-10 bg-background border-border pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {showPassword ? <EyeSlash size={16} weight="duotone" /> : <Eye size={16} weight="duotone" />}
              </button>
            </div>
          </div>

          {lockError && (
            <p className="text-xs font-semibold text-destructive text-center">
              {lockError}
            </p>
          )}

          <Button
            type="submit"
            className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/95 font-bold"
            disabled={isUnlocking}
          >
            {isUnlocking ? "Unlocking..." : "Unlock Dashboard"}
          </Button>
        </form>
      </div>
    </div>
  );
}
