'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Home', icon: null },
  { href: '/performance', label: 'Unit Performance', icon: null },
  { href: '/portfolio-performance', label: 'Stock Performance', icon: null },
  { href: '/holdings', label: '52-Week', icon: null },
  { href: '/watchlist', label: 'Watchlist', icon: null },
  { href: '/monthly-brief', label: 'Monthly Brief', icon: null },
  { href: '/competition', label: 'Competition', icon: null },
  { href: 'https://app.alphamoveai.co.uk', label: 'AlphaMove AI', icon: null, external: true },
];

const adminItems = [
  { href: '/minutes', label: 'Minutes', icon: null },
  { href: '/treasurer', label: 'Treasurer', icon: null },
  { href: '/portfolio-fees', label: 'Fees & Divs', icon: null },
  { href: '/income', label: 'Income', icon: null },
  { href: '/manage', label: 'Manage', icon: '⚙️' },
];

const allItems = [...navItems, ...adminItems];

export default function Navigation() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);

  const adminActive = adminItems.some(i => i.href === pathname);

  // Close the desktop Admin dropdown when clicking outside it
  useEffect(() => {
    if (!adminOpen) return;
    const handler = (e: MouseEvent) => {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [adminOpen]);

  const handleLogout = () => {
    localStorage.removeItem('global_auth');
    sessionStorage.removeItem('manage_auth');
    window.location.href = '/';
  };

  const desktopLinkClass = (isActive: boolean) =>
    `py-4 px-1.5 inline-flex items-center gap-1 border-b-2 text-sm font-medium transition-colors whitespace-nowrap ${
      isActive
        ? 'border-emerald-500 text-emerald-400'
        : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-700'
    }`;

  return (
    <nav className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Desktop nav — only shown on large screens */}
        <div className="hidden lg:flex items-center gap-x-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={desktopLinkClass(isActive)}
                >
                  {item.icon && <span>{item.icon}</span>}
                  {item.label}
                </a>
              );
            }
            return (
              <Link key={item.href} href={item.href} className={desktopLinkClass(isActive)}>
                {item.icon && <span>{item.icon}</span>}
                {item.label}
              </Link>
            );
          })}

          {/* Admin dropdown */}
          <div ref={adminRef} className="relative">
            <button
              onClick={() => setAdminOpen(v => !v)}
              className={desktopLinkClass(adminActive)}
              aria-haspopup="true"
              aria-expanded={adminOpen}
            >
              Admin
              <svg
                className={`w-4 h-4 transition-transform ${adminOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {adminOpen && (
              <div className="absolute left-0 top-full min-w-[12rem] rounded-lg border border-gray-800 bg-gray-900/95 backdrop-blur-sm shadow-xl py-1 z-50">
                {adminItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setAdminOpen(false)}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="ml-4 py-1.5 px-3 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg transition-colors whitespace-nowrap"
          >
            Sign out
          </button>
        </div>

        {/* Mobile nav bar — shown below lg breakpoint */}
        <div className="lg:hidden flex items-center justify-between h-14">
          {/* Show current page name */}
          <div className="flex items-center gap-2">
            {(() => {
              const current = allItems.find(i => i.href === pathname);
              return current ? (
                <>
                  <span className="text-lg">{current.icon}</span>
                  <span className="text-white font-medium text-sm">{current.label}</span>
                </>
              ) : (
                <span className="text-white font-medium text-sm">MESI</span>
              );
            })()}
          </div>

          {/* Hamburger / close button */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="lg:hidden border-t border-gray-800 bg-gray-900/95 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 py-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const className = `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`;
              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className={className}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.label}
                  </a>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={className}
                >
                  <span className="text-lg">{item.icon}</span>
                  {item.label}
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </Link>
              );
            })}

            {/* Admin group */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Admin
              </p>
              {adminItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.label}
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </Link>
                );
              })}
            </div>

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
