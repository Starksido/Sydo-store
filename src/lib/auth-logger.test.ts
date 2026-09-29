import { afterEach, describe, expect, it, vi } from "vitest";

import { authLogger, describeError } from "@/lib/auth-logger";

/** Shaped like drizzle's DrizzleQueryError wrapping a driver error. */
function failedQuery() {
  const driverError = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
  const error = new Error('Failed query: select "id" from "session" where "session"."token" = $1\nparams: secret-token', {
    cause: driverError,
  });
  error.name = "DrizzleQueryError";
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeError", () => {
  it("includes the cause chain and redacts query params", () => {
    const text = describeError(failedQuery());

    expect(text).toBe(
      'DrizzleQueryError: Failed query: select "id" from "session" where "session"."token" = $1\nparams: [redacted]' +
        "\n  caused by: Error [ECONNRESET]: fetch failed",
    );
    expect(text).not.toContain("secret-token");
  });

  it("stops at a cause cycle", () => {
    const error = new Error("loop");
    error.cause = error;

    expect(describeError(error).split("caused by")).toHaveLength(5);
  });

  it("handles non-Error values", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("outer", { cause: { reason: 1 } }))).toBe(
      "Error: outer\n  caused by: [object Object]",
    );
  });
});

describe("authLogger", () => {
  it("logs errors at their level with the cause chain", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    authLogger.log!("error", "INTERNAL_SERVER_ERROR", failedQuery());

    expect(error).toHaveBeenCalledWith(
      "[Better Auth] INTERNAL_SERVER_ERROR",
      expect.stringContaining("caused by: Error [ECONNRESET]: fetch failed"),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-token");
  });

  it("passes other arguments through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    authLogger.log!("warn", "something", { detail: 1 });

    expect(warn).toHaveBeenCalledWith("[Better Auth] something", { detail: 1 });
  });
});
