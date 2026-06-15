import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Key, User, Envelope, SignIn, UserPlus } from '@phosphor-icons/react';

export function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const login = useAuthStore((s) => s.login);
  const registerUser = useAuthStore((s) => s.registerUser);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [localError, setLocalError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!username.trim() || !password.trim()) {
      setLocalError('Please fill in all fields.');
      return;
    }

    await login(username.trim(), password);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      setLocalError('Please fill in all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    const success = await registerUser(username.trim(), password, email.trim() || undefined);
    if (success) {
      setRegisterSuccess(true);
      // Reset registration form
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setEmail('');
      setTimeout(() => {
        setRegisterSuccess(false);
        setIsRegister(false);
      }, 1500);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-black to-zinc-950 text-foreground px-4">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-zinc-800/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md bg-zinc-950/80 backdrop-blur-xl border border-zinc-800/60 rounded-2xl p-8 shadow-2xl relative z-10 transition-all duration-300 hover:border-zinc-700/60">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-primary to-zinc-800 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20 mb-4 animate-pulse">
            <span className="text-3xl font-extrabold text-white tracking-wider">Z</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            Welcome to ZaaTool
          </h1>
          <p className="text-xs text-zinc-500 mt-2 font-medium">
            Manage, schedule, and secure your automation flows
          </p>
        </div>

        {/* Error Banners */}
        {(localError || error) && (
          <div className="mb-6 p-3 bg-red-950/40 border border-red-900/50 text-red-400 rounded-lg text-xs font-semibold text-center animate-shake">
            {localError || error}
          </div>
        )}

        <form onSubmit={handleLoginSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Username
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-3.5 h-4.5 w-4.5 text-zinc-500" />
              <Input
                id="username"
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-10 h-11 text-white bg-zinc-900/60 border-zinc-800 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 rounded-xl"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Password
            </Label>
            <div className="relative">
              <Key className="absolute left-3 top-3.5 h-4.5 w-4.5 text-zinc-500" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 h-11 text-white bg-zinc-900/60 border-zinc-800 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 rounded-xl"
                disabled={isLoading}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-white text-zinc-950 hover:bg-zinc-200 transition-colors font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-white/5"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <SignIn weight="bold" className="w-4.5 h-4.5" />
                Sign In
              </>
            )}
          </Button>
        </form>

        <div className="mt-8 border-t border-zinc-900 pt-6 text-center">
          <p className="text-xs text-zinc-500">
            Don't have an account?{' '}
            <button
              onClick={() => {
                setLocalError(null);
                clearError();
                setIsRegister(true);
              }}
              className="text-white hover:underline font-semibold cursor-pointer"
            >
              Register User
            </button>
          </p>
        </div>
      </div>

      {/* Registration Dialog */}
      <Dialog open={isRegister} onOpenChange={setIsRegister}>
        <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-white">Create Administrator Account</DialogTitle>
            <DialogDescription className="text-zinc-500 text-xs">
              Register a new user to access and modify workflows.
            </DialogDescription>
          </DialogHeader>

          {registerSuccess ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-12 h-12 bg-green-950/40 border border-green-900/50 rounded-full flex items-center justify-center text-green-400 mx-auto text-xl">
                ✓
              </div>
              <p className="text-sm text-green-400 font-semibold">User registered successfully!</p>
            </div>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-4 py-2">
              {(localError || error) && (
                <div className="p-3 bg-red-950/40 border border-red-900/50 text-red-400 rounded-lg text-xs text-white font-semibold text-center">
                  {localError || error}
                </div>
              )}

              <div className="space-y-2 text-white">
                <Label htmlFor="reg-username" className="text-xs text-zinc-400">Username *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4.5 w-4.5 text-zinc-500" />
                  <Input
                    id="reg-username"
                    type="text"
                    required
                    placeholder="Admin username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10 h-10 bg-zinc-900/60 border-zinc-800"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-email" className="text-xs text-zinc-400">Email Address</Label>
                <div className="relative">
                  <Envelope className="absolute left-3 top-3 h-4.5 w-4.5 text-zinc-500" />
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="admin@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-10 bg-zinc-900/60 border-zinc-800 text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-password" className="text-xs text-zinc-400">Password *</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-3 h-4.5 w-4.5 text-zinc-500" />
                  <Input
                    id="reg-password"
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 h-10 bg-zinc-900/60 border-zinc-800 text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-confirm" className="text-xs text-zinc-400">Confirm Password *</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-3 h-4.5 w-4.5 text-zinc-500" />
                  <Input
                    id="reg-confirm"
                    type="password"
                    required
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 h-10 bg-zinc-900/60 border-zinc-800 text-white"
                  />
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRegister(false)}
                  className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-white text-zinc-950 hover:bg-zinc-200 font-bold flex items-center gap-1.5"
                  disabled={isLoading}
                >
                  <UserPlus weight="bold" className="w-4 h-4" />
                  Register
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
