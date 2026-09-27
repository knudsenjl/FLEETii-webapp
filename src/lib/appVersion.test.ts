import { describe, expect, it } from "vitest";
import { APP_VERSION_INFO, shortCommit } from "./appVersion";

describe("shortCommit", () => {
  it("shortens a full hash to 7 characters", () => {
    expect(shortCommit("a4daa28e1f0c9b7d")).toBe("a4daa28");
  });

  it("stays empty when the build had no commit", () => {
    expect(shortCommit("")).toBe("");
  });
});

describe("APP_VERSION_INFO", () => {
  it("carries a MAJOR.PR version and a Danish build date", () => {
    expect(APP_VERSION_INFO.version).toMatch(/^\d+(\.\d+)?$/);
    expect(APP_VERSION_INFO.builtOn).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});
