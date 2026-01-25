# Counter-Programming / Palate Cleansers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect genre fatigue from recent viewing patterns and surface “palate cleanser” recommendations on the Suggest page.

**Architecture:** Add a counter-programming library that reads recent diary events, detects fatigue types, and generates contrasting recommendations. Integrate it into the Suggest page as a conditional section rendered before trending.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase, existing recommendation utilities.

---

### Task 1: Add Counter-Programming Library and Types

**Files:**

- Create: `src/lib/counterProgramming.ts`
- Modify: `src/types/recommendations.ts` (or existing shared types file for recommendation-related types)

**Step 1: Write the failing test (if applicable)**

If there’s an existing test harness for lib functions, add unit tests:

```typescript
import { detectGenreFatigue } from "@/lib/counterProgramming";

describe("detectGenreFatigue", () => {
  it("detects mono-genre fatigue", async () => {
    const fatigue = await detectGenreFatigue("user-id");
    expect(fatigue?.type).toBe("mono-genre");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test` (or project-specific test command)

Expected: FAIL with “module not found” or “function not implemented”.

**Step 3: Write minimal implementation**

Create `src/lib/counterProgramming.ts`:

```typescript
import { supabase } from "@/lib/supabaseClient";
import type { MovieItem } from "@/types/recommendations";
import type { FatigueDetection, FatigueType } from "@/types/recommendations";

const HIGH_INTENSITY_GENRES = ["Horror", "Thriller", "Action", "War"] as const;
const LIGHT_GENRES = [
  "Comedy",
  "Animation",
  "Romance",
  "Musical",
  "Family",
  "Fantasy",
] as const;
const HEAVY_GENRES = ["War", "Documentary", "Biography", "History"] as const;

const isDev = process.env.NODE_ENV === "development";

export async function detectGenreFatigue(
  userId: string,
): Promise<FatigueDetection | null> {
  try {
    // 1) Query last 10 diary events
    // 2) Build recent genres list (ordered by time)
    // 3) Check mono-genre fatigue (5+ in a row)
    // 4) Check intensity fatigue (7+ in last 10)
    // 5) Check heavy-drama fatigue (5+ in last 10, drama with rating < 6.5)
    // 6) Log and return detection, else null
  } catch (error) {
    if (isDev) console.error("[CounterProgramming] Error:", error);
    return null;
  }
}

export async function generatePalateCleanser(
  userId: string,
  fatigueType: FatigueType,
): Promise<MovieItem[]> {
  try {
    // 1) Determine target genres based on fatigue type
    // 2) Fetch candidate recommendations from existing sources
    // 3) Filter out fatigued genres and seen movies
    // 4) Prefer runtime < 120, rating > 7.0, user-liked genres
    // 5) Return 6-8 items
  } catch (error) {
    if (isDev) console.error("[CounterProgramming] Error:", error);
    return [];
  }
}
```

Add types in the shared types file:

```typescript
export type FatigueType = "mono-genre" | "intensity" | "heavy-drama";

export interface FatigueDetection {
  type: FatigueType;
  genre?: string;
  count: number;
  message: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/counterProgramming.ts src/types/recommendations.ts
git commit -m "feat: add counter-programming fatigue detection types"
```

---

### Task 2: Implement Fatigue Detection Algorithm

**Files:**

- Modify: `src/lib/counterProgramming.ts`

**Step 1: Write the failing test**

```typescript
it("returns null when no fatigue", async () => {
  const fatigue = await detectGenreFatigue("user-id");
  expect(fatigue).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL with incorrect return values.

**Step 3: Write minimal implementation**

Add logic to:

- Query `film_diary_events` ordered by `watched_at` (desc) limit 10
- Compute recent genres sequence per film
- Mono-genre fatigue: 5+ same genre in a row
- Intensity fatigue: 7+ high-intensity in last 10
- Heavy-drama fatigue: 5+ heavy-drama in last 10 (doc/biography/war, or drama with rating < 6.5)
- Build message string using count + genre if relevant
- Log in dev only

**Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/counterProgramming.ts
git commit -m "feat: detect genre fatigue from recent diary events"
```

---

### Task 3: Implement Palate Cleanser Generation

**Files:**

- Modify: `src/lib/counterProgramming.ts`

**Step 1: Write the failing test**

```typescript
it("returns 6-8 palate cleansers for intensity fatigue", async () => {
  const results = await generatePalateCleanser("user-id", "intensity");
  expect(results.length).toBeGreaterThanOrEqual(6);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL due to empty results.

**Step 3: Write minimal implementation**

Implement candidate selection:

- Determine candidate genres:
  - Mono-genre: user’s 2nd & 3rd favorite genres
  - Intensity: light genres set
  - Heavy drama: uplifting genres set
- Fetch candidates via existing recommendation sources
- Filter out fatigued genres and already-seen movies
- Prefer runtime < 120 minutes and rating > 7.0
- Return 6-8 items
- Log generation summary in dev only

**Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/counterProgramming.ts
git commit -m "feat: generate palate cleanser recommendations"
```

---

### Task 4: Integrate into Suggest Page

**Files:**

- Modify: `src/app/suggest/page.tsx`

**Step 1: Write the failing test**

If there is a UI test harness, add a test to ensure the section appears when fatigue exists.

**Step 2: Run test to verify it fails**

Run: `npm run test`

Expected: FAIL with missing UI section.

**Step 3: Write minimal implementation**

- Call `detectGenreFatigue(userId)` after main recommendations are generated
- If fatigue detected, call `generatePalateCleanser`
- Add a new section before trending:
  - Title based on fatigue type
  - Description from message
  - Render list using existing movie card component

**Step 4: Run test to verify it passes**

Run: `npm run test`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/suggest/page.tsx
git commit -m "feat: show palate cleanser section on suggest page"
```

---

### Task 5: Validation & Documentation

**Files:**

- Create: `docs/summary/2026-01-25-counter-programming-palate-cleansers.md`

**Step 1: Manual validation plan**

- Mono-genre: 5 horror in a row → “Take a Break from Horror” section appears
- Intensity: 7+ intense genres in last 10 → “Lighten the Mood” section appears
- Heavy drama: 5+ heavy drama → “Something Uplifting” section appears
- Varied watches → no section displayed

**Step 2: Run lint/typecheck/build**

Run: `npm run lint && npm run typecheck && npm run build`

Expected: PASS.

**Step 3: Write summary doc**

```markdown
# Counter-Programming / Palate Cleansers Summary

## What changed

- Added counter-programming fatigue detection and palate cleanser generation
- Integrated a conditional “Take a Break” section on Suggest page

## Validation

- Manual scenarios listed above
- CI commands: lint, typecheck, build
```

**Step 4: Commit**

```bash
git add docs/summary/2026-01-25-counter-programming-palate-cleansers.md
git commit -m "docs: add counter-programming summary"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-25-counter-programming-palate-cleansers.md`.

Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints.

Which approach?
