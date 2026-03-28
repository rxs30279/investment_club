'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/holdings', label: 'Holdings', icon: '📋' },
  { href: '/performance', label: 'Performance', icon: '📈' },
  { href: '/manage', label: 'Manage', icon: '⚙️' },
  { href: '/minutes', label: 'Minutes', icon: '📝' },
  { href: '/treasurer', label: 'Treasurer', icon: '💰' },
];

export default function Navigation() {
  const pathname = usePathname();
  
  return (
    <nav className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 text-sm font-medium transition-colors ${
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
      </div>
    </nav>
  );
}
