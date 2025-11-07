import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ImportDataProvider } from '@/lib/importStore';

export const metadata: Metadata = {
  title: 'LettrSuggest',
  description: 'Personalized movie suggestions and stats from your Letterboxd data',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="border-b bg-white">
          <nav className="mx-auto max-w-6xl px-4 py-3 flex gap-4 items-center">
            <a href="/" className="font-semibold">LettrSuggest</a>
            <a href="/import" className="text-sm text-gray-600 hover:text-gray-900">Import</a>
            <a href="/library" className="text-sm text-gray-600 hover:text-gray-900">Library</a>
            <a href="/suggest" className="text-sm text-gray-600 hover:text-gray-900">Suggestions</a>
            <a href="/stats" className="text-sm text-gray-600 hover:text-gray-900">Stats</a>
            <a href="/admin" className="ml-auto text-sm text-gray-600 hover:text-gray-900">Admin</a>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          <ImportDataProvider>{children}</ImportDataProvider>
        </main>
      </body>
    </html>
  );
}
