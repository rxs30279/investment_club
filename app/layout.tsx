import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import AuthGuard from '@/components/AuthGuard';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MESI Investment Portfolio',
  description: 'UK stock portfolio tracker for investment club',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <noscript>
          <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#fff', fontFamily: 'sans-serif', textAlign: 'center', padding: '2rem' }}>
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>JavaScript Required</h1>
              <p style={{ color: '#9ca3af' }}>Please enable JavaScript in your browser to access the MESI Investment Dashboard.</p>
            </div>
          </div>
        </noscript>
        <AuthGuard>
          {children}
        </AuthGuard>
        <Analytics />
      </body>
    </html>
  );
}