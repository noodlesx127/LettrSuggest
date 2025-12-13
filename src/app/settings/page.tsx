'use client';
import { useState, useEffect } from 'react';
import AuthGate from '@/components/AuthGate';
import { useTheme, ThemeMode, DarknessLevel } from '@/lib/themeStore';

const DARKNESS_LEVELS: { value: DarknessLevel; label: string; description: string }[] = [
  { value: 'soft', label: 'Soft', description: 'Gentle dark mode with lighter grays' },
  { value: 'moderate', label: 'Moderate', description: 'Balanced dark mode (default)' },
  { value: 'deep', label: 'Deep', description: 'Darker backgrounds for immersion' },
  { value: 'pitch', label: 'Pitch Black', description: 'True black for OLED screens' },
];

export default function SettingsPage() {
  const { mode, darknessLevel, effectiveTheme, setMode, setDarknessLevel, isLoading } = useTheme();
  const [saving, setSaving] = useState(false);

  const handleModeChange = async (newMode: ThemeMode) => {
    setSaving(true);
    setMode(newMode);
    setTimeout(() => setSaving(false), 300);
  };

  const handleDarknessChange = async (newLevel: DarknessLevel) => {
    setSaving(true);
    setDarknessLevel(newLevel);
    setTimeout(() => setSaving(false), 300);
  };

  return (
    <AuthGate>
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Settings</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-8">
          Customize your LettrSuggest experience
        </p>

        {/* Theme Settings Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-2xl">🎨</span>
            Appearance
          </h2>

          {/* Theme Mode Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
              Theme Mode
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['system', 'light', 'dark'] as ThemeMode[]).map((themeMode) => (
                <button
                  key={themeMode}
                  onClick={() => handleModeChange(themeMode)}
                  disabled={isLoading}
                  className={`
                    relative p-4 rounded-lg border-2 transition-all
                    ${mode === themeMode
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="text-center">
                    <div className="text-2xl mb-2">
                      {themeMode === 'system' && '💻'}
                      {themeMode === 'light' && '☀️'}
                      {themeMode === 'dark' && '🌙'}
                    </div>
                    <div className="font-medium text-sm capitalize text-gray-900 dark:text-gray-100">
                      {themeMode}
                    </div>
                    {mode === themeMode && (
                      <div className="absolute top-2 right-2 text-blue-500">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {mode === 'system' && `Using ${effectiveTheme} mode based on your system preference`}
              {mode !== 'system' && `Currently using ${mode} mode`}
            </p>
          </div>

          {/* Darkness Level Selection (only shown in dark mode) */}
          {effectiveTheme === 'dark' && (
            <div>
              <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                Dark Mode Intensity
              </label>
              <div className="space-y-3">
                {DARKNESS_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => handleDarknessChange(level.value)}
                    disabled={isLoading}
                    className={`
                      w-full p-4 rounded-lg border-2 transition-all text-left
                      ${darknessLevel === level.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }
                      ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
                          {level.label}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {level.description}
                        </div>
                      </div>
                      {/* Preview swatch */}
                      <div className={`
                        w-12 h-12 rounded-lg border border-gray-300 dark:border-gray-600
                        ${level.value === 'soft' && 'bg-gray-700'}
                        ${level.value === 'moderate' && 'bg-gray-800'}
                        ${level.value === 'deep' && 'bg-gray-900'}
                        ${level.value === 'pitch' && 'bg-black'}
                      `} />
                      {darknessLevel === level.value && (
                        <div className="ml-3 text-blue-500">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Save indicator */}
          {saving && (
            <div className="mt-4 text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Saving...
            </div>
          )}
        </div>

        {/* Additional Settings Sections (placeholder for future expansion) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-2xl">⚙️</span>
            More Settings Coming Soon
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Additional preferences and customization options will be added here.
          </p>
        </div>
      </div>
    </AuthGate>
  );
}
