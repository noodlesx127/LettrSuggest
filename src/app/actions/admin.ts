"use server";

import type { User } from "@supabase/auth-js";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type UserRole = "user" | "developer" | "admin";
export type UserStatus = "active" | "suspended";

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  last_sign_in_at: string | null;
  film_count: number;
  api_key_count: number;
}

export interface UserDetail {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  suspended_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  film_count: number;
  rating_count: number;
  watchlist_count: number;
  diary_count: number;
  api_key_count: number;
}

export interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_email: string;
  target_id: string | null;
  target_email: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface TasteProfileSummary {
  topGenres: string[];
  topActors: string[];
  topDirectors: string[];
  likedCount: number;
  dislikedCount: number;
}

type AuthUserSummary = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  suspended_at: string | null;
};

type UserRoleRow = {
  user_id: string;
  role: UserRole;
};

type FilmEventUserRow = {
  user_id: string;
};

type AuditLogRow = {
  id: string;
  admin_id: string;
  target_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type FeatureFeedbackRow = {
  feature_type: string;
  feature_name: string | null;
  positive_count: number | null;
  negative_count: number | null;
};

function asUserRole(value: unknown): UserRole {
  if (value === "admin" || value === "developer" || value === "user") {
    return value;
  }

  return "user";
}

function asUserStatus(suspendedAt: string | null | undefined): UserStatus {
  return suspendedAt ? "suspended" : "active";
}

function normalizeEmail(value: string | null | undefined): string {
  return value ?? "";
}

function normalizeDate(value: string | null | undefined): string {
  return value ?? new Date(0).toISOString();
}

function toAuthUserSummary(user: User): AuthUserSummary {
  return {
    id: user.id,
    email: normalizeEmail(user.email),
    created_at: normalizeDate(user.created_at),
    last_sign_in_at: user.last_sign_in_at ?? null,
  };
}

function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
): PaginatedResult<T> {
  const start = (page - 1) * perPage;

  return {
    data: items.slice(start, start + perPage),
    total: items.length,
    page,
    perPage,
  };
}

function extractDeletedCounts(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const deleted = record.deleted;
  if (!deleted || typeof deleted !== "object") {
    return {};
  }

  const counts: Record<string, number> = {};

  for (const [key, value] of Object.entries(
    deleted as Record<string, unknown>,
  )) {
    counts[key] = typeof value === "number" ? value : 0;
  }

  return counts;
}

function sortAdminUsers(
  users: AdminUser[],
  sortBy: string,
  sortDir: "asc" | "desc",
): AdminUser[] {
  const direction = sortDir === "asc" ? 1 : -1;

  return [...users].sort((left, right) => {
    const result = (() => {
      switch (sortBy) {
        case "email":
          return left.email.localeCompare(right.email);
        case "role":
          return left.role.localeCompare(right.role);
        case "status":
          return left.status.localeCompare(right.status);
        case "film_count":
          return left.film_count - right.film_count;
        case "last_sign_in_at":
          return (left.last_sign_in_at ?? "").localeCompare(
            right.last_sign_in_at ?? "",
          );
        case "created_at":
        default:
          return left.created_at.localeCompare(right.created_at);
      }
    })();

    return result * direction;
  });
}

function getTopFeatureNames(
  rows: FeatureFeedbackRow[],
  featureType: string,
  limit = 10,
): string[] {
  return rows
    .filter((row) => row.feature_type === featureType && row.feature_name)
    .map((row) => {
      const positive = row.positive_count ?? 0;
      const negative = row.negative_count ?? 0;

      return {
        name: row.feature_name ?? "",
        score: positive - negative,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => row.name);
}

async function safeCount(
  queryPromise: PromiseLike<{ count: number | null; error: unknown | null }>,
): Promise<number> {
  try {
    const { count, error } = await queryPromise;
    if (error) {
      return 0;
    }

    return count ?? 0;
  } catch {
    return 0;
  }
}

async function requireAdmin(
  accessToken: string,
): Promise<{ adminId: string; adminEmail: string }> {
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error("Not authenticated");
  }

  const { data: roleRow, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleError || roleRow?.role !== "admin") {
    throw new Error("Admin access required");
  }

  return {
    adminId: user.id,
    adminEmail: normalizeEmail(user.email),
  };
}

async function logAudit(
  adminId: string,
  action: string,
  targetId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    admin_id: adminId,
    target_id: targetId ?? null,
    action,
    details: details ?? {},
  });

  if (error) {
    throw error;
  }
}

async function fetchAllAuthUsers(): Promise<AuthUserSummary[]> {
  const authUsers: AuthUserSummary[] = [];
  const perPage = 100;
  const scanCap = 5000;
  let page = 1;

  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    authUsers.push(...data.users.map(toAuthUserSummary));

    if (!data.nextPage) {
      break;
    }

    page = data.nextPage;

    if (authUsers.length >= scanCap) {
      throw new Error(`Too many auth users to scan (cap ${scanCap})`);
    }
  }

  return authUsers;
}

async function fetchProfilesByIds(
  userIds: string[],
): Promise<Map<string, ProfileRow>> {
  const profilesById = new Map<string, ProfileRow>();

  for (let index = 0; index < userIds.length; index += 500) {
    const chunk = userIds.slice(index, index + 500);
    if (!chunk.length) {
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, created_at, suspended_at")
      .in("id", chunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as ProfileRow[]) {
      profilesById.set(row.id, row);
    }
  }

  return profilesById;
}

async function fetchRolesByUserIds(
  userIds: string[],
): Promise<Map<string, UserRole>> {
  const rolesByUserId = new Map<string, UserRole>();

  for (let index = 0; index < userIds.length; index += 500) {
    const chunk = userIds.slice(index, index + 500);
    if (!chunk.length) {
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", chunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as UserRoleRow[]) {
      rolesByUserId.set(row.user_id, asUserRole(row.role));
    }
  }

  return rolesByUserId;
}

async function fetchFilmCountsByUserIds(
  userIds: string[],
): Promise<Map<string, number>> {
  const countsByUserId = new Map<string, number>();

  for (const userId of userIds) {
    countsByUserId.set(userId, 0);
  }

  for (let index = 0; index < userIds.length; index += 200) {
    const chunk = userIds.slice(index, index + 200);
    if (!chunk.length) {
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("film_events")
      .select("user_id")
      .in("user_id", chunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as FilmEventUserRow[]) {
      countsByUserId.set(
        row.user_id,
        (countsByUserId.get(row.user_id) ?? 0) + 1,
      );
    }
  }

  return countsByUserId;
}

async function fetchEmailsByUserIds(
  userIds: string[],
): Promise<Map<string, string>> {
  if (!userIds.length) {
    return new Map<string, string>();
  }

  const profilesById = await fetchProfilesByIds(userIds);
  const emailsById = new Map<string, string>();

  for (const userId of userIds) {
    emailsById.set(userId, normalizeEmail(profilesById.get(userId)?.email));
  }

  return emailsById;
}

export async function listUsers(
  accessToken: string,
  opts?: {
    page?: number;
    perPage?: number;
    search?: string;
    roleFilter?: string;
    statusFilter?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
  },
): Promise<PaginatedResult<AdminUser>> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] listUsers", { adminId, opts });

  const page = Math.max(1, opts?.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts?.perPage ?? 25));
  const search = (opts?.search ?? "").trim().toLowerCase();
  const roleFilter = opts?.roleFilter ? asUserRole(opts.roleFilter) : null;
  const statusFilter: UserStatus | null =
    opts?.statusFilter === "active" || opts?.statusFilter === "suspended"
      ? opts.statusFilter
      : null;
  const sortBy = opts?.sortBy ?? "created_at";
  const sortDir = opts?.sortDir ?? "desc";

  const authUsers = await fetchAllAuthUsers();
  const userIds = authUsers.map((user) => user.id);

  if (!userIds.length) {
    return {
      data: [],
      total: 0,
      page,
      perPage,
    };
  }

  const [profilesById, rolesByUserId, filmCountsByUserId] = await Promise.all([
    fetchProfilesByIds(userIds),
    fetchRolesByUserIds(userIds),
    fetchFilmCountsByUserIds(userIds),
  ]);

  const users = authUsers.map((authUser) => {
    const profile = profilesById.get(authUser.id);
    const role = rolesByUserId.get(authUser.id) ?? "user";
    const status = asUserStatus(profile?.suspended_at ?? null);

    return {
      id: authUser.id,
      email: normalizeEmail(profile?.email) || authUser.email,
      role,
      status,
      created_at: normalizeDate(profile?.created_at) || authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at,
      film_count: filmCountsByUserId.get(authUser.id) ?? 0,
      api_key_count: 0, // TODO: implement when api_keys table is created
    } satisfies AdminUser;
  });

  const filteredUsers = users.filter((user) => {
    if (search && !user.email.toLowerCase().includes(search)) {
      return false;
    }

    if (roleFilter && user.role !== roleFilter) {
      return false;
    }

    if (statusFilter && user.status !== statusFilter) {
      return false;
    }

    return true;
  });

  return paginate(
    sortAdminUsers(filteredUsers, sortBy, sortDir),
    page,
    perPage,
  );
}

export async function getUserDetail(
  accessToken: string,
  userId: string,
): Promise<UserDetail> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] getUserDetail", { adminId, userId });

  const [authResponse, profileResponse, roleResponse] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("profiles")
      .select("id, email, created_at, suspended_at")
      .eq("id", userId)
      .single(),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (authResponse.error) {
    throw authResponse.error;
  }

  if (profileResponse.error) {
    throw profileResponse.error;
  }

  if (roleResponse.error) {
    throw roleResponse.error;
  }

  const authUser = toAuthUserSummary(authResponse.data.user);
  const profile = profileResponse.data as ProfileRow;
  const role = asUserRole(roleResponse.data?.role);
  const suspendedAt = profile.suspended_at;

  const [filmCount, ratingCount, watchlistCount, diaryCount] =
    await Promise.all([
      safeCount(
        supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
      ),
      safeCount(
        supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("rating", "is", null),
      ),
      safeCount(
        supabaseAdmin
          .from("saved_suggestions")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
      ),
      safeCount(
        supabaseAdmin
          .from("film_diary_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
      ),
    ]);

  return {
    id: userId,
    email: normalizeEmail(profile.email) || authUser.email,
    role,
    status: asUserStatus(suspendedAt),
    suspended_at: suspendedAt,
    created_at: profile.created_at ?? authUser.created_at,
    last_sign_in_at: authUser.last_sign_in_at,
    film_count: filmCount,
    rating_count: ratingCount,
    watchlist_count: watchlistCount,
    diary_count: diaryCount,
    api_key_count: 0, // TODO: implement when api_keys table is created
  };
}

export async function changeUserRole(
  accessToken: string,
  userId: string,
  newRole: UserRole,
): Promise<void> {
  const { adminId } = await requireAdmin(accessToken);
  if (userId === adminId) {
    throw new Error("Cannot change your own admin role");
  }

  console.log("[AdminAction] changeUserRole", { adminId, userId, newRole });

  const { data: existingRole, error: existingRoleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingRoleError) {
    throw existingRoleError;
  }

  const { error: updateError } = await supabaseAdmin.from("user_roles").upsert({
    user_id: userId,
    role: newRole,
  });

  if (updateError) {
    throw updateError;
  }

  await logAudit(adminId, "role.changed", userId, {
    from: asUserRole(existingRole?.role),
    to: newRole,
  });
}

export async function changeUserEmail(
  accessToken: string,
  userId: string,
  newEmail: string,
): Promise<void> {
  const { adminId } = await requireAdmin(accessToken);
  const trimmedEmail = newEmail.trim().toLowerCase();
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error("Invalid email address");
  }

  console.log("[AdminAction] changeUserEmail", {
    adminId,
    userId,
    newEmail: trimmedEmail,
  });

  const { data: existingUser, error: existingUserError } =
    await supabaseAdmin.auth.admin.getUserById(userId);

  if (existingUserError) {
    throw existingUserError;
  }

  const oldEmail = normalizeEmail(existingUser.user.email);
  const { error: authUpdateError } =
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: trimmedEmail,
    });

  if (authUpdateError) {
    throw authUpdateError;
  }

  const { error: profileUpdateError } = await supabaseAdmin
    .from("profiles")
    .update({ email: trimmedEmail })
    .eq("id", userId);

  if (profileUpdateError) {
    console.error("[AdminAction] changeUserEmail profile sync failed", {
      userId,
      profileUpdateError,
    });
    throw new Error(
      "Auth email updated but profile sync failed — retry may be needed",
    );
  }

  await logAudit(adminId, "account.email_changed", userId, {
    from: oldEmail,
    to: trimmedEmail,
  });
}

export async function resetUserPassword(
  accessToken: string,
  userId: string,
): Promise<{ resetLink: string }> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] resetUserPassword", { adminId, userId });

  const { data: userResponse, error: userError } =
    await supabaseAdmin.auth.admin.getUserById(userId);

  if (userError) {
    throw userError;
  }

  const email = userResponse.user.email;
  if (!email) {
    throw new Error("User has no email");
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error) {
    throw error;
  }

  const resetLink = data.properties?.action_link;
  if (!resetLink) {
    throw new Error("Failed to generate reset link");
  }

  await logAudit(adminId, "account.password_reset", userId);

  return { resetLink };
}

export async function suspendUser(
  accessToken: string,
  userId: string,
): Promise<void> {
  const { adminId } = await requireAdmin(accessToken);
  if (userId === adminId) {
    throw new Error("Cannot suspend your own account");
  }

  console.log("[AdminAction] suspendUser", { adminId, userId });

  const suspendedAt = new Date().toISOString();

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ suspended_at: suspendedAt })
    .eq("id", userId);

  if (profileError) {
    throw profileError;
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: "876000h" },
  );

  if (banError) {
    throw banError;
  }

  await logAudit(adminId, "account.suspended", userId);
}

export async function unsuspendUser(
  accessToken: string,
  userId: string,
): Promise<void> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] unsuspendUser", { adminId, userId });

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ suspended_at: null })
    .eq("id", userId);

  if (profileError) {
    throw profileError;
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: "none" },
  );

  if (banError) {
    throw banError;
  }

  await logAudit(adminId, "account.unsuspended", userId);
}

export async function deleteUserData(
  accessToken: string,
  userId: string,
  scope: "all" | "blocked" | "liked" | "import",
): Promise<Record<string, number>> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] deleteUserData", { adminId, userId, scope });

  const { data, error } = await supabaseAdmin.rpc("admin_delete_user_data", {
    target_user_id: userId,
    scope,
  });

  if (error) {
    throw error;
  }

  const counts = extractDeletedCounts(data);

  await logAudit(adminId, "data.deleted", userId, {
    type: scope,
    counts,
  });

  return counts;
}

export async function getUserApiKeys(
  accessToken: string,
  userId: string,
): Promise<[]> {
  await requireAdmin(accessToken);
  console.warn("[AdminAction] api_keys table not yet implemented", { userId });
  return [];
}

export async function revokeUserApiKey(
  accessToken: string,
  userId: string,
  keyId: string,
): Promise<void> {
  await requireAdmin(accessToken);
  console.warn(
    "[AdminAction] revokeUserApiKey: api_keys table not yet implemented",
    {
      userId,
      keyId,
    },
  );
}

export async function revokeAllUserApiKeys(
  accessToken: string,
  userId: string,
): Promise<void> {
  await requireAdmin(accessToken);
  console.warn(
    "[AdminAction] revokeAllUserApiKeys: api_keys table not yet implemented",
    { userId },
  );
}

export async function getAuditLog(
  accessToken: string,
  opts?: {
    page?: number;
    perPage?: number;
    actionFilter?: string;
  },
): Promise<PaginatedResult<AuditLogEntry>> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] getAuditLog", { adminId, opts });

  const page = Math.max(1, opts?.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts?.perPage ?? 25));

  let query = supabaseAdmin
    .from("admin_audit_log")
    .select("id, admin_id, target_id, action, details, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  const actionFilter = (opts?.actionFilter ?? "").trim();
  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AuditLogRow[];
  const userIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        row.target_id ? [row.admin_id, row.target_id] : [row.admin_id],
      ),
    ),
  );
  const emailsById = await fetchEmailsByUserIds(userIds);

  return {
    data: rows.map((row) => ({
      id: row.id,
      admin_id: row.admin_id,
      admin_email: emailsById.get(row.admin_id) ?? "",
      target_id: row.target_id,
      target_email: row.target_id
        ? (emailsById.get(row.target_id) ?? null)
        : null,
      action: row.action,
      details: row.details ?? {},
      created_at: row.created_at,
    })),
    total: count ?? rows.length,
    page,
    perPage,
  };
}

export async function getUserTasteProfile(
  accessToken: string,
  userId: string,
): Promise<TasteProfileSummary> {
  const { adminId } = await requireAdmin(accessToken);
  console.log("[AdminAction] getUserTasteProfile", { adminId, userId });

  const [featureResponse, likedCount, dislikedCount] = await Promise.all([
    supabaseAdmin
      .from("user_feature_feedback")
      .select("feature_type, feature_name, positive_count, negative_count")
      .eq("user_id", userId),
    safeCount(
      supabaseAdmin
        .from("suggestion_feedback")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("feedback_type", "positive"),
    ),
    safeCount(
      supabaseAdmin
        .from("suggestion_feedback")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("feedback_type", "negative"),
    ),
  ]);

  if (featureResponse.error) {
    throw featureResponse.error;
  }

  const rows = (featureResponse.data ?? []) as FeatureFeedbackRow[];

  return {
    topGenres: getTopFeatureNames(rows, "genre"),
    topActors: getTopFeatureNames(rows, "actor"),
    topDirectors: getTopFeatureNames(rows, "director"),
    likedCount,
    dislikedCount,
  };
}
