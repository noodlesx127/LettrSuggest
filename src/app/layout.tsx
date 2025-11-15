import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ImportDataProvider } from '@/lib/importStore';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'LettrSuggest',
  description: 'Personalized movie suggestions and stats from your Letterboxd data',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <NavBar />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <ImportDataProvider>{children}</ImportDataProvider>
        </main>
      </body>
    </html>
  );
}
