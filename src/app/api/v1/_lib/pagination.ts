import { ApiError, type ApiPagination } from "./responseEnvelope";

export interface PaginationParams {
  page: number;
  perPage: number;
  offset: number;
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePage(searchParams: URLSearchParams): number {
  const parsed = parseInt(searchParams.get("page") ?? "1", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
}

export function parsePerPage(
  searchParams: URLSearchParams,
  defaultVal = 20,
): number {
  const parsed = parseInt(
    searchParams.get("per_page") ?? String(defaultVal),
    10,
  );

  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, parsed))
    : defaultVal;
}

export function getPaginationParams(
  searchParams: URLSearchParams,
): PaginationParams {
  const page = parsePage(searchParams);
  const perPage = parsePerPage(searchParams);

  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
  };
}

export function buildPagination(
  page: number,
  perPage: number,
  total: number,
): ApiPagination {
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

  return {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export function parsePositiveInteger(value: string, fieldName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "BAD_REQUEST", `Invalid ${fieldName}`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "BAD_REQUEST", `Invalid ${fieldName}`);
  }

  return parsed;
}

export function parseOptionalPositiveInteger(
  value: string | null,
  fieldName: string,
): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  return parsePositiveInteger(value, fieldName);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
