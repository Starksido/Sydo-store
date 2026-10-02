import { describe, expect, it } from "vitest";

import { checkPassword } from "@/lib/password-strength";

describe("checkPassword", () => {
  it("rates common passwords, patterns and sequences too weak", () => {
    for (const password of ["123456789", "12345678910", "password1", "qwertyuiop", "aaaaaaaaaa", "sydo12345678"]) {
      expect(checkPassword(password).ok, password).toBe(false);
    }
  });

  it("rates long passphrases and random passwords strong", () => {
    for (const password of ["lantern orchard river", "Nairobi tea at seven", "kV9#tq2!mPz7"]) {
      expect(checkPassword(password).ok, password).toBe(true);
    }
  });

  it("counts the person's name and email as easy to guess", () => {
    expect(checkPassword("Wanjiku2026!", ["Wanjiku Kamau", "wanjiku@example.com"])).toMatchObject({
      ok: false,
      warning: expect.any(String),
    });
  });

  it("explains what's wrong", () => {
    expect(checkPassword("password1")).toMatchObject({ label: "Too weak", warning: expect.stringMatching(/common/i) });
  });
});
