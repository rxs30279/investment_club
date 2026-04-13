'use client';

import { useState, useEffect } from 'react';

const SITE_PASSWORD = 'MESI2026';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const auth = localStorage.getItem('global_auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const handleLogin = (password: string) => {
    if (password === SITE_PASSWORD) {
      localStorage.setItem('global_auth', 'true');
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <>{children}</>;
}

function LoginScreen({ onLogin }: { onLogin: (password: string) => boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onLogin(password)) {
      setError(false);
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-6 sm:p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🔒</div>
          <h1 className="text-2xl font-bold text-white">MESI Investment Club</h1>
          <p className="text-gray-400 text-sm mt-2">
            Please enter the password to access the dashboard
          </p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <input type="hidden" name="username" autoComplete="username" value="member" readOnly />
          <div className="mb-4">
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              autoComplete="current-password"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            {error && (
              <p className="text-red-400 text-sm mt-2">Incorrect password. Please try again.</p>
            )}
          </div>
          <button
            type="submit"
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
          >
            Access Dashboard
          </button>
        </form>
        
        <div className="mt-6 text-center text-xs text-gray-500">
          <p>Authorized members only</p>
        </div>
      </div>
    </div>
  );
}