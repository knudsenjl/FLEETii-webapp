// Tests for mailer.ts's describeSmtpError: each nodemailer error class must
// point at the setting to check (password, host/port, TLS, addresses) and
// never leak anything but the SMTP login name.
import { describe, expect, it } from "vitest";
import { describeSmtpError } from "./mailer.js";

const settings = { host: "asmtp.example.dk", port: 587, user: "admin@example.dk" };

describe("describeSmtpError", () => {
  it("names the login and SMTP_PASS on an auth rejection", () => {
    const text = describeSmtpError(
      { code: "EAUTH", responseCode: 535, response: "535 5.7.8 Error: authentication failed: (reason unavailable)" },
      settings,
    );
    expect(text).toContain("afviste login for admin@example.dk");
    expect(text).toContain("SMTP 535");
    expect(text).toContain("SMTP_PASS");
    expect(text).toContain("authentication failed");
  });

  it("points at SMTP_HOST/SMTP_PORT when the server can't be reached", () => {
    const text = describeSmtpError({ code: "ETIMEDOUT", message: "Connection timeout" }, settings);
    expect(text).toContain("asmtp.example.dk:587");
    expect(text).toContain("SMTP_HOST/SMTP_PORT");
    expect(text).toContain("Connection timeout");
  });

  it("points at SMTP_PORT on a TLS failure", () => {
    expect(describeSmtpError({ code: "ETLS", message: "wrong version number" }, settings)).toContain("SMTP_PORT");
  });

  it("points at the addresses when the envelope is rejected", () => {
    const text = describeSmtpError({ code: "EENVELOPE", responseCode: 550, response: "550 no such user" }, settings);
    expect(text).toContain("SMTP_FROM");
    expect(text).toContain("550 no such user");
  });

  it("falls back to the raw message for unknown errors, including non-objects", () => {
    expect(describeSmtpError(new Error("boom"), settings)).toContain("boom");
    expect(describeSmtpError(undefined, settings)).toContain("intet svar");
  });
});
