import { describe, expect, it } from "vitest";
import { buildWelcomeEmailHtml, generateTemporaryPassword, welcomeManualLinks } from "./userAccount.js";

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

describe("welcomeManualLinks", () => {
  const env = {
    VITE_BRUGERMANUAL_URL: "/manualer/bruger.html",
    VITE_ADMINMANUAL_URL: "/manualer/admin.html",
    VITE_FLEETIIMANUAL_URL: "/manualer/sysadm.html",
  };
  const site = "https://app.example";
  const urls = (role: "user" | "admin" | "sysadm") => welcomeManualLinks(role, site, env).map((m) => m.url);

  it("gives a user only the Bruger manual", () => {
    expect(urls("user")).toEqual([`${site}/manualer/bruger.html`]);
  });

  it("gives an admin the Bruger and Administrator manuals", () => {
    expect(urls("admin")).toEqual([`${site}/manualer/bruger.html`, `${site}/manualer/admin.html`]);
  });

  it("gives a sysadm all three manuals", () => {
    expect(urls("sysadm")).toEqual([
      `${site}/manualer/bruger.html`,
      `${site}/manualer/admin.html`,
      `${site}/manualer/sysadm.html`,
    ]);
  });

  it("leaves out a manual whose env var is unset, and all of them without a site URL", () => {
    expect(welcomeManualLinks("sysadm", site, { VITE_BRUGERMANUAL_URL: "/b.html" }).map((m) => m.url)).toEqual([`${site}/b.html`]);
    expect(welcomeManualLinks("sysadm", null, env)).toEqual([]);
  });
});

describe("buildWelcomeEmailHtml", () => {
  const base = { email: "a@b.dk", password: "pw", loginUrl: "https://app.example" };

  it("keeps the single \"her\" link when there is one manual", () => {
    const html = buildWelcomeEmailHtml({ ...base, role: "user", manuals: [{ label: "brugermanualen", url: "https://app.example/b.html" }] });
    expect(html).toContain('Du kan finde en kort introduktion til FLEETii <a href="https://app.example/b.html">her</a>');
  });

  it("lists several manuals by name, each as its own link", () => {
    const html = buildWelcomeEmailHtml({
      ...base,
      role: "sysadm",
      manuals: [
        { label: "brugermanualen", url: "https://app.example/b.html" },
        { label: "administratormanualen", url: "https://app.example/a.html" },
        { label: "systemadministratormanualen", url: "https://app.example/s.html" },
      ],
    });
    expect(html).toContain(
      '<a href="https://app.example/b.html">brugermanualen</a>, <a href="https://app.example/a.html">administratormanualen</a> og <a href="https://app.example/s.html">systemadministratormanualen</a>',
    );
    expect(html).toContain("Velkommen som Systemadministrator");
  });

  it("has no manual sentence when no manual is known", () => {
    expect(buildWelcomeEmailHtml({ ...base, role: "admin", manuals: [] })).not.toContain("introduktion");
  });
});
