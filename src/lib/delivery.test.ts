import { describe, expect, it } from "vitest";

import { COUNTIES, normalizeKenyanPhone, parseDelivery } from "@/lib/delivery";

describe("normalizeKenyanPhone", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0712 345 678", "+254712345678"],
    ["0112-345-678", "+254112345678"],
    ["254712345678", "+254712345678"],
    ["+254 712 345 678", "+254712345678"],
    ["712345678", "+254712345678"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(["", "071234567", "07123456789", "0212345678", "+255712345678", "07123a5678", "+2540712345678"])(
    "rejects %j",
    (input) => {
      expect(normalizeKenyanPhone(input)).toBeNull();
    },
  );
});

describe("parseDelivery", () => {
  const valid = {
    fullName: "  Wanjiku Kamau ",
    phone: "0712 345 678",
    county: "Nairobi",
    town: "Westlands",
    address: "Mpaka Road, Apartment 4B",
  };

  it("trims text and normalises the phone number", () => {
    expect(parseDelivery(valid)).toEqual({
      ok: true,
      delivery: { ...valid, fullName: "Wanjiku Kamau", phone: "+254712345678" },
    });
  });

  it("has all 47 counties", () => {
    expect(new Set(COUNTIES).size).toBe(47);
  });

  it("reports every invalid field", () => {
    expect(parseDelivery({ fullName: " ", phone: "12345", county: "Atlantis", town: "", address: 42 })).toEqual({
      ok: false,
      errors: {
        fullName: "Please enter your full name.",
        phone: "Please enter a Kenyan mobile number, e.g. 0712 345 678.",
        county: "Please choose your county.",
        town: "Please enter your town.",
        address: "Please enter your delivery address.",
      },
    });
  });

  it("limits field length", () => {
    expect(parseDelivery({ ...valid, address: "x".repeat(301) })).toEqual({
      ok: false,
      errors: { address: "Please use at most 300 characters." },
    });
  });
});
