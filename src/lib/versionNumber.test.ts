import { describe, expect, it } from "vitest";
import { latestMergedPr, versionNumber } from "./versionNumber";

const history = [
  "Remove the Testfunktioner sections from the manuals",
  "Merge pull request #103 from knudsenjl/manuals-remove-testfunktioner",
  "Merge pull request #102 from knudsenjl/main",
];

describe("latestMergedPr", () => {
  it("takes the newest merge commit, skipping ordinary commits", () => {
    expect(latestMergedPr(history)).toBe(103);
  });

  it("recognises a promotion merge (main -> production)", () => {
    expect(latestMergedPr(["Merge pull request #104 from knudsenjl/main"])).toBe(104);
  });

  it("is null without any merge commit", () => {
    expect(latestMergedPr(["Fix typo", ""])).toBeNull();
  });

  it("ignores a PR reference that isn't a merge subject", () => {
    expect(latestMergedPr(["Revert part of #99"])).toBeNull();
  });
});

describe("versionNumber", () => {
  it("combines package.json's major number with the PR number", () => {
    expect(versionNumber("1.0.0", history)).toBe("1.103");
    expect(versionNumber("2.0.0", history)).toBe("2.103");
  });

  it("falls back to the major number alone without git history", () => {
    expect(versionNumber("1.0.0", [])).toBe("1");
  });
});
