import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ImportDataProvider } from '@/lib/importStore';
import { ThemeProvider } from '@/lib/themeStore';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'LettrSuggest',
  description: 'Personalized movie suggestions and stats from your Letterboxd data',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors">
        <ThemeProvider>
          <NavBar />
          <main className="mx-auto max-w-6xl px-4 py-6">
            <ImportDataProvider>{children}</ImportDataProvider>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
