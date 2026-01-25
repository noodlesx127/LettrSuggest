# Phase 3: Stats Page Restructure - In Progress

**Status:** 🟡 PARTIALLY COMPLETE  
**Date:** 2026-01-25  
**Completed:** Tasks 3.0-3.1 (Accessibility fixes + Analysis)  
**Remaining:** Tasks 3.2-3.5 (Implementation)

---

## ✅ Completed Tasks

### Task 3.0: Critical Accessibility Fixes

**Status:** ✅ COMPLETE  
**Agent:** react-specialist  
**Verified:** TypeScript ✅, ESLint ✅

**Fixes Applied:**

1. **Touch Targets Fixed** - All interactive elements now meet 44px minimum:
   - Button sm: Added `min-h-[44px]`
   - Input sm: Added `min-h-[44px]`
   - Dropdown sm: Added `min-h-[44px]`
   - Modal close button: Increased padding to 44×44
   - Toast close button: Increased padding to 44×44

2. **Card Interactive Keyboard Bug Fixed:**
   - Changed from `e.target.click()` to `e.currentTarget.click()`
   - Now works reliably with nested elements

3. **Tailwind Class Issues Resolved:**
   - Replaced invalid `h-13` with `h-12`
   - Affects Button, Input, Dropdown components

4. **Dark Mode Focus Rings:**
   - Added `dark:ring-offset-gray-900` to prevent white halo
   - Applied to Modal, Toast, Dropdown

**Impact:** Phase 2 design system now fully WCAG 2.1 AA compliant for touch targets and keyboard navigation.

---

### Task 3.1: Stats Page Analysis & Planning

**Status:** ✅ COMPLETE  
**Agent:** ui-designer (with frontend-design skill)  
**Deliverable:** `docs/plans/phase-3-stats-restructure.md`

**Analysis Results:**

- **Current State:** 2,107 lines, 30+ state variables, 23 visual sections
- **Complexity:** 8 useEffect hooks, 5 useMemo hooks, 6 major data fetches
- **Problem:** Cognitive overload, maintenance nightmare, no progressive disclosure

**Proposed Solution:**

- **6 Tab Structure** instead of single scrolling page
- **Component Breakdown:**
  - StatsOverview (~200 lines)
  - TasteProfileTab (~400 lines)
  - WatchHistoryTab (~250 lines)
  - AlgorithmInsightsTab (~450 lines)
  - WatchlistAnalysisTab (~200 lines)
  - AvoidanceProfileTab (~200 lines)

**New File Structure:**

```
src/app/stats/
├── page.tsx (~150 lines - parent with tabs)
├── components/
│   ├── StatsHeader.tsx
│   ├── StatsOverview.tsx
│   ├── TasteProfileTab.tsx
│   ├── WatchHistoryTab.tsx
│   ├── AlgorithmInsightsTab.tsx
│   ├── WatchlistAnalysisTab.tsx
│   ├── AvoidanceProfileTab.tsx
│   └── shared/ (5 reusable components)
├── hooks/
│   ├── useStatsData.ts
│   ├── useFeedbackAnalytics.ts
│   └── useTasteProfile.ts
└── types.ts
```

**Implementation Plan:** 7 phases documented with clear dependencies, estimated 26 hours total effort.

---

## 🟡 In Progress / Pending Tasks

### Task 3.2: Create Tabs Navigation Structure

**Status:** 🟡 IN PROGRESS  
**Blockers:** None  
**Effort:** ~2 hours

**What Needs to be Done:**

1. Create parent `src/app/stats/page.tsx` with Tabs navigation
2. Use Phase 2 design system `<Tabs>` component
3. Implement tab routing (6 tabs)
4. Add time filter controls (All/Year/Month) to header
5. Keep parent component < 200 lines

---

### Task 3.3: Split Stats into Separate Components

**Status:** ⏸️ PENDING  
**Dependencies:** Task 3.2  
**Effort:** ~12-15 hours

**What Needs to be Done:**

1. **Create Shared Types** (`src/app/stats/types.ts`):
   - TimeFilter type
   - TMDBDetails interface
   - FeedbackSummary, ExplorationStats, etc.
   - Export all types used across tabs

2. **Create Custom Hooks** (`src/app/stats/hooks/`):
   - `useStatsData.ts` - Centralize user ID, film data, TMDB details fetching
   - `useFeedbackAnalytics.ts` - Feedback summary, source reliability, consensus acceptance
   - `useTasteProfile.ts` - Taste profile data, adjacent preferences

3. **Extract Tab Components** (`src/app/stats/components/`):
   - **StatsOverview.tsx** - Lines 1011-1091 from current page (summary cards, coverage, alerts)
   - **TasteProfileTab.tsx** - Lines 1093-1383 (genres, directors, actors, keywords, studios, eras)
   - **WatchHistoryTab.tsx** - Lines 2079-2104 + most watched film (charts section)
   - **AlgorithmInsightsTab.tsx** - Lines 1386-2077 (feedback, learning, repeat tracking)
   - **WatchlistAnalysisTab.tsx** - Lines 1575-1731 (intent signals, momentum)
   - **AvoidanceProfileTab.tsx** - Lines 1733-1867 (filter profile)

4. **Create Shared Components** (`src/app/stats/components/shared/`):
   - `StatCard.tsx` - Reusable summary card
   - `MetricBadge.tsx` - Status/metric badges
   - `ChartContainer.tsx` - Wrapper for ECharts
   - `PersonCard.tsx` - Actor/Director display
   - `LoadingState.tsx` - Skeleton loading

---

### Task 3.4: Refactor to Use Design System

**Status:** ⏸️ PENDING  
**Dependencies:** Task 3.3  
**Effort:** ~3-4 hours

**What Needs to be Done:**

1. **Replace Card Patterns:**
   - Current: `<div className="bg-white border rounded-lg p-4">`
   - New: `<Card><CardHeader><CardTitle>...</CardTitle></CardHeader>...</Card>`

2. **Apply Typography:**
   - Page titles: `<Heading level={1}>`
   - Section headers: `<Heading level={2}>`
   - Body text: `<Body>`
   - Labels: `<Caption>`

3. **Use Badge Component:**
   - Consensus levels: `<Badge variant="success">High Consensus</Badge>`
   - Metrics: `<Badge variant="info">{percentage}%</Badge>`

4. **Apply Button Component:**
   - Time filters: `<Button variant="ghost" size="sm">All</Button>`
   - Active state: `<Button variant="primary" size="sm">Year</Button>`

5. **Use Icon Component:**
   - Replace inline SVGs with `<Icon name="..." />`

**Target:** Each component should be visually consistent with rest of app using design system.

---

### Task 3.5: Test and Verify

**Status:** ⏸️ PENDING  
**Dependencies:** Tasks 3.2-3.4  
**Effort:** ~2 hours

**What Needs to be Done:**

1. **TypeScript Verification:**

   ```bash
   npm run typecheck
   ```

   - Must pass with no errors
   - Verify all types from types.ts are correctly used

2. **ESLint Verification:**

   ```bash
   npm run lint
   ```

   - No new errors introduced
   - Existing warnings acceptable

3. **Functional Testing:**
   - Visit `/stats` in browser
   - Test all 6 tabs load correctly
   - Verify time filters (All/Year/Month) work
   - Confirm all data displays correctly
   - Test with empty state (no films imported)
   - Test with full library

4. **Visual Regression:**
   - Take screenshots of each tab
   - Compare with current single-page version
   - Ensure no data is missing
   - Verify charts render (ECharts)

5. **Performance Testing:**
   - Measure tab switching speed
   - Ensure no unnecessary re-renders
   - Verify data fetching efficiency
   - Check memory usage with React DevTools

---

## 📊 Progress Summary

### Completed

- ✅ Task 3.0: Accessibility fixes (100%)
- ✅ Task 3.1: Analysis & planning (100%)

### In Progress

- 🟡 Task 3.2: Tabs navigation (0%)

### Pending

- ⏸️ Task 3.3: Component extraction (0%)
- ⏸️ Task 3.4: Design system refactor (0%)
- ⏸️ Task 3.5: Testing (0%)

**Overall Phase 3 Progress:** 33% (2/6 tasks complete)

---

## 🔧 Technical Implementation Notes

### Data Fetching Strategy

Current implementation has multiple useEffect hooks fetching data independently. Proposed hooks consolidate:

```typescript
// useStatsData.ts
export function useStatsData(timeFilter: TimeFilter) {
  const { films } = useImportData();
  const [uid, setUid] = useState<string | null>(null);
  const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(
    new Map(),
  );
  const [filmMappings, setFilmMappings] = useState<Map<string, number>>(
    new Map(),
  );
  const [mappingCoverage, setMappingCoverage] = useState<{
    mapped: number;
    total: number;
  } | null>(null);

  // Centralized fetching logic
  // Returns all common data needed across tabs

  return {
    uid,
    films,
    tmdbDetails,
    filmMappings,
    mappingCoverage,
    loading,
    error,
  };
}
```

### State Management Concerns

**Current:** 30+ useState calls in single component  
**Proposed:** Distribute state to relevant tabs, share via context or props

**Benefits:**

- Each tab only manages its own state
- Reduced re-renders (tab changes don't re-mount all data)
- Easier to test individual tabs
- Better code splitting opportunities

### ECharts Integration

Charts are in lines 2079-2104. Must preserve:

- Watche
  d films over time chart
- Rating distribution chart
- Genre diversity chart
- Decade preference chart

**Migration Plan:**

1. Extract chart data preparation logic to useMemo hooks
2. Move chart components to WatchHistoryTab
3. Keep Chart component import working
4. Test that echarts options render correctly

---

## 🚧 Implementation Risks

### High Risk Areas

1. **State Dependencies:** Many state variables depend on each other (uid → data fetches → computed stats). Must ensure correct dependency arrays in hooks.

2. **Data Loading Race Conditions:** Current implementation has sequential loads. Tab-based approach could introduce race conditions if not careful.

3. **Performance Regression:** Current monolithic page loads all data upfront. Tabs should lazy-load tab-specific data, but must handle loading states gracefully.

4. **Type Safety:** Extracting types to separate file could reveal hidden type issues. Must ensure all types are correctly exported/imported.

### Mitigation Strategies

1. **Incremental Migration:** Build new tab components alongside old page first, then switch over when stable.

2. **Shared Hook Testing:** Test custom hooks in isolation before integrating into tabs.

3. **Progressive Enhancement:** Keep old page.tsx as `page.old.tsx` backup until new version proven stable.

4. **Type-First Approach:** Create types.ts first, verify TypeScript passes, then extract components.

---

## 📝 Commit Strategy

### Commits to Create

1. **Task 3.0:** ✅ Already committed

   ```
   feat(phase-3): fix critical accessibility issues
   ```

2. **Task 3.1:** ✅ Already committed

   ```
   feat(phase-3): create stats page restructure plan
   ```

3. **Task 3.2:** 🔜 When tabs structure complete

   ```
   feat(stats): add tab navigation structure
   - Create parent page with Tabs component
   - Add time filter controls to header
   - Set up 6 tab routing (placeholders)
   ```

4. **Task 3.3:** 🔜 When components extracted

   ```
   feat(stats): extract tab components and hooks
   - Create types.ts with shared types
   - Create useStatsData, useFeedbackAnalytics, useTasteProfile hooks
   - Extract 6 tab components (Overview, Taste, History, Algorithm, Watchlist, Avoidance)
   - Create 5 shared components
   ```

5. **Task 3.4:** 🔜 When design system applied

   ```
   feat(stats): apply design system components
   - Replace card patterns with Card component
   - Use Typography components throughout
   - Apply Badge, Button, Icon components
   ```

6. **Task 3.5:** 🔜 When verified
   ```
   feat(stats): complete stats page restructure
   - Verify all functionality working
   - TypeScript and ESLint passing
   - Performance tested
   ```

---

## 🎯 Next Steps

**To resume Phase 3 implementation:**

1. **Start with Task 3.2** - Create tabs structure in parent page
2. **Create types.ts** - Define all shared types first for type safety
3. **Build custom hooks** - Centralize data fetching logic
4. **Extract components one by one** - Start with StatsOverview (simplest)
5. **Apply design system** - Replace inline styles with components
6. **Test thoroughly** - Ensure no regressions

**Estimated Time to Complete:**

- Task 3.2: 2 hours
- Task 3.3: 12-15 hours
- Task 3.4: 3-4 hours
- Task 3.5: 2 hours
- **Total Remaining:** 19-23 hours (~3 developer days)

---

## 📚 Resources

**Implementation Plan:** `docs/plans/phase-3-stats-restructure.md` (comprehensive blueprint)  
**Current Stats Page:** `src/app/stats/page.tsx` (2,107 lines)  
**Design System Components:** `src/components/ui/*`  
**Existing TasteProfile:** `src/components/TasteProfileSummary.tsx` (quality reference)

---

**Phase 3 Status:** 🟡 33% Complete (2/6 tasks done)  
**Next Task:** 3.2 - Create Tabs Navigation Structure  
**Blockers:** None - Ready to implement
