# Privileged Function Inventory

**Catalog snapshot:** 2026-07-20  
**Environment:** linked Supabase project `xtcsekftikdsauttlcin`  
**Scope:** all `public` `SECURITY DEFINER` functions plus every live overload of the five checkpoint targets

## Findings

The live catalog contains one overload of each checkpoint target. All five grant `EXECUTE` to `PUBLIC`, `anon`, `authenticated`, `postgres`, and `service_role`. Because PostgreSQL role privileges are additive, revoking only the explicit `anon` or `authenticated` grant would not remove access while `PUBLIC` retains `EXECUTE`.

Four target bodies trust caller-supplied identifiers without checking the effective user. `delete_user_data(uuid)` is the exception: it rejects a target different from `auth.uid()`. `admin_delete_user_data(uuid, text)` exists in production but has no defining migration in this repository, so the database and migration history have drifted.

## Target Functions

| Effective signature | Owner | Mode / search path | Effective executable roles | Body authorization | Current caller and intended boundary |
| --- | --- | --- | --- | --- | --- |
| `add_liked_suggestion(p_user_id uuid, p_tmdb_id integer, p_title text, p_year integer, p_poster_path text)` | `postgres` | `SECURITY DEFINER`; `SET search_path = ''` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | None; reads and writes arbitrary `p_user_id` | `src/app/api/v1/suggestions/liked/route.ts` uses `supabaseAdmin` after `withApiAuth`. This is a self-service operation; 0A.2 must enforce self identity or make the routine service-only while preserving route authentication. |
| `get_film_stats(p_user_id uuid)` | `postgres` | `SECURITY DEFINER`; `SET search_path = ''` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | None; reads arbitrary `p_user_id` | `src/app/api/v1/stats/route.ts` uses `supabaseAdmin` after `withApiAuth`. This is a self-service read and must not expose another user's statistics. |
| `increment_rate_limit(p_key_id uuid, p_window_start timestamp with time zone)` | `postgres` | `SECURITY DEFINER`; `SET search_path = ''` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | None; writes an arbitrary key's bucket | `src/app/api/v1/_lib/rateLimiter.ts` uses `supabaseAdmin`. Intended caller is service-only rate-limit infrastructure. |
| `delete_user_data(target_user_id uuid)` | `postgres` | `SECURITY DEFINER`; `SET search_path = public` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Rejects when `auth.uid() != target_user_id` | `src/app/profile/page.tsx` calls through the authenticated browser client. Intended caller is authenticated self only. Its mutable `public` search path must also be fixed. |
| `admin_delete_user_data(target_user_id uuid, scope text)` | `postgres` | `SECURITY DEFINER`; `SET search_path = ''` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | None; deletes arbitrary target data for `blocked`, `liked`, `import`, or `all` | `src/app/actions/admin.ts` verifies `user_roles`, then calls with `supabaseAdmin`. The function itself must enforce an admin or tightly service-only boundary. No repository migration defines this live function. |

## Other Public Security-Definer Functions

| Effective signature | Owner | Search path | Effective executable roles | Intended caller / call site |
| --- | --- | --- | --- | --- |
| `handle_new_user()` | `postgres` | `SET search_path = ''` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only: `on_auth_user_created` on `auth.users`. |
| `handle_new_user_role()` | `postgres` | `SET search_path = public` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only: `on_auth_user_created_role` on `auth.users`. |
| `is_admin(check_user_id uuid)` | `postgres` | `SET search_path = public` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | RLS helper used by policies created in `20260322001014_fix_user_roles_recursive_rls.sql` and `20260405120000_fix_rls_performance.sql`. Direct arbitrary-ID execution also exposes role status and should be reviewed in 0A.2. |
| `prune_api_caches(retention_days integer)` | `postgres` | `SET search_path = ''` | `postgres`, `anon`, `authenticated`, `service_role` | Maintenance/cron operation; no application call site found. It should be service/maintenance-only. |
| `sync_film_events_last_date()` | `postgres` | `SET search_path = public` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` | Trigger-only: `trg_sync_film_events_last_date` on `public.film_diary_events_raw`. |

## Baseline Contract

`supabase/tests/database/privileged_functions.test.sql` verifies exact target signatures, requires no `anon` privileges, inspects each ACL for inherited `PUBLIC EXECUTE`, and performs cross-user calls as one of two synthetic authenticated users. The fixture and all writes are enclosed in a transaction and rolled back.

The intended pre-fix outcome is a failing suite. ACL assertions should fail for all five targets. Cross-user calls should also fail for liked suggestions, film stats, rate limiting, and admin deletion because their bodies currently accept foreign identifiers. The cross-user deletion assertion should pass because `delete_user_data(uuid)` already checks `auth.uid()`.
