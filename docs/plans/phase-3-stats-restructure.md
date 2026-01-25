# Phase 3: Stats Page Restructuring Plan

**Created**: 2026-01-25  
**Status**: Draft  
**Priority**: High (Biggest UX pain point identified in Phase 2 review)

---

## Executive Summary

The Stats page (`src/app/stats/page.tsx`) is a **2,108-line monolithic component** with 20+ distinct sections, 30+ state variables, and complex data fetching logic. This creates cognitive overload for users, maintenance difficulties for developers, and prevents proper progressive disclosure of information.

This plan restructures the page into a **tab-based navigation system** with 6 logical groupings, extracting reusable components while preserving all functionality.

---

## 1. Current State Analysis

### File Metrics

| Metric             | Value                       |
| ------------------ | --------------------------- |
| Total Lines        | 2,108                       |
| State Variables    | 30+                         |
| useEffect Hooks    | 8                           |
| useMemo Hooks      | 5                           |
| API/Database Calls | 6 major data fetches        |
| Sections Rendered  | 23 distinct visual sections |

### State Variables Inventory (Lines 33-72)

```typescript
// Core State
const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(new Map());
const [loadingDetails, setLoadingDetails] = useState(false);
const [detailsError, setDetailsError] = useState<string | null>(null);
const [uid, setUid] = useState<string | null>(null);
const [filmMappings, setFilmMappings] = useState<Map<string, number>>(new Map());
const [mappingCoverage, setMappingCoverage] = useState<{ mapped: number; total: number } | null>(null);

// Exploration & Learning State
const [explorationStats, setExplorationStats] = useState<...>();
const [adjacentPrefs, setAdjacentPrefs] = useState<...>();
const [tasteProfileData, setTasteProfileData] = useState<...>();
const [pairwiseStats, setPairwiseStats] = useState<...>();

// Feedback & Analytics State
const [feedbackSummary, setFeedbackSummary] = useState<...>();
const [sourceReliability, setSourceReliability] = useState<...>();
const [sourceReliabilityRecent, setSourceReliabilityRecent] = useState<...>();
const [sourceConsensus, setSourceConsensus] = useState<...>();
const [reasonAcceptance, setReasonAcceptance] = useState<...>();
const [consensusAcceptance, setConsensusAcceptance] = useState<...>();
const [feedbackRows, setFeedbackRows] = useState<...>();
const [repeatSuggestionStats, setRepeatSuggestionStats] = useState<...>();
```

### Section Breakdown with Line Ranges

| #   | Section Name                  | Line Range | Lines | Category       |
| --- | ----------------------------- | ---------- | ----- | -------------- |
| 1   | Time Filter Controls          | 986-1009   | 23    | Header         |
| 2   | Summary Cards (4 cards)       | 1011-1033  | 22    | Overview       |
| 3   | Metadata Coverage             | 1035-1052  | 17    | Quality        |
| 4   | Consensus Strength            | 1054-1072  | 18    | Quality        |
| 5   | Enrichment Warning            | 1074-1091  | 17    | Alerts         |
| 6   | Taste Profile Header          | 1093-1127  | 34    | Taste          |
| 7   | Top Genre Preferences         | 1129-1143  | 14    | Taste          |
| 8   | Top Keywords/Themes           | 1145-1161  | 16    | Taste          |
| 9   | Favorite Directors (Weighted) | 1163-1175  | 12    | Taste          |
| 10  | Favorite Actors (Weighted)    | 1177-1189  | 12    | Taste          |
| 11  | Studio Preferences            | 1191-1234  | 43    | Taste          |
| 12  | Preferred Film Eras           | 1237-1273  | 36    | Taste          |
| 13  | Most Watched Film             | 1276-1285  | 9     | History        |
| 14  | Top Actors Display            | 1306-1333  | 27    | People         |
| 15  | Top Directors Display         | 1335-1362  | 27    | People         |
| 16  | Top Subgenres                 | 1364-1382  | 18    | Taste          |
| 17  | Algorithm Insights            | 1386-1573  | 187   | Algorithm      |
| 18  | Watchlist Analysis            | 1575-1731  | 156   | Watchlist      |
| 19  | Avoidance Profile             | 1733-1867  | 134   | Filters        |
| 20  | Discovery Preferences         | 1869-1943  | 74    | Algorithm      |
| 21  | Pairwise Learning Stats       | 1945-2018  | 73    | Algorithm      |
| 22  | Repeat-Suggestion Tracking    | 2020-2077  | 57    | Algorithm      |
| 23  | Charts (4 charts)             | 2079-2104  | 25    | Visualizations |

### Dependencies Used

```typescript
// External Libraries
import Image from "next/image";
import { useMemo, useState, useEffect } from "react";

// Internal Components
import AuthGate from "@/components/AuthGate";
import Chart from "@/components/Chart";

// State Management
import { useImportData } from "@/lib/importStore";
import { supabase } from "@/lib/supabaseClient";

// Algorithm Functions
import { getRepeatSuggestionStats, buildTasteProfile } from "@/lib/enrich";
import { analyzeSubgenrePatterns } from "@/lib/subgenreDetection";
```

### Data Flow Complexity

```
1. Auth (uid) -> Loads User Session
2. Films (useImportData) -> Filtered by Time
3. Film Mappings -> Loaded from film_tmdb_map table
4. TMDB Details -> Loaded from tmdb_movies cache
5. Taste Profile -> Built using buildTasteProfile()
6. Stats Computed -> useMemo with 150+ lines of calculations
7. Exploration Stats -> Loaded from user_exploration_stats
8. Feedback Data -> Loaded from suggestion_feedback
9. Pairwise Stats -> Loaded from pairwise_events
10. Repeat Stats -> Loaded via getRepeatSuggestionStats()
```

---

## 2. Proposed Tab Structure

### Tab Navigation Design

```
[Overview] [Taste Profile] [Watch History] [Algorithm Insights] [Watchlist] [Settings]
     |            |              |                  |               |           |
  Summary     Preferences     Charts &          Feedback &      Intent &    Quality
  Cards       & People        Timeline          Learning        Filters     & Data
```

### Tab Details

#### Tab 1: Overview

**Purpose**: Quick summary, key metrics at a glance  
**User Goal**: "How does my movie watching look overall?"

| Sections Included                              | Current Lines |
| ---------------------------------------------- | ------------- |
| Summary Cards (Films/Watches/Rating/Watchlist) | 1011-1033     |
| Metadata Coverage                              | 1035-1052     |
| Consensus Strength                             | 1054-1072     |
| Enrichment Warning (if applicable)             | 1074-1091     |
| Most Watched Film                              | 1276-1285     |

**Estimated Component Size**: ~200 lines

---

#### Tab 2: Taste Profile

**Purpose**: What the algorithm learned about user preferences  
**User Goal**: "What patterns define my taste?"

| Sections Included                         | Current Lines |
| ----------------------------------------- | ------------- |
| Taste Profile Header + Strength Breakdown | 1093-1127     |
| Top Genre Preferences (Weighted)          | 1129-1143     |
| Top Keywords/Themes                       | 1145-1161     |
| Favorite Directors (Weighted)             | 1163-1175     |
| Favorite Actors (Weighted)                | 1177-1189     |
| Studio Preferences                        | 1191-1234     |
| Preferred Film Eras                       | 1237-1273     |
| Top Subgenres                             | 1364-1382     |

**Sub-components**: Already has `TasteProfileSummary` component (678 lines) - can reuse patterns

**Estimated Component Size**: ~400 lines

---

#### Tab 3: Watch History

**Purpose**: Visualizations of viewing patterns  
**User Goal**: "When and what have I been watching?"

| Sections Included                   | Current Lines |
| ----------------------------------- | ------------- |
| Top Actors Display (with photos)    | 1306-1333     |
| Top Directors Display (with photos) | 1335-1362     |
| Top Genres Pie Chart                | 2081-2086     |
| Ratings Distribution Bar Chart      | 2088-2091     |
| Films by Release Year Line Chart    | 2093-2096     |
| Films by Decade Bar Chart           | 2098-2101     |

**Estimated Component Size**: ~250 lines

---

#### Tab 4: Algorithm Insights

**Purpose**: Transparency into how recommendations work  
**User Goal**: "How is the algorithm learning from me?"

| Sections Included                           | Current Lines |
| ------------------------------------------- | ------------- |
| Algorithm Insights (hit rate, rewatch rate) | 1386-1573     |
| Consensus Calibration                       | 1432-1452     |
| Per-Source Reliability                      | 1454-1480     |
| Reason Acceptance                           | 1482-1494     |
| Diversity of Accepted                       | 1496-1523     |
| Regret Recovery                             | 1525-1538     |
| Per-Source by Consensus                     | 1540-1571     |
| Discovery Preferences                       | 1869-1943     |
| Pairwise Learning Stats                     | 1945-2018     |
| Repeat-Suggestion Tracking                  | 2020-2077     |

**Estimated Component Size**: ~450 lines

---

#### Tab 5: Watchlist Analysis

**Purpose**: Intent signals from what user wants to watch  
**User Goal**: "What does my watchlist reveal?"

| Sections Included            | Current Lines |
| ---------------------------- | ------------- |
| Watchlist Header & Count     | 1575-1584     |
| Avoidance Overrides          | 1586-1640     |
| Watchlist Momentum (recency) | 1643-1666     |
| Genres You Want              | 1668-1680     |
| Directors You Want           | 1682-1695     |
| Actors You Want              | 1697-1710     |
| Themes You Want              | 1712-1725     |

**Estimated Component Size**: ~200 lines

---

#### Tab 6: Avoidance Profile (or "Filters")

**Purpose**: What's being filtered out of recommendations  
**User Goal**: "What am I avoiding?"

| Sections Included            | Current Lines |
| ---------------------------- | ------------- |
| Avoidance Profile Header     | 1733-1745     |
| Mixed Feelings (Not Avoided) | 1747-1806     |
| Avoided Genres               | 1808-1824     |
| Avoided Themes               | 1826-1841     |
| Avoided Directors            | 1843-1858     |
| Explanation Footer           | 1861-1865     |

**Estimated Component Size**: ~200 lines

---

## 3. Component Breakdown

### New File Structure

```
src/app/stats/
├── page.tsx                     # Parent with tabs, shared state, time filter
├── components/
│   ├── StatsHeader.tsx          # Time filter controls
│   ├── StatsOverview.tsx        # Tab 1: Summary cards, metadata, warnings
│   ├── TasteProfileTab.tsx      # Tab 2: Preferences, genres, people
│   ├── WatchHistoryTab.tsx      # Tab 3: Charts and visualizations
│   ├── AlgorithmInsightsTab.tsx # Tab 4: Feedback, learning, transparency
│   ├── WatchlistAnalysisTab.tsx # Tab 5: Watchlist intent signals
│   ├── AvoidanceProfileTab.tsx  # Tab 6: Filters and mixed feelings
│   └── shared/
│       ├── StatCard.tsx         # Reusable stat display card
│       ├── TagCloud.tsx         # Reusable weighted tag display
│       ├── PersonGrid.tsx       # Actor/Director grid with photos
│       ├── ProgressBar.tsx      # Reusable progress/ratio bar
│       └── SectionCard.tsx      # Consistent section wrapper
├── hooks/
│   ├── useStatsData.ts          # Combined data fetching hook
│   ├── useFeedbackAnalytics.ts  # Feedback-specific calculations
│   └── useTasteProfile.ts       # Taste profile calculations
└── types.ts                     # Shared TypeScript interfaces
```

### Component Specifications

#### 1. `StatsHeader.tsx`

**Lines**: ~50
**Props**:

```typescript
interface StatsHeaderProps {
  timeFilter: TimeFilter;
  onTimeFilterChange: (filter: TimeFilter) => void;
  filmCount: number;
}
```

---

#### 2. `StatsOverview.tsx`

**Lines**: ~200
**Props**:

```typescript
interface StatsOverviewProps {
  stats: {
    watchedCount: number;
    totalWatches: number;
    avgRating: string;
    ratedCount: number;
    watchlistCount: number;
    rewatchedCount: number;
  };
  metadataCoverage: MetadataCoverage | null;
  consensus: ConsensusStats | null;
  mappingCoverage: { mapped: number; total: number } | null;
  mostWatched: Film | null;
  loadingDetails: boolean;
}
```

**Dependencies**: `StatCard`, `SectionCard`

---

#### 3. `TasteProfileTab.tsx`

**Lines**: ~400
**Props**:

```typescript
interface TasteProfileTabProps {
  stats: {
    absoluteFavorites: number;
    highlyRatedCount: number;
    likedCount: number;
    lowRatedButLikedCount: number;
    topGenres: Array<{ name: string; weight: number; count: number }>;
    topKeywords: Array<{ name: string; weight: number }>;
    topDirectors: Array<{
      name: string;
      weight: number;
      count: number;
      profile?: string;
    }>;
    topActors: Array<{
      name: string;
      weight: number;
      count: number;
      profile?: string;
    }>;
    topStudios: Array<[string, number]>;
    studioPreference: { indie: number; major: number; total: number };
    topDecades: Array<[string, number]>;
    topSubgenresList: Array<{ name: string; count: number }>;
  };
  loadingDetails: boolean;
}
```

**Dependencies**: `TagCloud`, `PersonGrid`, `ProgressBar`

---

#### 4. `WatchHistoryTab.tsx`

**Lines**: ~250
**Props**:

```typescript
interface WatchHistoryTabProps {
  stats: {
    topActors: Array<{ name: string; count: number; profile?: string }>;
    topDirectors: Array<{ name: string; count: number; profile?: string }>;
    topGenres: Array<{ name: string; count: number }>;
    ratingsBuckets: number[];
    yearCounts: number[];
    years: number[];
    decadeCounts: number[];
    decades: string[];
  };
  loadingDetails: boolean;
}
```

**Dependencies**: `Chart`, `PersonGrid`

---

#### 5. `AlgorithmInsightsTab.tsx`

**Lines**: ~450
**Props**:

```typescript
interface AlgorithmInsightsTabProps {
  stats: {
    totalRewatchEntries: number;
    totalWatches: number;
    likedCount: number;
  };
  feedbackSummary: FeedbackSummary | null;
  sourceReliability: SourceReliability[];
  sourceReliabilityRecent: SourceReliability[];
  sourceConsensus: SourceConsensus[];
  reasonAcceptance: ReasonAcceptance[];
  consensusAcceptance: ConsensusAcceptance | null;
  feedbackAnalytics: FeedbackAnalytics | null;
  regretStats: RegretStats | null;
  explorationStats: ExplorationStats | null;
  adjacentPrefs: AdjacentPref[];
  pairwiseStats: PairwiseStats | null;
  repeatSuggestionStats: RepeatSuggestionStats | null;
}
```

**Dependencies**: `StatCard`, `ProgressBar`, `SectionCard`

---

#### 6. `WatchlistAnalysisTab.tsx`

**Lines**: ~200
**Props**:

```typescript
interface WatchlistAnalysisTabProps {
  stats: {
    watchlistCount: number;
    watchlistTopGenres: Array<{ name: string; count: number }>;
    watchlistTopDirectors: Array<{ name: string; count: number }>;
    watchlistTopActors: Array<{ name: string; count: number }>;
    watchlistTopKeywords: Array<{ name: string; count: number }>;
    watchlistRecencyBuckets: RecencyBuckets;
    medianWatchlistAge: number;
    avgWatchlistAge: number;
    watchlistWithDatesCount: number;
    avoidanceOverrides: AvoidanceOverrides;
  };
}
```

**Dependencies**: `TagCloud`, `StatCard`

---

#### 7. `AvoidanceProfileTab.tsx`

**Lines**: ~200
**Props**:

```typescript
interface AvoidanceProfileTabProps {
  stats: {
    likedFilmsCount: number;
    dislikedFilmsCount: number;
    avoidedGenres: string[];
    avoidedKeywords: string[];
    avoidedDirectors: string[];
    mixedGenres: Array<{ name: string; liked: number; disliked: number }>;
    mixedKeywords: Array<{ name: string; liked: number; disliked: number }>;
    mixedDirectors: Array<{ name: string; liked: number; disliked: number }>;
  };
}
```

**Dependencies**: `TagCloud`, `SectionCard`

---

### Shared Components

#### `StatCard.tsx` (~40 lines)

```typescript
interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "info";
}
```

#### `TagCloud.tsx` (~60 lines)

```typescript
interface TagCloudProps {
  items: Array<{ name: string; weight?: number; count?: number }>;
  maxItems?: number;
  colorScheme?: "green" | "blue" | "purple" | "amber" | "red";
  showWeight?: boolean;
}
```

#### `PersonGrid.tsx` (~80 lines)

```typescript
interface PersonGridProps {
  people: Array<{ name: string; count: number; profile?: string }>;
  maxItems?: number;
  title: string;
}
```

#### `ProgressBar.tsx` (~30 lines)

```typescript
interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  color?: string;
}
```

#### `SectionCard.tsx` (~30 lines)

```typescript
interface SectionCardProps {
  title: string;
  subtitle?: string;
  badge?: string;
  gradient?: "green" | "blue" | "purple" | "red" | "cyan" | "indigo";
  children: React.ReactNode;
}
```

---

### Custom Hooks

#### `useStatsData.ts` (~300 lines)

Consolidates all data fetching:

```typescript
interface UseStatsDataReturn {
  // Loading states
  loading: boolean;
  loadingDetails: boolean;
  error: string | null;

  // Core data
  uid: string | null;
  filteredFilms: Film[];
  tmdbDetails: Map<number, TMDBDetails>;
  filmMappings: Map<string, number>;

  // Computed stats
  stats: ComputedStats | null;
  tasteProfileData: TasteProfile | null;

  // Feedback data
  feedbackSummary: FeedbackSummary | null;
  sourceReliability: SourceReliability[];
  // ... etc
}
```

---

## 4. Implementation Steps

### Phase 3.1: Setup & Types (2 hours)

1. Create `src/app/stats/types.ts` with all shared interfaces
2. Create `src/app/stats/components/` directory structure
3. Create `src/app/stats/hooks/` directory structure
4. Extract types from current page.tsx

### Phase 3.2: Shared Components (3 hours)

1. Create `StatCard.tsx`
2. Create `TagCloud.tsx`
3. Create `PersonGrid.tsx`
4. Create `ProgressBar.tsx`
5. Create `SectionCard.tsx`
6. Add unit tests for shared components

### Phase 3.3: Custom Hooks (4 hours)

1. Create `useStatsData.ts` - extract all data fetching logic
2. Create `useFeedbackAnalytics.ts` - extract feedback calculations
3. Create `useTasteProfile.ts` - extract taste profile building
4. Test hooks in isolation

### Phase 3.4: Tab Components (8 hours)

1. Create `StatsHeader.tsx`
2. Create `StatsOverview.tsx` (Tab 1)
3. Create `TasteProfileTab.tsx` (Tab 2)
4. Create `WatchHistoryTab.tsx` (Tab 3)
5. Create `AlgorithmInsightsTab.tsx` (Tab 4)
6. Create `WatchlistAnalysisTab.tsx` (Tab 5)
7. Create `AvoidanceProfileTab.tsx` (Tab 6)

### Phase 3.5: Parent Page Refactor (3 hours)

1. Implement tab navigation in `page.tsx`
2. Wire up all child components
3. Implement lazy loading for non-visible tabs
4. Add URL-based tab state (e.g., `/stats?tab=algorithm`)

### Phase 3.6: Testing & Polish (4 hours)

1. Full E2E testing of all tabs
2. Responsive design verification
3. Dark mode verification
4. Performance testing (ensure no regressions)
5. Accessibility audit (keyboard navigation, ARIA)

### Phase 3.7: Cleanup (2 hours)

1. Remove old code from page.tsx
2. Update imports throughout codebase
3. Document component APIs
4. Update AGENTS.md if needed

---

## 5. Tab Navigation Implementation

### Recommended Approach: URL-Based Tabs

```typescript
// page.tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, lazy } from "react";

type TabId =
  | "overview"
  | "taste"
  | "history"
  | "algorithm"
  | "watchlist"
  | "filters";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "taste", label: "Taste Profile", icon: "🎯" },
  { id: "history", label: "Watch History", icon: "📅" },
  { id: "algorithm", label: "Algorithm Insights", icon: "🧠" },
  { id: "watchlist", label: "Watchlist", icon: "📋" },
  { id: "filters", label: "Filters", icon: "🚫" },
];

// Lazy load tab content for performance
const StatsOverview = lazy(() => import("./components/StatsOverview"));
const TasteProfileTab = lazy(() => import("./components/TasteProfileTab"));
// ... etc
```

### Tab Styling (Tailwind)

```tsx
<div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
  {TABS.map((tab) => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`
        px-4 py-2 text-sm font-medium whitespace-nowrap
        border-b-2 transition-colors
        ${
          activeTab === tab.id
            ? "border-blue-500 text-blue-600 dark:text-blue-400"
            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
        }
      `}
    >
      <span className="mr-2">{tab.icon}</span>
      {tab.label}
    </button>
  ))}
</div>
```

---

## 6. Risk Assessment

### High Risk

| Risk                                         | Mitigation                                                  |
| -------------------------------------------- | ----------------------------------------------------------- |
| State management complexity during refactor  | Keep original page.tsx until new implementation is verified |
| Breaking existing functionality              | Comprehensive E2E tests before starting                     |
| Performance regression from extra re-renders | Use React.memo, useMemo strategically                       |
| TMDB data loading race conditions            | Maintain single data fetch in parent, pass down             |

### Medium Risk

| Risk                               | Mitigation                              |
| ---------------------------------- | --------------------------------------- |
| Tab content flashing on navigation | Implement proper loading states per tab |
| Dark mode styling inconsistencies  | Create design tokens/CSS variables      |
| Mobile responsiveness issues       | Test on mobile throughout development   |
| Chart component prop mismatches    | Type-safe props for Chart component     |

### Low Risk

| Risk                                | Mitigation                                |
| ----------------------------------- | ----------------------------------------- |
| Import path changes breaking builds | Use path aliases consistently             |
| Component naming conflicts          | Use clear, prefixed naming convention     |
| localStorage state sync issues      | Test expanded/collapsed state persistence |

---

## 7. Success Criteria

### Functional Requirements

- [ ] All 23 sections render correctly in their respective tabs
- [ ] Time filter applies globally across all tabs
- [ ] Tab state persists in URL (shareable links)
- [ ] Loading states work correctly for each tab
- [ ] Error states handle gracefully

### Performance Requirements

- [ ] Initial load time <= current implementation
- [ ] Tab switching < 100ms
- [ ] No duplicate data fetching on tab switch
- [ ] Lazy loading reduces initial bundle size

### Code Quality Requirements

- [ ] Each component < 500 lines
- [ ] Parent page.tsx < 300 lines
- [ ] All components have TypeScript interfaces
- [ ] No duplicate code between tabs
- [ ] Shared components are reusable

### UX Requirements

- [ ] Clear tab labels with icons
- [ ] Visual indication of active tab
- [ ] Smooth transitions between tabs
- [ ] Mobile-friendly tab navigation (horizontal scroll)
- [ ] Keyboard navigation support (arrow keys)

---

## 8. Estimated Timeline

| Phase                 | Duration | Dependencies |
| --------------------- | -------- | ------------ |
| 3.1 Setup & Types     | 2 hours  | None         |
| 3.2 Shared Components | 3 hours  | 3.1          |
| 3.3 Custom Hooks      | 4 hours  | 3.1          |
| 3.4 Tab Components    | 8 hours  | 3.2, 3.3     |
| 3.5 Parent Refactor   | 3 hours  | 3.4          |
| 3.6 Testing & Polish  | 4 hours  | 3.5          |
| 3.7 Cleanup           | 2 hours  | 3.6          |

**Total Estimated Time**: ~26 hours (3-4 developer days)

---

## 9. Future Enhancements (Post-Phase 3)

1. **Collapsible Sections Within Tabs**: Allow users to hide sections they don't care about
2. **Custom Tab Order**: Let users rearrange tabs based on preference
3. **Export Stats**: Add "Export to JSON/PDF" functionality
4. **Comparison Mode**: Compare stats across time periods
5. **Goal Setting**: "I want to watch X films from Y decade"
6. **Social Sharing**: Share taste profile as an image card

---

## 10. Appendix: Component Size Comparison

### Before (Monolithic)

```
page.tsx: 2,108 lines
```

### After (Modular)

```
page.tsx:               ~150 lines
StatsHeader.tsx:        ~50 lines
StatsOverview.tsx:      ~200 lines
TasteProfileTab.tsx:    ~400 lines
WatchHistoryTab.tsx:    ~250 lines
AlgorithmInsightsTab.tsx: ~450 lines
WatchlistAnalysisTab.tsx: ~200 lines
AvoidanceProfileTab.tsx:  ~200 lines
Shared components:      ~240 lines (5 × ~48 avg)
Hooks:                  ~400 lines
Types:                  ~100 lines

Total:                  ~2,640 lines (25% increase for modularity)
```

**Tradeoff**: Slightly more total lines, but dramatically improved:

- Maintainability (isolated components)
- Testability (unit tests per component)
- Readability (single responsibility)
- Performance (lazy loading possible)
- Collaboration (multiple devs can work in parallel)

---

_Plan created by UI Designer Agent - Ready for implementation_
