# Admin User Management — Implementation Plan

A comprehensive admin dashboard for managing users, roles, data, and API keys within LettrSuggest. This page will replace the current minimal `/admin` page and serve as the central hub for site administration.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites from API Plan](#2-prerequisites-from-api-plan)
3. [Feature Breakdown](#3-feature-breakdown)
4. [Page Architecture](#4-page-architecture)
5. [Backend: Server Actions & API Routes](#5-backend-server-actions--api-routes)
6. [Database Changes](#6-database-changes)
7. [Security & Role Gating](#7-security--role-gating)
8. [File Manifest](#8-file-manifest)
9. [Implementation Order](#9-implementation-order)
10. [Verification Plan](#10-verification-plan)

---

## 1. Overview

### What exists today

The current `/admin` page (`src/app/admin/page.tsx`) has:
- A TMDB movie search tool
- A blocked suggestions viewer/manager
- **No role gating** — any authenticated user can access it
- No user management capabilities

### What we're building

A full admin dashboard with:

| Feature                     | Description                                              |
|-----------------------------|----------------------------------------------------------|
| **User List + Search**      | Searchable, filterable, paginated list of all users      |
| **User Detail Panel**       | At-a-glance info for any user                           |
| **Role Management**         | Promote/demote users (user ↔ developer ↔ admin)         |
| **Data Management**         | Delete all data, blocked suggestions, or liked suggestions for any user |
| **Account Management**      | Change email, reset password, suspend/unsuspend accounts |
| **API Key Oversight**       | View user's API keys (prefix + label), revoke keys      |
| **Audit Log**               | Track all admin actions with timestamps and actor info   |
| **View-As / Impersonate**   | View any user's taste profile and suggestions read-only  |

---

## 2. Prerequisites from API Plan

This plan depends on infrastructure from `API_PLAN.MD`:

| Dependency                 | Why needed                                             |
|----------------------------|--------------------------------------------------------|
| `user_roles` table         | RBAC system — admin role check before page access     |
| `api_keys` table           | View/revoke user API keys                              |
| `supabaseAdmin` client     | Service-role client for auth admin operations           |

> [!IMPORTANT]
> The `user_roles` migration and `supabaseAdmin` client must be built first (Phase 1 of API_PLAN). The admin page can be built in parallel with the API endpoints.

---

## 3. Feature Breakdown

### 3.1 User List with Search & Filters

A table/grid showing all users with:

| Column          | Source                          | Sortable | Filterable |
|-----------------|--------------------------------|:--------:|:----------:|
| Email           | `profiles.email`               | ✅       | Search     |
| Role            | `user_roles.role`              | ✅       | Dropdown   |
| Status          | `profiles.suspended_at`        | ✅       | Dropdown   |
| Signup Date     | `auth.users.created_at`        | ✅       | ❌         |
| Last Sign-in    | `auth.users.last_sign_in_at`   | ✅       | ❌         |
| Film Count      | `COUNT(film_events)`           | ✅       | ❌         |
| API Keys        | `COUNT(api_keys)`              | ❌       | ❌         |

- **Pagination**: 20 users per page, server-side
- **Search**: Debounced email search (300ms)
- **Default sort**: Signup date, newest first

---

### 3.2 User Detail Panel

Clicking a user row opens a detail panel (slide-out or modal) with tabs:

**Tab 1: Overview**
- Email, user ID, role badge
- Signup date, last sign-in, account status
- Import stats: film count, rating count, watchlist size, diary entries
- Number of active API keys

**Tab 2: Role & Account**
- Role selector (user / developer / admin) with confirm dialog
- Change email form
- Reset password button (sends reset email)
- Suspend / Unsuspend toggle
- Delete user data button (with confirmation)

**Tab 3: Data Management**
- Delete all data (full wipe — same as `delete_user_data`)
- Delete only blocked suggestions
- Delete only liked suggestions (suggestion_feedback where feedback = 'like')
- Delete only import data (film_events + film_tmdb_map + film_diary_events)
- Each with confirmation and result counts displayed

**Tab 4: API Keys**
- Table of user's API keys: prefix, label, type, created, last used, status
- Revoke individual key button
- Revoke all keys button

**Tab 5: View-As** (read-only)
- Shows the user's taste profile summary
- Shows their top genres, liked directors, actors
- Shows their current recommendations preview
- Clearly marked as read-only with a banner: "Viewing as [user@email.com]"

---

### 3.3 Audit Log

All admin actions are logged to an `admin_audit_log` table:

| Column        | Type      | Description                          |
|---------------|-----------|--------------------------------------|
| `id`          | UUID      | Primary key                          |
| `admin_id`    | UUID      | The admin who performed the action   |
| `target_id`   | UUID      | The user affected (nullable)         |
| `action`      | TEXT      | Action type (see below)              |
| `details`     | JSONB     | Additional context                   |
| `created_at`  | TIMESTAMPTZ | When the action occurred           |

**Action types:**
- `role.changed` — `{ from: 'user', to: 'admin' }`
- `data.deleted` — `{ type: 'all' | 'blocked' | 'liked' | 'import', counts: {...} }`
- `account.email_changed` — `{ from: 'old@email.com', to: 'new@email.com' }`
- `account.password_reset` — `{}`
- `account.suspended` — `{}`
- `account.unsuspended` — `{}`
- `apikey.revoked` — `{ keyPrefix: 'ls_u_a1b2', label: '...' }`
- `apikey.all_revoked` — `{ count: 3 }`

A scrollable log section at the bottom of the admin page shows recent actions:

```
┌──────────────────────────────────────────────────────────┐
│ 📋 Audit Log                               [Filter ▾]   │
├──────────────────────────────────────────────────────────┤
│ 5m ago   admin@site.com   role.changed      joe@test.com │
│          Changed role from 'user' to 'admin'             │
│ 1h ago   admin@site.com   data.deleted      bob@test.com │
│          Deleted blocked suggestions (12 items)           │
│ 2h ago   admin@site.com   account.suspended alice@x.com  │
│          Account suspended                               │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Page Architecture

### Component Tree

```
src/app/admin/page.tsx               ← Main admin page (replace existing)
├── AdminGate                        ← Role-gated wrapper (checks admin role)
├── AdminUserList                    ← User table with search/pagination
│   ├── UserSearchBar                ← Search + filter controls
│   └── UserRow                      ← Individual user row
├── UserDetailPanel                  ← Slide-out detail panel
│   ├── UserOverviewTab              ← Stats & info
│   ├── UserRoleAccountTab           ← Role changes, account management
│   ├── UserDataManagementTab        ← Selective data deletion
│   ├── UserApiKeysTab               ← API key management
│   └── UserViewAsTab               ← Impersonate / view-as
├── AdminAuditLog                    ← Recent audit log
└── AdminMovieSearch                 ← Existing TMDB search (preserved)
```

### Layout Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔧 Admin Dashboard                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─── User Management ───────────────────────────────────────┐  │
│  │ [🔍 Search users...]  [Role: All ▾]  [Status: All ▾]      │  │
│  │                                                           │  │
│  │ Email              Role    Status  Signup   Films  Keys   │  │
│  │ joe@test.com       admin   Active  Jan 15   245    2      │  │
│  │ bob@mail.com       user    Active  Feb 03   89     0      │  │
│  │ alice@example.com  user    Susp'd  Mar 01   12     1      │  │
│  │ ...                                                       │  │
│  │                               [← 1 2 3 ... 5 →]          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── TMDB Search ───────────────────────────────────────────┐  │
│  │ (existing movie search tool — preserved)                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── Audit Log ─────────────────────────────────────────────┐  │
│  │ (recent admin actions log)                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

        ┌──── User Detail (slide-out) ─────────────────┐
        │ ✕ Close                                       │
        │                                               │
        │  joe@test.com                     [Admin 🟢]  │
        │  ID: abc-123-...                              │
        │  Signed up: Jan 15, 2026                      │
        │  Last active: 5m ago                          │
        │                                               │
        │  [Overview] [Role] [Data] [API Keys] [View As]│
        │  ─────────────────────────────────────────    │
        │                                               │
        │  245 films  ·  198 rated  ·  47 watchlist     │
        │  2 API keys active                            │
        │  ...                                          │
        └───────────────────────────────────────────────┘
```

---

## 5. Backend: Server Actions & API Routes

### Server Actions (`src/app/actions/admin.ts`)

All admin operations are implemented as Server Actions for security. Each action:
1. Verifies the caller has admin role via `supabaseAdmin`
2. Performs the operation
3. Logs to `admin_audit_log`
4. Returns structured results

| Action                     | Parameters                          | What it does                                   |
|----------------------------|-------------------------------------|------------------------------------------------|
| `listUsers`                | `page, perPage, search, roleFilter, statusFilter, sortBy` | Paginated user list with counts |
| `getUserDetail`            | `userId`                           | Full user info with stats                      |
| `changeUserRole`           | `userId, newRole`                  | Update `user_roles` table                      |
| `changeUserEmail`          | `userId, newEmail`                 | `supabaseAdmin.auth.admin.updateUserById()`    |
| `resetUserPassword`        | `userId`                           | `supabaseAdmin.auth.admin.generateLink()`      |
| `suspendUser`              | `userId`                           | Set `profiles.suspended_at`, ban from auth     |
| `unsuspendUser`            | `userId`                           | Clear `profiles.suspended_at`, unban           |
| `deleteUserData`           | `userId, scope`                    | Delete all / blocked / liked / import data     |
| `getUserApiKeys`           | `userId`                           | List keys (prefix + label + meta, no hashes)   |
| `revokeUserApiKey`         | `userId, keyId`                    | Set `api_keys.revoked_at`                      |
| `revokeAllUserApiKeys`     | `userId`                           | Revoke all active keys for user                |
| `getAuditLog`              | `page, perPage, actionFilter`      | Paginated audit log                            |
| `getUserTasteProfile`      | `userId`                           | Fetch profile for view-as feature              |

### Supabase Admin Client

These operations require `supabase.auth.admin.*` methods which need the **service role key**:

```typescript
// src/lib/supabaseAdmin.ts (shared with API plan)
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,   // Server-side only
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

> [!CAUTION]
> The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. It must NEVER be exposed to the client. All admin operations go through Server Actions (server-side only).

---

## 6. Database Changes

### 6.1 Modify `profiles` table — Add `suspended_at`

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.profiles.suspended_at IS
  'When set, the user account is suspended. NULL = active.';
```

### 6.2 New table: `admin_audit_log`

```sql
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES auth.users(id),
  target_id   UUID REFERENCES auth.users(id),
  action      TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fetching recent logs
CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON public.admin_audit_log (created_at DESC);

-- Index for filtering by target user
CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON public.admin_audit_log (target_id);

-- RLS: Only admins can read/write (enforced via service role in Server Actions,
-- but we add policies for defense-in-depth)
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No client-side policies — all access via service role in server actions
-- This ensures the audit log is tamper-proof from the client
```

### 6.3 New admin variant of `delete_user_data`

The existing `delete_user_data` function checks `auth.uid() = target_user_id` (self-only). We need an admin variant that allows any caller when run from the service role:

```sql
CREATE OR REPLACE FUNCTION public.admin_delete_user_data(
  target_user_id uuid,
  scope text DEFAULT 'all'  -- 'all', 'blocked', 'liked', 'import'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb := '{}';
  count integer;
BEGIN
  CASE scope
    WHEN 'blocked' THEN
      DELETE FROM public.blocked_suggestions WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := jsonb_build_object('blocked_suggestions', count);

    WHEN 'liked' THEN
      DELETE FROM public.suggestion_feedback
        WHERE user_id = target_user_id AND feedback = 'like';
      GET DIAGNOSTICS count = ROW_COUNT;
      result := jsonb_build_object('liked_suggestions', count);

    WHEN 'import' THEN
      DELETE FROM public.film_tmdb_map WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := jsonb_build_object('film_tmdb_map', count);

      BEGIN
        DELETE FROM public.film_diary_events WHERE user_id = target_user_id;
        GET DIAGNOSTICS count = ROW_COUNT;
        result := result || jsonb_build_object('film_diary_events', count);
      EXCEPTION WHEN undefined_table THEN
        result := result || jsonb_build_object('film_diary_events', 0);
      END;

      DELETE FROM public.film_events WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('film_events', count);

    WHEN 'all' THEN
      -- Reuse the existing full delete logic
      DELETE FROM public.blocked_suggestions WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('blocked_suggestions', count);

      DELETE FROM public.suggestion_feedback WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('suggestion_feedback', count);

      DELETE FROM public.user_exploration_stats WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('user_exploration_stats', count);

      DELETE FROM public.user_adjacent_preferences WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('user_adjacent_preferences', count);

      DELETE FROM public.saved_suggestions WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('saved_suggestions', count);

      DELETE FROM public.user_reason_preferences WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('user_reason_preferences', count);

      DELETE FROM public.film_tmdb_map WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('film_tmdb_map', count);

      BEGIN
        DELETE FROM public.film_diary_events WHERE user_id = target_user_id;
        GET DIAGNOSTICS count = ROW_COUNT;
        result := result || jsonb_build_object('film_diary_events', count);
      EXCEPTION WHEN undefined_table THEN
        result := result || jsonb_build_object('film_diary_events', 0);
      END;

      DELETE FROM public.film_events WHERE user_id = target_user_id;
      GET DIAGNOSTICS count = ROW_COUNT;
      result := result || jsonb_build_object('film_events', count);

    ELSE
      RAISE EXCEPTION 'Invalid scope: %', scope;
  END CASE;

  RETURN jsonb_build_object('success', true, 'scope', scope, 'deleted', result);
END;
$$;
```

---

## 7. Security & Role Gating

### Admin Page Access

The admin page is protected with a new `AdminGate` component:

```typescript
// src/components/AdminGate.tsx
// 1. Checks if user is authenticated (via supabase.auth.getSession())
// 2. Checks if user has 'admin' role (via user_roles table)
// 3. Shows "Access Denied" if not admin
// 4. Renders children if admin
```

### NavBar Integration

The admin link in the NavBar should only be visible to admin users. We'll add conditional rendering based on the user's role.

### Server Action Security

Every server action:
1. Gets the current session via `supabase.auth.getSession()`
2. Verifies the session user has `admin` role via `user_roles` table
3. Throws `403` if not admin
4. Logs the action to `admin_audit_log`

```typescript
// Pattern used in every admin action:
async function requireAdminSession() {
  const supabase = createServerClient(); // from cookies
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');

  const { data: roleData } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .single();

  if (roleData?.role !== 'admin') throw new Error('Admin access required');

  return { adminId: session.user.id, adminEmail: session.user.email };
}
```

### Suspension Enforcement

When a user is suspended:
1. `profiles.suspended_at` is set to current timestamp
2. `supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' })` — Supabase native ban
3. All active API keys for the user are automatically revoked
4. The `AuthGate` component should also check for suspension status

---

## 8. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `src/components/AdminGate.tsx` | Role-gated wrapper for admin pages |
| `src/app/actions/admin.ts` | Server Actions for all admin operations |
| `src/app/admin/components/AdminUserList.tsx` | User table with search/pagination |
| `src/app/admin/components/UserDetailPanel.tsx` | Slide-out user detail panel |
| `src/app/admin/components/UserOverviewTab.tsx` | User overview stats tab |
| `src/app/admin/components/UserRoleAccountTab.tsx` | Role & account management tab |
| `src/app/admin/components/UserDataManagementTab.tsx` | Selective data deletion tab |
| `src/app/admin/components/UserApiKeysTab.tsx` | API key oversight tab |
| `src/app/admin/components/UserViewAsTab.tsx` | View-as / impersonate tab |
| `src/app/admin/components/AdminAuditLog.tsx` | Audit log viewer |
| `supabase/migrations/TIMESTAMP_admin_audit_log.sql` | Audit log table |
| `supabase/migrations/TIMESTAMP_profiles_suspended_at.sql` | Add suspended_at column |
| `supabase/migrations/TIMESTAMP_admin_delete_user_data.sql` | Admin delete function |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/admin/page.tsx` | Complete rewrite — admin dashboard with all features |
| `src/components/NavBar.tsx` | Conditionally show admin link for admin users only |
| `src/components/AuthGate.tsx` | Add suspension check (redirect suspended users) |

### Shared with API Plan (build once, use in both)

| File | Purpose |
|------|---------|
| `src/lib/supabaseAdmin.ts` | Service-role Supabase client |
| `supabase/migrations/TIMESTAMP_user_roles.sql` | User roles table |

---

## 9. Implementation Order

> [!TIP]
> Steps are ordered by dependency. The API plan's Phase 1 (user_roles + supabaseAdmin) should be done first.

**Phase 1 — Foundation (shared with API Plan)**
1. `supabaseAdmin.ts` — Service-role client
2. `user_roles` migration — RBAC table + seed existing users
3. Seed the first admin user (your account) via direct SQL

**Phase 2 — Database & Server**
4. `profiles_suspended_at` migration
5. `admin_audit_log` migration
6. `admin_delete_user_data` migration
7. `AdminGate.tsx` component
8. `src/app/actions/admin.ts` — All server actions

**Phase 3 — UI Components**
9. `AdminUserList.tsx` — User table with search/filter/pagination
10. `UserDetailPanel.tsx` — Slide-out panel shell with tabs
11. `UserOverviewTab.tsx` — User info & stats
12. `UserRoleAccountTab.tsx` — Role changes, email, password, suspend
13. `UserDataManagementTab.tsx` — Selective data deletion
14. `UserApiKeysTab.tsx` — Key oversight & revocation
15. `UserViewAsTab.tsx` — Taste profile view-as

**Phase 4 — Integration** ✅ COMPLETE


16. Rewrite `admin/page.tsx` — Assemble all components ✅
17. Update `NavBar.tsx` — Admin link visibility ✅
18. Update `AuthGate.tsx` — Suspension check ✅
19. `AdminAuditLog.tsx` — Log viewer component ✅
20. `src/app/admin/layout.tsx` — Route-specific layout (breaks out of max-w-6xl) ✅

**Phase 5 — Polish** ✅ COMPLETE
21. Dark mode compatibility (command-center dark theme throughout) ✅
22. Confirmation dialogs for destructive actions ✅
23. Toast notifications for action results (`src/components/Toast.tsx`) ✅
24. Error handling & loading states (skeleton loaders, error panels) ✅

---

## 10. Verification Plan

### Build Verification

```bash
npm run typecheck    # No TypeScript errors
npm run lint         # No lint errors
npm run build        # Production build succeeds
```

### Manual Testing Checklist

Since this involves role-gated UI with destructive admin operations, manual testing is the primary verification strategy:

**Pre-requisite**: Seed an admin user via Supabase SQL:
```sql
INSERT INTO user_roles (user_id, role) VALUES ('<your-uuid>', 'admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

**1. Access Control**
- [ ] Navigate to `/admin` as a non-admin user → Should see "Access Denied"
- [ ] Navigate to `/admin` as an admin user → Should see admin dashboard
- [ ] NavBar shows admin link only for admin users
- [ ] Suspended users cannot log in or access any page

**2. User List**
- [ ] User list loads with pagination
- [ ] Search by email filters results
- [ ] Role dropdown filter works
- [ ] Status dropdown filter works (Active / Suspended)
- [ ] Sorting works on all sortable columns

**3. Role Management**
- [ ] Click a user → Detail panel opens
- [ ] Change role from `user` to `admin` → Confirmation dialog → Role updates
- [ ] Change role from `admin` to `user` → Works correctly
- [ ] Audit log shows the role change entry

**4. Account Management**
- [ ] Change a user's email → Email updates in Supabase Auth
- [ ] Reset password → Generates reset link (can verify in Supabase dashboard)
- [ ] Suspend user → User shows as suspended in list, cannot log in
- [ ] Unsuspend user → User can log in again

**5. Data Management**
- [ ] Delete all data → Shows confirmation → Returns deletion counts
- [ ] Delete only blocked suggestions → Only blocked_suggestions cleared
- [ ] Delete only liked suggestions → Only liked feedback cleared
- [ ] Delete only import data → Only film events/mappings/diary cleared
- [ ] Audit log records each deletion with counts

**6. API Key Management** (after API Plan Phase 1)
- [ ] View user's API keys (prefix + label, no secret data)
- [ ] Revoke individual key → Key shows as revoked
- [ ] Revoke all keys → All keys revoked
- [ ] Audit log records revocations

**7. View-As**
- [ ] Select a user → View As tab shows their taste profile
- [ ] Read-only banner is prominently visible
- [ ] No modifications can be made in view-as mode

**8. Audit Log**
- [ ] All admin actions appear in the audit log
- [ ] Log shows admin email, action type, target user, timestamp
- [ ] Filter by action type works
- [ ] Pagination works
