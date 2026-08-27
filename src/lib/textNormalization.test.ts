import { describe, expect, it } from "vitest";
import { normalizeNumberSpacing, stripNumberSpacing } from "./textNormalization";

describe("normalizeNumberSpacing", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeNumberSpacing("  12345678  ")).toBe("12345678");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeNumberSpacing("12  34   56 78")).toBe("12 34 56 78");
  });

  it("does both at once", () => {
    expect(normalizeNumberSpacing("  +45  70  60   86 89  ")).toBe("+45 70 60 86 89");
  });

  it("collapses tabs/newlines too, not just plain spaces", () => {
    expect(normalizeNumberSpacing("AB\t12\n345")).toBe("AB 12 345");
  });

  it("leaves an already-clean value unchanged", () => {
    expect(normalizeNumberSpacing("AB 12 345")).toBe("AB 12 345");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeNumberSpacing("   ")).toBe("");
  });
});

describe("stripNumberSpacing", () => {
  it("removes leading and trailing whitespace", () => {
    expect(stripNumberSpacing("  12345678  ")).toBe("12345678");
  });

  it("removes internal whitespace too, not just the ends", () => {
    expect(stripNumberSpacing("12 34 56 78")).toBe("12345678");
  });

  it("removes runs of multiple spaces", () => {
    expect(stripNumberSpacing("12  34   56 78")).toBe("12345678");
  });

  it("does all of the above at once", () => {
    expect(stripNumberSpacing("  +45  70  60   86 89  ")).toBe("+4570608689");
  });

  it("removes tabs/newlines too, not just plain spaces", () => {
    expect(stripNumberSpacing("AB\t12\n345")).toBe("AB12345");
  });

  it("leaves an already-clean value unchanged", () => {
    expect(stripNumberSpacing("AB12345")).toBe("AB12345");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(stripNumberSpacing("   ")).toBe("");
  });
});
