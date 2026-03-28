'use client';

import { useState, useEffect } from 'react';

interface PasswordProtectProps {
  children: React.ReactNode;
  pageName?: string;
}

const SITE_PASSWORD = 'MESI2026'; // Change this to your club password

export default function PasswordProtect({ children, pageName = 'this page' }: PasswordProtectProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    // Check if already authenticated in this session
    const auth = sessionStorage.getItem('club_auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === SITE_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem('club_auth', 'true');
      setError(false);
    } else {
      setError(true);
      setPassword('');
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-6 sm:p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="text-xl font-bold text-white">Protected Page</h2>
          <p className="text-gray-400 text-sm mt-1">
            Please enter the password to access {pageName}
          </p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
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
            Access Page
          </button>
        </form>
        
        <div className="mt-4 text-center">
          <a href="/" className="text-gray-500 hover:text-gray-400 text-sm">
            ← Return to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}