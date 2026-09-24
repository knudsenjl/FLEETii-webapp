import { describe, expect, it } from "vitest";
import { generateTemporaryPassword } from "./userAccount.js";

describe("generateTemporaryPassword", () => {
  it("is 12 characters with at least one lowercase letter, uppercase letter and digit", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it("never uses look-alike characters (0/O/o, 1/l/I)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTemporaryPassword()).not.toMatch(/[0Oo1lI]/);
    }
  });

  it("gives every account a different password", () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(500);
  });
});
