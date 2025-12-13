'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type ThemeMode = 'system' | 'light' | 'dark';
export type DarknessLevel = 'soft' | 'moderate' | 'deep' | 'pitch';

interface ThemeSettings {
  mode: ThemeMode;
  darknessLevel: DarknessLevel;
}

interface ThemeContextValue {
  mode: ThemeMode;
  darknessLevel: DarknessLevel;
  effectiveTheme: 'light' | 'dark'; // The actual computed theme
  setMode: (mode: ThemeMode) => void;
  setDarknessLevel: (level: DarknessLevel) => void;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const DARKNESS_LEVELS: DarknessLevel[] = ['soft', 'moderate', 'deep', 'pitch'];

const readInitialMode = (): ThemeMode => {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem('theme_mode');
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

const readInitialDarkness = (): DarknessLevel => {
  if (typeof window === 'undefined') return 'moderate';
  const stored = window.localStorage.getItem('darkness_level');
  return DARKNESS_LEVELS.includes(stored as DarknessLevel) ? (stored as DarknessLevel) : 'moderate';
};

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readInitialMode());
  const [darknessLevel, setDarknessLevelState] = useState<DarknessLevel>(() => readInitialDarkness());
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Determine effective theme based on mode and system preference
  useEffect(() => {
    const updateEffectiveTheme = () => {
      if (mode === 'system') {
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setEffectiveTheme(systemPrefersDark ? 'dark' : 'light');
      } else {
        setEffectiveTheme(mode);
      }
    };

    updateEffectiveTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => updateEffectiveTheme();
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, [mode]);

  // Load theme settings from Supabase on mount
  useEffect(() => {
    async function loadThemeSettings() {
      if (!supabase) {
        setIsLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUserId(session.user.id);

          const { data, error } = await supabase
            .from('user_settings')
            .select('theme_mode, darkness_level')
            .eq('user_id', session.user.id)
            .single();

          if (data && !error) {
            const nextMode = (data.theme_mode as ThemeMode) || 'system';
            const nextDarkness = (data.darkness_level as DarknessLevel) || 'moderate';
            setModeState(nextMode);
            setDarknessLevelState(nextDarkness);
            window.localStorage.setItem('theme_mode', nextMode);
            window.localStorage.setItem('darkness_level', nextDarkness);
          }
        }
      } catch (error) {
        console.error('[Theme] Error loading settings:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadThemeSettings();
  }, []);

  // Save theme settings to Supabase
  const saveSettings = async (settings: Partial<ThemeSettings>) => {
    if (!supabase || !userId) return;

    try {
      await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          theme_mode: settings.mode ?? mode,
          darkness_level: settings.darknessLevel ?? darknessLevel,
          updated_at: new Date().toISOString(),
        });
    } catch (error) {
      console.error('[Theme] Error saving settings:', error);
    }
  };

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('theme_mode', newMode);
    }
    void saveSettings({ mode: newMode });
  };

  const setDarknessLevel = (newLevel: DarknessLevel) => {
    setDarknessLevelState(newLevel);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('darkness_level', newLevel);
    }
    void saveSettings({ darknessLevel: newLevel });
  };

  // Apply theme classes to document element
  useEffect(() => {
    const root = document.documentElement;
    
    // Remove all theme classes
    root.classList.remove('light', 'dark', 'dark-soft', 'dark-moderate', 'dark-deep', 'dark-pitch');
    
    // Add effective theme
    root.classList.add(effectiveTheme);
    
    // Add darkness level class if dark mode
    if (effectiveTheme === 'dark') {
      root.classList.add(`dark-${darknessLevel}`);
    }
  }, [effectiveTheme, darknessLevel]);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        darknessLevel,
        effectiveTheme,
        setMode,
        setDarknessLevel,
        isLoading,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
