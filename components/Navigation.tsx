'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/history', label: 'History', icon: '📈' },
  { href: '/holdings', label: 'Holdings', icon: '📋' },
  { href: '/performance', label: 'Unit Performance', icon: '📊' },
  { href: '/portfolio-performance', label: 'Stock Performance', icon: '📈' },
  { href: '/minutes', label: 'Minutes', icon: '📝' },
  { href: '/treasurer', label: 'Treasurer', icon: '💰' },
  { href: '/manage', label: 'Manage', icon: '⚙️' },
];

export default function Navigation() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Desktop nav — only shown on large screens */}
        <div className="hidden lg:flex space-x-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`py-4 px-2 inline-flex items-center gap-1.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-700'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Mobile nav bar — shown below lg breakpoint */}
        <div className="lg:hidden flex items-center justify-between h-14">
          {/* Show current page name */}
          <div className="flex items-center gap-2">
            {(() => {
              const current = navItems.find(i => i.href === pathname);
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
        </div>
      )}
    </nav>
  );
}
