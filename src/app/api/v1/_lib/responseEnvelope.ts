import crypto from "node:crypto";

import { NextResponse } from "next/server";

export interface ApiPagination {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface ApiMeta {
  timestamp: string;
  requestId: string;
  pagination?: ApiPagination;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function buildMeta(meta?: Partial<ApiMeta>): ApiMeta {
  return {
    timestamp: meta?.timestamp ?? new Date().toISOString(),
    requestId: meta?.requestId ?? generateRequestId(),
    ...(meta?.pagination ? { pagination: meta.pagination } : {}),
  };
}

export function generateRequestId(): string {
  return `req_${crypto.randomBytes(6).toString("hex")}`;
}

export function apiSuccess<T>(data: T, meta?: Partial<ApiMeta>) {
  return NextResponse.json({
    data,
    meta: buildMeta(meta),
    error: null,
  });
}

export function apiPaginated<T>(data: T, pagination: ApiPagination) {
  return NextResponse.json({
    data,
    meta: buildMeta({ pagination }),
    error: null,
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      data: null,
      meta: buildMeta(),
      error: {
        code,
        message,
        details: details ?? null,
      },
    },
    { status },
  );
}
