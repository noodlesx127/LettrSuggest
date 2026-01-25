# LettrSuggest Design System

A comprehensive design system for the LettrSuggest movie recommendation application. Built with React, TypeScript, and Tailwind CSS, this system provides consistent, accessible, and beautiful UI components.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Getting Started](#getting-started)
3. [Design Tokens](#design-tokens)
4. [Typography](#typography)
5. [Components](#components)
   - [Button](#button)
   - [Card](#card)
   - [Input](#input)
   - [Badge](#badge)
   - [Tabs](#tabs)
   - [Modal](#modal)
   - [Dropdown](#dropdown)
   - [Toast](#toast)
   - [Icon](#icon)
6. [Patterns & Composition](#patterns--composition)
7. [Accessibility](#accessibility)
8. [Dark Mode](#dark-mode)
9. [Animation](#animation)
10. [Best Practices](#best-practices)
11. [Migration Guide](#migration-guide)

---

## Philosophy

The LettrSuggest design system is built on three core principles:

### 1. Cinematic Elegance

Movie-focused interfaces deserve special treatment. We use serif fonts for movie titles (Crimson Pro), subtle gradients that evoke film aesthetics, and a violet/purple brand color that feels premium without being garish.

### 2. Accessible by Default

Every component ships with proper ARIA attributes, keyboard navigation, focus management, and sufficient color contrast. Accessibility is not an afterthought.

### 3. Composition Over Configuration

Components are designed to compose naturally. Cards have CardHeader, CardContent, CardFooter. Tabs use TabsList, TabsTrigger, TabsContent. This pattern allows flexible layouts without complex prop APIs.

---

## Getting Started

### Installation

All components are located in `src/components/ui/`. Import directly:

```tsx
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input, SearchInput } from "@/components/ui/Input";
```

### Required Setup

1. **Tailwind Configuration**: Ensure `tailwind.config.js` includes the extended theme (already configured)
2. **Toast Provider**: Wrap your app with `ToastProvider` for toast notifications
3. **Fonts**: The system uses `Outfit` (sans-serif) and `Crimson Pro` (serif) fonts

```tsx
// app/layout.tsx
import { ToastProvider } from "@/components/ui/Toast";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
```

---

## Design Tokens

Design tokens are the atomic values that define the visual language. They live in `src/lib/design-tokens.ts` and are mirrored in `tailwind.config.js`.

### Colors

#### Brand Colors

The primary brand is a violet/purple gradient scale:

| Token       | Value     | Usage                   |
| ----------- | --------- | ----------------------- |
| `brand-50`  | `#faf5ff` | Subtle backgrounds      |
| `brand-100` | `#f3e8ff` | Hover states            |
| `brand-200` | `#e9d5ff` | Light accents           |
| `brand-300` | `#d8b4fe` | Secondary elements      |
| `brand-400` | `#c084fc` | Interactive elements    |
| `brand-500` | `#a855f7` | **Primary brand color** |
| `brand-600` | `#9333ea` | Hover states            |
| `brand-700` | `#7e22ce` | Active states           |
| `brand-800` | `#6b21a8` | Dark mode primary       |
| `brand-900` | `#581c87` | Dark accents            |

#### Semantic Colors

```typescript
// Success - for positive feedback, high ratings
success: { light: '#10b981', DEFAULT: '#059669', dark: '#047857' }

// Warning - for mixed reviews, caution states
warning: { light: '#f59e0b', DEFAULT: '#d97706', dark: '#b45309' }

// Danger - for errors, destructive actions
danger: { light: '#ef4444', DEFAULT: '#dc2626', dark: '#b91c1c' }

// Info - for informational messages
info: { light: '#3b82f6', DEFAULT: '#2563eb', dark: '#1d4ed8' }
```

### Spacing Scale

Based on a 4px unit system:

| Token | Value     | Pixels |
| ----- | --------- | ------ |
| `xs`  | `0.25rem` | 4px    |
| `sm`  | `0.5rem`  | 8px    |
| `md`  | `0.75rem` | 12px   |
| `lg`  | `1rem`    | 16px   |
| `xl`  | `1.5rem`  | 24px   |
| `2xl` | `2rem`    | 32px   |
| `3xl` | `3rem`    | 48px   |

### Border Radius

| Token  | Value            | Usage                           |
| ------ | ---------------- | ------------------------------- |
| `sm`   | `0.375rem` (6px) | Small elements                  |
| `md`   | `0.5rem` (8px)   | Inputs, small cards             |
| `lg`   | `0.75rem` (12px) | Cards, panels                   |
| `xl`   | `1rem` (16px)    | **Default for most components** |
| `2xl`  | `1.5rem` (24px)  | Large containers                |
| `full` | `9999px`         | Pills, badges                   |

### Shadows

| Token      | Description                         |
| ---------- | ----------------------------------- |
| `sm`       | Subtle shadow for elevated elements |
| `md`       | Default card shadow                 |
| `lg`       | Dropdown, modal shadows             |
| `xl`       | Large modal shadows                 |
| `2xl`      | High emphasis elements              |
| `brand`    | Colored shadow with violet tint     |
| `brand-lg` | Large brand shadow for CTAs         |

---

## Typography

Typography components provide semantic and styled text elements.

### Type Scale

| Style     | Size            | Line Height | Weight | Usage                    |
| --------- | --------------- | ----------- | ------ | ------------------------ |
| `display` | 3rem (48px)     | 1.1         | 700    | Hero text, landing pages |
| `h1`      | 1.875rem (30px) | 1.2         | 700    | Page titles              |
| `h2`      | 1.25rem (20px)  | 1.3         | 600    | Section headers          |
| `h3`      | 1rem (16px)     | 1.4         | 600    | Card headers             |
| `body`    | 0.875rem (14px) | 1.5         | 400    | Paragraphs, content      |
| `caption` | 0.75rem (12px)  | 1.4         | 500    | Labels, metadata         |

### Typography Components

```tsx
import { Display, Heading, Body, Caption, MovieTitle } from '@/components/ui/Typography';

// Hero text
<Display>Welcome to LettrSuggest</Display>

// Page and section headings
<Heading level={1}>Your Movie Recommendations</Heading>
<Heading level={2}>Based on Your Taste</Heading>
<Heading level={3}>Action Films</Heading>

// Body text
<Body>Discover personalized movie recommendations based on your Letterboxd ratings.</Body>

// Metadata
<Caption>Updated 2 hours ago</Caption>

// Movie titles (uses Crimson Pro serif font)
<MovieTitle>The Shawshank Redemption</MovieTitle>
```

### Font Families

- **Sans-serif (Outfit)**: Primary UI font for headings, buttons, labels
- **Serif (Crimson Pro)**: Movie titles, giving them a classic cinematic feel

```css
font-sans: var(--font-outfit), system-ui, sans-serif
font-serif: var(--font-crimson), Georgia, serif
```

---

## Components

### Button

Primary interactive element with multiple variants and states.

#### Props

| Prop        | Type                                                           | Default     | Description                         |
| ----------- | -------------------------------------------------------------- | ----------- | ----------------------------------- |
| `variant`   | `'primary' \| 'secondary' \| 'ghost' \| 'danger' \| 'success'` | `'primary'` | Visual style                        |
| `size`      | `'sm' \| 'md' \| 'lg'`                                         | `'md'`      | Button size                         |
| `loading`   | `boolean`                                                      | `false`     | Shows spinner, disables interaction |
| `icon`      | `ReactNode`                                                    | -           | Left icon                           |
| `rightIcon` | `ReactNode`                                                    | -           | Right icon                          |
| `fullWidth` | `boolean`                                                      | `false`     | Expands to container width          |
| `href`      | `string`                                                       | -           | Renders as anchor tag               |

#### Variants

- **Primary**: Gradient background (violet to fuchsia), white text, brand shadow
- **Secondary**: Gray background, dark text, subtle border
- **Ghost**: Transparent, text only, hover reveals background
- **Danger**: Red gradient, for destructive actions
- **Success**: Green gradient, for confirmations

#### Usage

```tsx
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

// Primary action
<Button variant="primary" icon={<Icon name="suggest" size="sm" />}>
  Get Recommendations
</Button>

// Loading state
<Button loading>Processing...</Button>

// Destructive action
<Button variant="danger" icon={<Icon name="trash" size="sm" />}>
  Remove from Watchlist
</Button>

// Link button
<Button variant="ghost" href="/settings">
  Settings
</Button>
```

---

### Card

Container component for grouping related content. Supports composition pattern.

#### Props

| Prop       | Type                                                                   | Default     | Description                |
| ---------- | ---------------------------------------------------------------------- | ----------- | -------------------------- |
| `variant`  | `'default' \| 'gradient' \| 'outlined' \| 'interactive' \| 'elevated'` | `'default'` | Visual style               |
| `padding`  | `'none' \| 'sm' \| 'md' \| 'lg'`                                       | `'md'`      | Internal padding           |
| `gradient` | `'brand' \| 'success' \| 'warning' \| 'info' \| 'danger'`              | `'brand'`   | Color for gradient variant |

#### Composition Components

- `CardHeader` - Top section with bottom border
- `CardTitle` - Heading within header
- `CardContent` - Main content area with top padding
- `CardFooter` - Bottom section with top border, flexbox layout

#### Usage

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

// Simple card
<Card>
  <p>Card content goes here</p>
</Card>

// Composed card
<Card variant="elevated">
  <CardHeader>
    <CardTitle>Your Top Genres</CardTitle>
  </CardHeader>
  <CardContent>
    <p>Drama, Thriller, Sci-Fi</p>
  </CardContent>
  <CardFooter>
    <Button variant="secondary" size="sm">View All</Button>
  </CardFooter>
</Card>

// Interactive card (clickable)
<Card variant="interactive" onClick={() => navigate('/movie/123')}>
  <MovieTitle>Inception</MovieTitle>
  <p>A mind-bending thriller...</p>
</Card>

// Featured card with gradient
<Card variant="gradient" gradient="brand" padding="lg">
  <h2 className="text-white text-xl">Premium Feature</h2>
</Card>
```

---

### Input

Text input with label, validation states, icons, and helper text.

#### Props

| Prop         | Type                   | Default | Description                          |
| ------------ | ---------------------- | ------- | ------------------------------------ |
| `label`      | `string`               | -       | Label text above input               |
| `error`      | `string`               | -       | Error message (triggers error state) |
| `helperText` | `string`               | -       | Helper text below input              |
| `icon`       | `ReactNode`            | -       | Left icon                            |
| `inputSize`  | `'sm' \| 'md' \| 'lg'` | `'md'`  | Input size                           |
| `fullWidth`  | `boolean`              | `false` | Expands to container width           |

#### Variants

- **Input**: Standard text input
- **SearchInput**: Pre-configured with search icon

#### Usage

```tsx
import { Input, SearchInput } from '@/components/ui/Input';

// Basic input with label
<Input
  label="Email address"
  type="email"
  placeholder="you@example.com"
/>

// With error state
<Input
  label="Username"
  error="Username is already taken"
  value={username}
  onChange={(e) => setUsername(e.target.value)}
/>

// With helper text
<Input
  label="Letterboxd Username"
  helperText="We'll import your ratings from your public profile"
/>

// Search input
<SearchInput
  placeholder="Search movies..."
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  fullWidth
/>
```

---

### Badge

Status indicators, labels, and tags.

#### Props

| Prop      | Type                                                                     | Default     | Description              |
| --------- | ------------------------------------------------------------------------ | ----------- | ------------------------ |
| `variant` | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'default'` | Color scheme             |
| `size`    | `'sm' \| 'md' \| 'lg'`                                                   | `'md'`      | Badge size               |
| `icon`    | `ReactNode`                                                              | -           | Left icon                |
| `dot`     | `boolean`                                                                | `false`     | Shows pulsing status dot |

#### Usage

```tsx
import { Badge } from '@/components/ui/Badge';

// Status indicators
<Badge variant="success">Certified Fresh</Badge>
<Badge variant="warning">Mixed Reviews</Badge>
<Badge variant="danger">Rotten</Badge>

// With icon
<Badge variant="primary" icon={<Icon name="star" size="xs" />}>
  4.5 Rating
</Badge>

// With status dot
<Badge variant="success" dot>Available Now</Badge>

// Genre tags
<Badge size="sm">Drama</Badge>
<Badge size="sm">Thriller</Badge>
```

---

### Tabs

Tabbed navigation with full keyboard support.

#### Props (Tabs)

| Prop            | Type                      | Default      | Description           |
| --------------- | ------------------------- | ------------ | --------------------- |
| `defaultValue`  | `string`                  | **required** | Initially active tab  |
| `value`         | `string`                  | -            | Controlled active tab |
| `onValueChange` | `(value: string) => void` | -            | Change callback       |

#### Composition Components

- `Tabs` - Root container with context
- `TabsList` - Container for triggers
- `TabsTrigger` - Tab button
- `TabsContent` - Panel content

#### Keyboard Navigation

- **Arrow Left/Right**: Navigate between tabs
- **Home**: Go to first tab
- **End**: Go to last tab
- **Enter/Space**: Activate tab

#### Usage

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

<Tabs defaultValue="recommendations">
  <TabsList>
    <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
    <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
    <TabsTrigger value="history">History</TabsTrigger>
  </TabsList>

  <TabsContent value="recommendations">
    <RecommendationsList />
  </TabsContent>

  <TabsContent value="watchlist">
    <WatchlistContent />
  </TabsContent>

  <TabsContent value="history">
    <ViewingHistory />
  </TabsContent>
</Tabs>;
```

---

### Modal

Accessible dialog with focus trap, ESC close, and portal rendering.

#### Props

| Prop                  | Type                                     | Default      | Description                  |
| --------------------- | ---------------------------------------- | ------------ | ---------------------------- |
| `isOpen`              | `boolean`                                | **required** | Controls visibility          |
| `onClose`             | `() => void`                             | **required** | Close callback               |
| `title`               | `string`                                 | -            | Modal title                  |
| `description`         | `string`                                 | -            | Subtitle text                |
| `size`                | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | `'md'`       | Modal width                  |
| `showCloseButton`     | `boolean`                                | `true`       | Show X button                |
| `closeOnOverlayClick` | `boolean`                                | `true`       | Close when clicking backdrop |
| `closeOnEsc`          | `boolean`                                | `true`       | Close on Escape key          |

#### Features

- Focus trap keeps keyboard navigation within modal
- Focus returns to trigger element on close
- Body scroll is disabled while open
- Rendered via React Portal

#### Usage

```tsx
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

function ConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Delete Movie</Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Delete from Watchlist?"
        description="This action cannot be undone."
        size="sm"
      >
        <div className="flex gap-3 justify-end mt-4">
          <Button variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </>
  );
}
```

---

### Dropdown

Select/combobox with search, single/multi-select, and keyboard navigation.

#### Props

| Prop          | Type                   | Default       | Description               |
| ------------- | ---------------------- | ------------- | ------------------------- |
| `options`     | `DropdownOption[]`     | **required**  | Available options         |
| `value`       | `string \| string[]`   | -             | Selected value(s)         |
| `onChange`    | `(value) => void`      | **required**  | Selection callback        |
| `placeholder` | `string`               | `'Select...'` | Placeholder text          |
| `searchable`  | `boolean`              | `false`       | Enable search filtering   |
| `multiple`    | `boolean`              | `false`       | Allow multiple selections |
| `size`        | `'sm' \| 'md' \| 'lg'` | `'md'`        | Trigger size              |

#### DropdownOption Type

```typescript
interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}
```

#### Keyboard Navigation

- **Arrow Up/Down**: Navigate options
- **Enter/Space**: Select option
- **Escape**: Close dropdown
- **Home/End**: Jump to first/last option
- **Type to search**: When searchable is enabled

#### Usage

```tsx
import { Dropdown } from '@/components/ui/Dropdown';

// Single select
<Dropdown
  options={[
    { value: 'recent', label: 'Recently Watched' },
    { value: 'rating', label: 'Rating (High to Low)' },
    { value: 'title', label: 'Title A-Z' },
  ]}
  value={sortBy}
  onChange={setSortBy}
  placeholder="Sort by..."
/>

// Multi-select with search
<Dropdown
  options={genres}
  value={selectedGenres}
  onChange={setSelectedGenres}
  multiple
  searchable
  placeholder="Filter by genre..."
/>
```

---

### Toast

Notification system with provider pattern and convenience methods.

#### Setup

Wrap your app with `ToastProvider`:

```tsx
import { ToastProvider } from "@/components/ui/Toast";

function App() {
  return <ToastProvider>{children}</ToastProvider>;
}
```

#### Hook API

```tsx
import { useToast } from "@/components/ui/Toast";

function MyComponent() {
  const { toast } = useToast();

  // Convenience methods
  toast.success("Changes saved!");
  toast.error("Failed to save", "Please try again");
  toast.warning("Rate limit approaching");
  toast.info("New recommendations available");

  // Full control
  toast({
    variant: "success",
    title: "Movie Added",
    description: "Added to your watchlist",
    duration: 3000, // ms, 0 for no auto-dismiss
  });
}
```

#### Features

- Auto-dismiss with progress bar
- Pause timer on hover
- Maximum 3 toasts visible
- Slide-in/out animations
- Accessible with ARIA live regions

---

### Icon

SVG icon library with 40+ icons using Heroicons style.

#### Props

| Prop   | Type                                   | Default      | Description     |
| ------ | -------------------------------------- | ------------ | --------------- |
| `name` | `IconName`                             | **required** | Icon identifier |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'sm'`       | Icon size       |

#### Sizes

| Size | Dimensions |
| ---- | ---------- |
| `xs` | 12px       |
| `sm` | 16px       |
| `md` | 20px       |
| `lg` | 24px       |
| `xl` | 32px       |

#### Available Icons

**Navigation**: `home`, `library`, `suggest`, `stats`, `settings`

**Actions**: `search`, `filter`, `close`, `check`, `trash`, `edit`, `plus`, `minus`, `refresh`, `download`, `upload`

**Status**: `star`, `star-filled`, `heart`, `heart-filled`, `warning`, `info`, `alert`, `check-circle`, `x-circle`

**Media**: `play`, `pause`, `film`, `tv`

**Arrows**: `chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `arrow-right`, `arrow-left`, `arrow-up`, `arrow-down`, `external-link`

**User**: `user`, `user-circle`

**Misc**: `eye`, `eye-slash`, `clock`, `calendar`, `bookmark`, `share`, `menu`, `spinner`

#### Usage

```tsx
import { Icon } from '@/components/ui/Icon';

<Icon name="search" size="sm" />
<Icon name="star-filled" size="md" className="text-yellow-500" />
<Icon name="spinner" size="lg" /> {/* Auto-animates */}
```

---

## Patterns & Composition

### Movie Card Pattern

```tsx
<Card variant="interactive" onClick={() => viewMovie(id)}>
  <img src={posterUrl} alt={title} className="w-full rounded-lg" />
  <MovieTitle className="mt-3">{title}</MovieTitle>
  <Caption>
    {year} • {director}
  </Caption>
  <div className="flex gap-2 mt-2">
    <Badge variant="success" size="sm">
      {rating}
    </Badge>
    {genres.slice(0, 2).map((g) => (
      <Badge key={g} size="sm">
        {g}
      </Badge>
    ))}
  </div>
</Card>
```

### Form Pattern

```tsx
<Card>
  <CardHeader>
    <CardTitle>Import Your Data</CardTitle>
  </CardHeader>
  <CardContent>
    <form className="space-y-4">
      <Input
        label="Letterboxd Username"
        name="username"
        error={errors.username}
      />
      <SearchInput placeholder="Search for a movie to add..." />
    </form>
  </CardContent>
  <CardFooter>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary" loading={isSubmitting}>
      Import
    </Button>
  </CardFooter>
</Card>
```

### Filter Pattern

```tsx
<div className="flex gap-4 flex-wrap">
  <Dropdown
    options={sortOptions}
    value={sortBy}
    onChange={setSortBy}
    placeholder="Sort by"
  />
  <Dropdown
    options={genres}
    value={selectedGenres}
    onChange={setSelectedGenres}
    multiple
    searchable
    placeholder="Genres"
  />
  <Badge variant="primary" dot>
    {filteredCount} results
  </Badge>
</div>
```

---

## Accessibility

### Built-in Features

All components include:

- **ARIA attributes**: Proper roles, labels, and states
- **Keyboard navigation**: Full support for Tab, Arrow, Enter, Escape
- **Focus management**: Visible focus rings, focus trapping in modals
- **Screen reader support**: Announcements for state changes

### Color Contrast

- All text meets WCAG 2.1 AA standards (4.5:1 minimum)
- Interactive elements meet 3:1 contrast ratio
- Focus indicators are visible in both light and dark modes

### Keyboard Shortcuts

| Component | Keys             | Action         |
| --------- | ---------------- | -------------- |
| Button    | Enter, Space     | Activate       |
| Modal     | Escape           | Close          |
| Modal     | Tab              | Cycle focus    |
| Dropdown  | Arrow Up/Down    | Navigate       |
| Dropdown  | Enter            | Select         |
| Dropdown  | Escape           | Close          |
| Tabs      | Arrow Left/Right | Switch tabs    |
| Tabs      | Home/End         | First/Last tab |

---

## Dark Mode

Dark mode is enabled via the `dark` class on the `<html>` element.

### Implementation

All components use Tailwind's dark mode variant:

```tsx
// Light mode first, dark mode override
className = "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";
```

### Color Adjustments

| Element    | Light Mode | Dark Mode  |
| ---------- | ---------- | ---------- |
| Background | `white`    | `gray-800` |
| Text       | `gray-900` | `gray-100` |
| Borders    | `gray-200` | `gray-700` |
| Muted text | `gray-600` | `gray-400` |
| Inputs     | `white`    | `gray-800` |

### Shadows in Dark Mode

Shadows use `dark:shadow-black/20` for deeper, more visible elevation in dark mode.

---

## Animation

### Available Animations

Defined in `tailwind.config.js`:

| Animation    | Duration  | Usage               |
| ------------ | --------- | ------------------- |
| `fade-in`    | 200ms     | General appearance  |
| `fade-in-up` | 200ms     | Dropdowns, tooltips |
| `slide-up`   | 250ms     | Modals              |
| `scale-in`   | 200ms     | Emphasis elements   |
| `shimmer`    | 2s (loop) | Loading skeletons   |

### Usage

```tsx
// Apply directly via className
<div className="animate-fade-in">Content appears smoothly</div>

// Modal uses slide-up automatically
<Modal isOpen={isOpen}>...</Modal>

// Spinner icon auto-animates
<Icon name="spinner" />
```

### Reduced Motion

Consider users who prefer reduced motion:

```tsx
// In components or global styles
@media (prefers-reduced-motion: reduce) {
  .animate-* {
    animation: none;
  }
}
```

---

## Best Practices

### Do

- **Use semantic variants**: `variant="danger"` for destructive actions, not just red buttons
- **Compose components**: Use Card with CardHeader/CardContent/CardFooter for structured layouts
- **Provide loading states**: Use `loading` prop on buttons during async operations
- **Include error messages**: Use Input's `error` prop for form validation
- **Use appropriate sizes**: Match component sizes for visual harmony

### Don't

- **Don't override brand colors inline**: Use the design tokens
- **Don't skip labels**: Always provide labels for inputs (even if visually hidden)
- **Don't disable focus rings**: They're essential for keyboard users
- **Don't use ghost buttons for primary actions**: They lack visual weight
- **Don't nest interactive elements**: No buttons inside clickable cards

### Component Selection Guide

| Need                | Use                            |
| ------------------- | ------------------------------ |
| Primary action      | `<Button variant="primary">`   |
| Secondary action    | `<Button variant="secondary">` |
| Destructive action  | `<Button variant="danger">`    |
| Subtle action       | `<Button variant="ghost">`     |
| Container           | `<Card>`                       |
| Clickable container | `<Card variant="interactive">` |
| Featured content    | `<Card variant="gradient">`    |
| Text input          | `<Input>`                      |
| Search field        | `<SearchInput>`                |
| Single selection    | `<Dropdown>`                   |
| Multiple selection  | `<Dropdown multiple>`          |
| Status indicator    | `<Badge>`                      |
| Navigation          | `<Tabs>`                       |
| Confirmation dialog | `<Modal size="sm">`            |
| Notifications       | `toast.success()` etc.         |

---

## Migration Guide

### From Plain Tailwind

If migrating from raw Tailwind components:

1. **Replace button styles** with `<Button>` component
2. **Replace input groups** with `<Input>` (includes label, error, helper)
3. **Replace modal implementations** with `<Modal>` (handles focus trap, portal)
4. **Replace custom dropdowns** with `<Dropdown>` (keyboard nav included)

### Typography Migration

Replace manual text styles:

```tsx
// Before
<h1 className="text-3xl font-bold tracking-tight">Title</h1>

// After
<Display>Title</Display>
// or
<Heading level={1}>Title</Heading>
```

### Form Migration

```tsx
// Before
<div>
  <label className="block text-sm font-medium mb-1">Email</label>
  <input className="w-full px-4 py-2 border rounded-lg..." />
  {error && <p className="text-red-500 text-sm">{error}</p>}
</div>

// After
<Input
  label="Email"
  type="email"
  error={error}
/>
```

---

## File Reference

| File                               | Description                               |
| ---------------------------------- | ----------------------------------------- |
| `src/lib/design-tokens.ts`         | Token definitions (colors, spacing, etc.) |
| `tailwind.config.js`               | Tailwind theme extensions                 |
| `src/components/ui/Button.tsx`     | Button component                          |
| `src/components/ui/Card.tsx`       | Card + composition components             |
| `src/components/ui/Input.tsx`      | Input + SearchInput                       |
| `src/components/ui/Badge.tsx`      | Badge component                           |
| `src/components/ui/Tabs.tsx`       | Tabs composition components               |
| `src/components/ui/Modal.tsx`      | Modal dialog                              |
| `src/components/ui/Dropdown.tsx`   | Select/combobox                           |
| `src/components/ui/Toast.tsx`      | Toast provider, hook, component           |
| `src/components/ui/Icon.tsx`       | Icon library                              |
| `src/components/ui/Typography.tsx` | Typography components                     |
| `src/lib/cn.ts`                    | Class name utility (clsx wrapper)         |

---

## Version History

- **1.0.0** (January 2026): Initial design system release
  - 10 core components
  - 40+ icons
  - Full dark mode support
  - Accessibility compliant

---

_Built with care for the LettrSuggest team. Questions? Check the test page at `/test/components` for live examples._
