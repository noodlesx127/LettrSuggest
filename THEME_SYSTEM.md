# Theme System Documentation

## Overview
LettrSuggest now includes a comprehensive theming system with dark mode support and customizable darkness levels.

## Features

### Theme Modes
- **System**: Automatically follows your operating system's theme preference
- **Light**: Always uses light mode
- **Dark**: Always uses dark mode

### Darkness Levels (Dark Mode Only)
When dark mode is active, you can choose from 4 darkness levels:

1. **Soft** (Gray 700 base)
   - Gentle dark mode with lighter grays
   - Best for: Reduced eye strain in low light
   - Background: `rgb(55, 65, 81)`

2. **Moderate** (Gray 800 base) - *Default*
   - Balanced dark mode
   - Best for: General use, most versatile
   - Background: `rgb(31, 41, 55)`

3. **Deep** (Gray 900 base)
   - Darker backgrounds for immersion
   - Best for: Late-night viewing, focused work
   - Background: `rgb(17, 24, 39)`

4. **Pitch Black** (True Black)
   - True black backgrounds
   - Best for: OLED screens, battery saving, maximum contrast
   - Background: `rgb(0, 0, 0)`

## User Interface

### Settings Page
Access theme controls at `/settings`:
- Theme mode selection (System/Light/Dark)
- Darkness level selector (when dark mode is active)
- Visual preview swatches
- Auto-save to user preferences

### Navigation Bar Updates
- **Settings Link**: Prominent gear icon button
  - Desktop: Shows "Settings" text with icon
  - Mobile: Shows icon only
  - Styled with gray background for visibility

- **Profile/Email Link**: Enhanced with user icon
  - Desktop: Shows email address with user icon
  - Mobile: Shows user icon only
  - Styled with blue accent for prominence

## Technical Implementation

### Files Created/Modified

#### New Files
- `src/lib/themeStore.tsx` - Theme context provider and state management
- `src/app/settings/page.tsx` - Settings UI page
- `supabase/migrations/20251213000000_user_settings.sql` - Database migration

#### Modified Files
- `src/app/layout.tsx` - Wrapped with ThemeProvider
- `src/app/globals.css` - Added dark mode CSS variables
- `src/components/NavBar.tsx` - Enhanced settings/profile links
- `src/app/page.tsx` - Added dark mode support
- `tailwind.config.js` - Enabled class-based dark mode
- `supabase/schema.sql` - Added user_settings table

### Database Schema

```sql
create table public.user_settings (
  user_id uuid primary key,
  theme_mode text not null default 'system',
  darkness_level text not null default 'moderate',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
```

### Theme Context API

```typescript
import { useTheme } from '@/lib/themeStore';

function MyComponent() {
  const { 
    mode,              // 'system' | 'light' | 'dark'
    darknessLevel,     // 'soft' | 'moderate' | 'deep' | 'pitch'
    effectiveTheme,    // 'light' | 'dark' (computed)
    setMode,           // (mode: ThemeMode) => void
    setDarknessLevel,  // (level: DarknessLevel) => void
    isLoading          // boolean
  } = useTheme();
  
  // Use theme values...
}
```

### CSS Classes Applied

The theme system applies classes to `<html>`:
- Base: `light` or `dark`
- Darkness: `dark-soft`, `dark-moderate`, `dark-deep`, or `dark-pitch`

Use Tailwind's dark mode variants:
```tsx
<div className="bg-white dark:bg-gray-800">
  <p className="text-gray-900 dark:text-gray-100">
    This text adapts to the theme
  </p>
</div>
```

## User Flow

1. User clicks **Settings** link in navbar (gear icon)
2. Navigates to `/settings` page
3. Selects theme mode (System/Light/Dark)
4. If dark mode: Selects darkness level
5. Preferences automatically saved to Supabase
6. Theme applies instantly across all pages
7. Preferences persist across sessions and devices

## System Theme Detection

When "System" mode is selected:
- Listens to `prefers-color-scheme` media query
- Updates automatically when OS theme changes
- No page reload required

## Best Practices

### For Developers

1. **Always use Tailwind dark mode variants**:
   ```tsx
   className="bg-white dark:bg-gray-800"
   ```

2. **Test all darkness levels**:
   - Ensure content is readable in all 4 darkness modes
   - Check contrast ratios for accessibility

3. **Use semantic colors**:
   ```tsx
   // Good
   className="text-gray-900 dark:text-gray-100"
   
   // Avoid
   className="text-black dark:text-white"
   ```

4. **Transition colors smoothly**:
   ```tsx
   className="transition-colors"
   ```

### For Users

1. **Choose based on environment**:
   - Bright room: Light mode or System
   - Dark room: Dark mode (any level)
   - OLED device: Pitch Black for battery savings

2. **Adjust darkness to preference**:
   - Eye strain: Soft or Moderate
   - Immersion: Deep or Pitch Black
   - Battery saving: Pitch Black (OLED only)

## Accessibility

- All color combinations meet WCAG AA contrast requirements
- Theme changes don't cause flash/flicker
- System preferences respected by default
- Settings are keyboard accessible

## Future Enhancements

Potential additions:
- [ ] Custom accent colors
- [ ] Schedule-based theme switching
- [ ] Per-page theme overrides
- [ ] High contrast mode
- [ ] Custom darkness level (slider)
- [ ] Export/import theme preferences

## Troubleshooting

**Theme not saving**: Check Supabase connection and RLS policies

**Flash of wrong theme**: Add `suppressHydrationWarning` to `<html>` tag (already implemented)

**Darkness level not applying**: Ensure you're in dark mode first

**System theme not detecting**: Check browser support for `prefers-color-scheme`
