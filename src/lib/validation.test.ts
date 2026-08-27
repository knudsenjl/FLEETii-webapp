import { describe, expect, it } from "vitest";
import { EMAIL_PATTERN, PHONE_PATTERN } from "./validation";

describe("PHONE_PATTERN", () => {
  it("accepts a plain 8-digit Danish number", () => {
    expect(PHONE_PATTERN.test("70608689")).toBe(true);
  });

  it("accepts a Danish number grouped with spaces", () => {
    expect(PHONE_PATTERN.test("70 60 86 89")).toBe(true);
  });

  it("accepts a leading country code", () => {
    expect(PHONE_PATTERN.test("+45 70 60 86 89")).toBe(true);
  });

  it("accepts a 1-3 digit country code with no separator before the rest", () => {
    expect(PHONE_PATTERN.test("+4570608689")).toBe(true);
  });

  it("accepts a parenthesized area code", () => {
    expect(PHONE_PATTERN.test("(143) 234 453 22")).toBe(true);
  });

  it("accepts a country code plus a parenthesized group", () => {
    expect(PHONE_PATTERN.test("+1 (999) 123-4567")).toBe(true);
  });

  it("accepts groups separated by dashes", () => {
    expect(PHONE_PATTERN.test("123-456-78")).toBe(true);
  });

  it("accepts mixed space/dash separators", () => {
    expect(PHONE_PATTERN.test("123 456-78")).toBe(true);
  });

  it("accepts runs of multiple spaces between groups", () => {
    expect(PHONE_PATTERN.test("70  60 86 89")).toBe(true);
  });

  it("rejects fewer than 8 digits", () => {
    expect(PHONE_PATTERN.test("1234567")).toBe(false);
  });

  it("rejects a whitespace-only string (spaces don't count as digits)", () => {
    expect(PHONE_PATTERN.test("        ")).toBe(false);
  });

  it("rejects letters mixed into the number", () => {
    expect(PHONE_PATTERN.test("7060868x")).toBe(false);
  });

  it("rejects a double leading plus", () => {
    expect(PHONE_PATTERN.test("++45 70608689")).toBe(false);
  });

  it("rejects empty parentheses", () => {
    expect(PHONE_PATTERN.test("() 70608689")).toBe(false);
  });

  it("rejects leading/trailing whitespace (callers must trim first)", () => {
    expect(PHONE_PATTERN.test(" 70608689")).toBe(false);
    expect(PHONE_PATTERN.test("70608689 ")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(PHONE_PATTERN.test("")).toBe(false);
  });
});

describe("EMAIL_PATTERN", () => {
  it("accepts a plausible email address", () => {
    expect(EMAIL_PATTERN.test("dig@virksomhed.dk")).toBe(true);
  });

  it("rejects a value with no @", () => {
    expect(EMAIL_PATTERN.test("dig-virksomhed.dk")).toBe(false);
  });

  it("rejects a value with no domain dot", () => {
    expect(EMAIL_PATTERN.test("dig@virksomhed")).toBe(false);
  });
});
