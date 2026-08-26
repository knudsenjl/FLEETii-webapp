import { describe, expect, it } from "vitest";
import { asNormalizedNumberString, asTrimmedString } from "./requestValidation";

describe("asTrimmedString", () => {
  it("trims a valid string", () => {
    expect(asTrimmedString("  AB12345  ")).toBe("AB12345");
  });

  it("returns undefined for a missing value", () => {
    expect(asTrimmedString(undefined)).toBeUndefined();
  });

  it("returns undefined for a number instead of throwing", () => {
    expect(asTrimmedString(12345)).toBeUndefined();
  });

  it("returns undefined for null instead of throwing", () => {
    expect(asTrimmedString(null)).toBeUndefined();
  });

  it("returns undefined for an object or array instead of throwing", () => {
    expect(asTrimmedString({})).toBeUndefined();
    expect(asTrimmedString([])).toBeUndefined();
  });

  it("returns undefined for a boolean instead of throwing", () => {
    expect(asTrimmedString(true)).toBeUndefined();
  });
});

describe("asNormalizedNumberString", () => {
  it("trims and collapses internal whitespace, like normalizeNumberSpacing", () => {
    expect(asNormalizedNumberString("  12  34   56 78  ")).toBe("12 34 56 78");
  });

  it("returns undefined for a missing value, same as asTrimmedString", () => {
    expect(asNormalizedNumberString(undefined)).toBeUndefined();
    expect(asNormalizedNumberString(null)).toBeUndefined();
  });

  it("returns undefined for a non-string instead of throwing", () => {
    expect(asNormalizedNumberString(12345)).toBeUndefined();
  });
});
