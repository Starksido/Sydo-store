import { describe, expect, it } from "vitest";

import { orderCancelReason } from "@/db/schema";
import { parseRefund, parseStatusChange, parseTracking, readStatusChangeForm, todayInNairobi } from "@/lib/admin/order-input";
import { CANCEL_REASONS } from "@/lib/catalog";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseStatusChange", () => {
  it("reads a step forward, keeping tracking only when shipping", () => {
    expect(
      parseStatusChange(
        readStatusChangeForm(
          form({ expected: "processing", to: "shipped", carrier: " G4S ", trackingNumber: "", note: " Two boxes " }),
        ),
      ),
    ).toEqual({
      ok: true,
      input: {
        expected: "processing",
        to: "shipped",
        cancelReason: null,
        note: "Two boxes",
        carrier: "G4S",
        trackingNumber: null,
      },
    });
    expect(
      parseStatusChange(readStatusChangeForm(form({ expected: "paid", to: "processing", carrier: "G4S" }))),
    ).toMatchObject({ ok: true, input: { carrier: null } });
  });

  it("requires a listed reason to cancel", () => {
    const cancel = (cancelReason: string) =>
      parseStatusChange(readStatusChangeForm(form({ expected: "paid", to: "cancelled", cancelReason })));
    expect(cancel("out_of_stock")).toMatchObject({ ok: true, input: { cancelReason: "out_of_stock" } });
    expect(cancel("")).toMatchObject({ ok: false, errors: { cancelReason: expect.any(String) } });
    expect(cancel("bored")).toMatchObject({ ok: false, errors: { cancelReason: expect.any(String) } });
  });

  it("refuses long notes and tracking, and returns null for tampered statuses", () => {
    expect(
      parseStatusChange(
        readStatusChangeForm(
          form({ expected: "processing", to: "shipped", note: "x".repeat(501), trackingNumber: "x".repeat(101) }),
        ),
      ),
    ).toMatchObject({ ok: false, errors: { note: expect.any(String), trackingNumber: expect.any(String) } });
    expect(parseStatusChange(readStatusChangeForm(form({ expected: "paid", to: "lost" })))).toBeNull();
    expect(parseStatusChange(readStatusChangeForm(form({ to: "processing" })))).toBeNull();
  });

  it("offers exactly the cancel reasons the database accepts", () => {
    expect(Object.keys(CANCEL_REASONS)).toEqual(orderCancelReason.enumValues);
  });
});

describe("parseTracking", () => {
  it("trims, and treats empty fields as not set", () => {
    expect(parseTracking(form({ carrier: " DHL ", trackingNumber: " " }))).toMatchObject({
      ok: true,
      input: { carrier: "DHL", trackingNumber: null },
    });
  });
});

describe("parseRefund", () => {
  const now = new Date("2026-10-02T21:30:00Z"); // 3 October, 00:30 in Nairobi

  it("takes a reference and a past or current date in Nairobi", () => {
    expect(todayInNairobi(now)).toBe("2026-10-03");
    expect(parseRefund(form({ refundReference: " RF_123 ", refundedOn: "2026-10-03" }), now)).toMatchObject({
      ok: true,
      input: { refundReference: "RF_123", refundedOn: "2026-10-03" },
    });
  });

  it("refuses a missing reference, and missing, impossible or future dates", () => {
    const errors = (fields: Record<string, string>) => {
      const result = parseRefund(form({ refundReference: "RF", refundedOn: "2026-10-01", ...fields }), now);
      return result.ok ? {} : result.errors;
    };
    expect(errors({ refundReference: "" })).toHaveProperty("refundReference");
    expect(errors({ refundReference: "x".repeat(101) })).toHaveProperty("refundReference");
    for (const refundedOn of ["", "yesterday", "2026-02-30", "2026-13-01", "2026-10-04", "2019-12-31"]) {
      expect(errors({ refundedOn }), refundedOn).toHaveProperty("refundedOn");
    }
  });
});
