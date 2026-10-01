import { describe, expect, it, vi } from "vitest";

import { safeRedirect } from "@/lib/session";

// safeRedirect doesn't touch auth; this keeps the module from needing BETTER_AUTH_SECRET.
vi.mock("@/lib/auth", () => ({ auth: {} }));

describe("safeRedirect", () => {
  it("keeps same-origin paths, with their query and hash", () => {
    expect(safeRedirect("/account")).toBe("/account");
    expect(safeRedirect("/checkout?step=2#delivery")).toBe("/checkout?step=2#delivery");
    expect(safeRedirect("/orders/SY-7K4Q9M2X")).toBe("/orders/SY-7K4Q9M2X");
    expect(safeRedirect("/products/../cart")).toBe("/cart");
  });

  it("refuses anything a browser would send to another site", () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      "/\t\\evil.com",
      "\t//evil.com",
      " //evil.com",
      "javascript:alert(1)",
      "evil.com",
      // Dot segments that collapse into a leading // once resolved.
      "/.//evil.com",
      "/a/..//evil.com",
      "/%2e//evil.com",
      "/./\\evil.com",
    ]) {
      expect(safeRedirect(next), JSON.stringify(next)).toBe("/account");
    }
  });

  it("falls back to the account page for missing or non-string values", () => {
    expect(safeRedirect(undefined)).toBe("/account");
    expect(safeRedirect(["/cart", "//evil.com"])).toBe("/account");
    expect(safeRedirect("")).toBe("/account");
  });
});
