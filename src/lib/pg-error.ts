/** Postgres SQLSTATE and constraint name from a driver error, unwrapping drizzle's DrizzleQueryError. */
export function pgError(error: unknown) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e.cause?.code ?? e.code, constraint: e.cause?.constraint ?? e.constraint };
}
