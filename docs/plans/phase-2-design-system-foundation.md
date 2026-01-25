# Phase 2: Design System Foundation - Implementation Plan

**Project:** LettrSuggest  
**Phase:** 2 - Design System Foundation (Extended Library)  
**Estimated Effort:** 12-15 hours  
**Dependencies:** Phase 0 ✅, Phase 1 ✅  
**Status:** In Progress

---

## Executive Summary

This plan creates a comprehensive design system foundation for LettrSuggest, transforming it from "developer UI" to a polished, professional movie recommendation app. The design system will establish:

1. **Core Primitives** - Button, Card, Input components with variants
2. **Extended Components** - Badge, Tabs, Modal, Dropdown, Toast
3. **Design Tokens** - Color system, typography scale, spacing rhythm
4. **Icon System** - Consistent SVG icons with standardized usage
5. **Dark Mode Architecture** - CSS variables replacing 200 lines of overrides

**Key Benefits:**

- Consistent visual language across all pages
- Faster feature development with reusable components
- Easier maintenance with centralized design decisions
- Better accessibility with built-in WCAG compliance
- Professional polish that matches user expectations for movie apps

---

## Implementation Tasks

### Task 2.1: Design Tokens & Tailwind Config

**Owner:** typescript-pro  
**Effort:** 1.5 hours  
**Status:** Pending

**Files to Create:**

- `src/lib/design-tokens.ts`

**Files to Modify:**

- `tailwind.config.js`
- `src/app/globals.css`

**Deliverables:**

- Brand color palette (violet-based)
- Typography scale
- Spacing tokens
- CSS variables for dark mode
- Reduced globals.css from 200 → 120 lines

---

### Task 2.2: Core Components - Button, Card, Input

**Owner:** ui-designer + react-specialist  
**Effort:** 2 hours  
**Status:** Pending

**Files to Create:**

- `src/components/ui/Button.tsx`
- `src/components/ui/Card.tsx`
- `src/components/ui/Input.tsx`
- `src/components/ui/index.ts`

**Deliverables:**

- Button: 5 variants, 3 sizes, loading states
- Card: 5 variants with gradient support
- Input: Labels, error states, icons
- Full TypeScript types
- Touch targets minimum 44px

---

### Task 2.3: Extended Components - Badge, Tabs, Icon

**Owner:** ui-designer + react-specialist  
**Effort:** 2 hours  
**Status:** Pending

**Files to Create:**

- `src/components/ui/Badge.tsx`
- `src/components/ui/Tabs.tsx`
- `src/components/ui/Icon.tsx`

**Deliverables:**

- Badge: 6 semantic variants
- Tabs: Composition API for Stats page
- Icon: Standardized SVG library

---

### Task 2.4: Modal, Dropdown, Toast

**Owner:** ui-designer + react-specialist  
**Effort:** 2 hours  
**Status:** Pending

**Files to Create:**

- `src/components/ui/Modal.tsx`
- `src/components/ui/Dropdown.tsx`
- `src/components/ui/Toast.tsx`

**Deliverables:**

- Modal: Focus trap, ESC key, backdrop
- Dropdown: Keyboard navigation, search
- Toast: Stacking, auto-dismiss

---

### Task 2.5: Typography Components & Fonts

**Owner:** ui-designer + nextjs-developer  
**Effort:** 1 hour  
**Status:** Pending

**Files to Create:**

- `src/components/ui/Typography.tsx`

**Files to Modify:**

- `src/app/layout.tsx`

**Deliverables:**

- Outfit (sans) and Crimson Pro (serif) fonts
- Display, Heading, Body, Caption components

---

### Task 2.6: Documentation & Component Preview

**Owner:** ui-designer  
**Effort:** 1.5 hours  
**Status:** Pending

**Files to Create:**

- `docs/design-system.md`
- `src/app/test/design-system/page.tsx`

**Deliverables:**

- Component documentation
- Interactive preview page
- Migration guide

---

### Task 2.7: Refactor 3 Examples

**Owner:** react-specialist  
**Effort:** 2 hours  
**Status:** Pending

**Files to Modify:**

- `src/components/NavBar.tsx`
- `src/components/AuthGate.tsx`
- `src/app/page.tsx`

**Deliverables:**

- NavBar using Button, Icon components
- AuthGate using Card, Button, Typography
- Home page using Button variants
- Before/after comparison documented

---

### Task 2.8: Code Review & Polish

**Owner:** code-reviewer  
**Effort:** 1 hour  
**Status:** Pending

**Deliverables:**

- Accessibility audit (WCAG 2.1 AA)
- Keyboard navigation verification
- Performance check
- Final sign-off

---

## Design Specifications

### Color System (Violet Brand)

```
brand-500: #a855f7 (Primary)
brand-600: #9333ea (Primary darker)
success: #059669 (Emerald)
warning: #d97706 (Amber)
danger: #dc2626 (Red)
info: #2563eb (Blue)
```

### Typography Scale

```
Display: 3rem / bold (Hero text)
H1: 1.875rem / bold (Page titles)
H2: 1.25rem / semibold (Section headers)
Body: 0.875rem / normal (Body text)
Caption: 0.75rem / medium (Labels)
```

### Fonts

- **Sans:** Outfit (UI, buttons, body)
- **Serif:** Crimson Pro (Movie titles, emphasis)

---

## Success Criteria

- ✅ All 10 components implemented with TypeScript types
- ✅ Component test page shows all variants
- ✅ 3 example components refactored successfully
- ✅ WCAG 2.1 AA compliance verified
- ✅ Documentation complete
- ✅ Dark mode CSS reduced from 200 → 120 lines

---

**Created:** 2026-01-25  
**Last Updated:** 2026-01-25
