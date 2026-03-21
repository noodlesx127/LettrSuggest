# Research Findings: "Not Interested" Movies Not Being Filtered Properly

## Issue 1: Race Condition in Initial Load

**Location**: `src/app/suggest/page.tsx`
**Problem**: The `blockedIds` state may not be loaded before `runSuggest()` executes.

- `useEffect` on mount fetches `blockedIds` asynchronously.
- A separate `useEffect` auto-triggers `runSuggest()` without waiting for `blockedIds`.
  **Result**: Initial suggestions may filter against an empty `blockedIds` Set.

## Issue 2: Data Inconsistency Between Tables

**Location**: Database tables `blocked_suggestions` and `suggestion_feedback`
**Problem**: Discrepancy found:

- 13 items in `blocked_suggestions` but NOT in `suggestion_feedback` (negative).
- 19 items in `suggestion_feedback` (negative) but NOT in `blocked_suggestions`.
  **Impact**: UI filtering uses `blocked_suggestions`, while scoring penalty uses `suggestion_feedback`.

## Issue 3: Soft-Avoid vs Hard-Filter Strategy

**Location**: `src/lib/enrich.ts`
**Problem**: The algorithm applies a -4.0 penalty to negative feedback items but does not hard-filter them. High-scoring movies can still appear.

## Issue 4: Restoration from Session Storage

**Location**: `src/app/suggest/page.tsx`
**Problem**: Items restored from `sessionStorage` may bypass the blocked check if the user blocked them in a previous session.

## Proposed Fixes

1. **Fix Race Condition**: Add `blockedIds` as a dependency or gate for `runSuggest()`.
2. **Fix Data Consistency**: Ensure `addFeedback` and `blockSuggestion` are atomic or consistent.
3. **Hard-Filter**: Filter out `negativeFeedbackIds` in `suggestByOverlap`.
4. **Session Storage**: Filter restored items against `blockedIds`.
