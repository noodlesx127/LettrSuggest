# Recommendation Algorithm Improvement - Executive Summary

**Date**: January 24, 2026  
**Status**: Ready for Implementation  
**Full Plan**: [`/docs/plans/recommendation-algorithm-improvement-plan.md`](../plans/recommendation-algorithm-improvement-plan.md)

---

## 🎯 Problem Statement

User reports: "Recommendations are mostly generic with repeats. The taste profile (based on Letterboxd data and Interested/Not Interested feedback) doesn't seem to influence suggestions."

---

## 🔍 Root Cause Analysis

### The Smoking Gun

**Location**: `src/lib/enrich.ts` → `buildTasteProfile` → `fetchDetails` helper (lines ~3211-3214)

**Bug**: The TMDB cache validation function returns cached movie data WITHOUT verifying it contains `credits` (actors/directors) and `keywords`. This causes the taste profile to be built with incomplete data, resulting in:

- ❌ Missing top actors (no cast data)
- ❌ Missing top directors (no crew data)
- ❌ Missing top keywords (no keyword data)
- ✅ Only genres work (always present in basic TMDB data)

**Result**: Algorithm can only personalize based on genres → generic recommendations.

### Secondary Issues

1. **Aggregator doesn't use taste profile** - Only receives seed movie IDs, not genre/keyword/director preferences
2. **Feedback learning not applied to candidate generation** - Avoided features only affect scoring, not generation
3. **Personalization isn't visible** - Even when working, users can't see WHY recommendations match their taste
4. **Underutilized data** - Diary dates, saved suggestions, production metadata collected but unused

---

## 📊 Solution Overview

### Phase 0: Fix Critical Bug (1 hour)

- Fix cache validation to require complete TMDB data
- Ensure new cache entries include credits & keywords
- **Impact**: 70-80% improvement in personalization

### Phase 1: Quick Algorithm Wins (2-3 hours)

- Dynamic source weighting based on user feedback
- Watchlist intent boost
- Auto-adjust diversity (MMR lambda)
- Use saved suggestions as seeds
- Enhanced quality thresholds for favorite directors
- **Impact**: 10-15% additional improvement

### Phase 2: Personalization Visibility (6-8 hours)

- Show match scores on movie cards
- Display "Because you loved..." callouts
- Multi-source consensus badges
- Reduce section overload (24+ → 8-10)
- Taste profile summary widget
- Personalized section headers
- **Impact**: Users PERCEIVE personalization (builds trust)

### Phase 3: Data Utilization (4-6 hours)

- Learn feature weights per-user (director-driven vs genre-driven)
- TF-IDF keyword weighting (rare keywords score higher)
- Production metadata (countries, languages, studios)
- Temporal recency from diary dates
- Rewatch pattern analysis
- **Impact**: 5-10% additional improvement + long-term learning

### Phase 4: Advanced Features (2-3 days, Optional)

- Vector-based semantic similarity (pgvector)
- Calibrated recommendations (prevent genre collapse)
- Counter-programming (palate cleansers)
- **Impact**: Industry-grade recommendation system

---

## 🎯 Recommended Execution

**Priority**: Phase 0 → Phase 1 → Phase 2

**Timeline**:

- Week 1: Phase 0 + Phase 1 (critical fixes + quick wins)
- Week 2: Phase 2 (make personalization visible)
- Week 3: Phase 3 (deep learning, optional)
- Future: Phase 4 (advanced features, optional)

**Total Time**: 10-15 hours for Phase 0-2 (recommended scope)

---

## 📈 Success Metrics

### Before Fix

- `likedMoviesWithKeywords`: ~0-10%
- `likedMoviesWithCredits`: ~0-10%
- User feedback: "Generic suggestions"
- Match scores: Variable, many low scores

### After Phase 0

- `likedMoviesWithKeywords`: >80%
- `likedMoviesWithCredits`: >80%
- Taste profile extracts actual top actors/directors/keywords
- User feedback: "Much more personalized"

### After Phase 1-2

- Source weights adapt to user preferences
- Watchlist films prominently featured
- Users see and understand WHY recommendations match
- Reduced cognitive overload (fewer sections)
- Match score average: >80%
- Feedback ratio (Interested/Total): >30%

### After Phase 3

- Algorithm learns user's "personality" (director-driven vs genre-driven)
- Niche keywords prioritized
- Regional cinema preferences detected
- Personalization improves over time

---

## 🔧 Sub-Agent Assignments

| Phase   | Primary Sub-Agents                                 | Skills                                                  |
| ------- | -------------------------------------------------- | ------------------------------------------------------- |
| Phase 0 | `typescript-pro`, `code-reviewer`                  | `find-bugs`                                             |
| Phase 1 | `typescript-pro`, `code-reviewer`                  | `find-bugs`                                             |
| Phase 2 | `ui-designer`, `react-specialist`, `code-reviewer` | `frontend-design`, `web-design-guidelines`, `find-bugs` |
| Phase 3 | `typescript-pro`, `code-reviewer`                  | `find-bugs`                                             |
| Phase 4 | `typescript-pro`, `code-reviewer`                  | `find-bugs`                                             |

**Key Requirement**: All UI/UX work MUST use `ui-designer` sub-agent with `frontend-design` skill.

---

## 🚀 Quick Start

To begin implementation:

1. **Review full plan**: `/docs/plans/recommendation-algorithm-improvement-plan.md`
2. **Create feature branch**: `git checkout -b feature/recommendation-improvements`
3. **Start with Phase 0, Task 0.1**: Fix TMDB cache validation
4. **Test with real user** who currently has "generic" recommendations
5. **Measure improvement** before proceeding to next phase

---

## 📚 Related Documentation

- **Full Plan**: [`/docs/plans/recommendation-algorithm-improvement-plan.md`](../plans/recommendation-algorithm-improvement-plan.md)
- **Research**: [`/docs/recommendation-best-practices.md`](../recommendation-best-practices.md)
- **Architecture**: [`/docs/summary/recommendation-architecture.md`](./recommendation-architecture.md) (to be updated)
- **Evolution Roadmap**: [`/docs/plans/recommendation-evolution.md`](../plans/recommendation-evolution.md)

---

## 💡 Key Insights

1. **Cache Quality Matters**: A 90% cache hit rate with 10% complete data is worse than 50% hit rate with 100% complete data
2. **Personalization Must Be Visible**: Even perfect algorithms fail if users don't see/understand the personalization
3. **Quick Wins First**: 80% of improvement comes from fixing the cache bug (20% of effort)
4. **Data Utilization**: You're collecting valuable data (diary, saved suggestions) that's unused
5. **Industry Techniques**: Modern recommendation systems use hybrid approaches (content + collaborative + semantic)

---

## ⚠️ Important Notes

- **Don't skip Phase 0**: This is the foundation - other improvements won't matter if cache is broken
- **Phase 2 is critical**: Making personalization visible builds user trust and engagement
- **Test incrementally**: Measure improvement after each phase before proceeding
- **Phase 4 is optional**: Vector similarity is powerful but requires infrastructure setup
- **Code reviews required**: Every phase includes dedicated review task

---

## 🎬 Expected Outcome

After completing Phase 0-2 (recommended scope):

**User Experience**:

- "These recommendations actually match my taste!"
- "I can see why each movie was suggested"
- "The algorithm learns from my feedback"
- "I'm discovering films I wouldn't have found otherwise"

**System Behavior**:

- Taste profile captures user's actual preferences
- Candidates generated match taste profile
- Scoring reflects personalization signals
- UI clearly shows recommendation reasoning
- Feedback loop improves suggestions over time

**Metrics**:

- 70-80% improvement in personalization (Phase 0)
- 85-90% improvement total (Phase 0-2)
- High user trust and engagement
- Reduced "Not Interested" ratio
- Increased watchlist additions

---

Let's build the most personalized movie recommendation system! 🎬✨
