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

const themeInitScript = `(() => {
  try {
    const storedMode = localStorage.getItem('theme_mode');
    const storedDarkness = localStorage.getItem('darkness_level');
    const mode = storedMode === 'light' || storedMode === 'dark' || storedMode === 'system' ? storedMode : 'system';
    const darkness = ['soft', 'moderate', 'deep', 'pitch'].includes(storedDarkness || '') ? storedDarkness : 'moderate';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'dark-soft', 'dark-moderate', 'dark-deep', 'dark-pitch');
    root.classList.add(effective);
    if (effective === 'dark') {
      root.classList.add('dark-' + darkness);
    }
  } catch (err) {
    console.warn('[Theme] pre-hydration apply failed', err);
  }
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
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
