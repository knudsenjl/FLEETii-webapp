import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isWebhookSignatureValid } from "./webhookSignature.js";

const secret = "test-secret";
const body = JSON.stringify({ topic: "vehicle:abc:generic:online", payload: { timestamp: 1, data: { online: true } } });

function sign(payload: string, key: string): string {
  return `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;
}

describe("isWebhookSignatureValid", () => {
  it("accepts a signature computed with the correct secret over the exact body", () => {
    expect(isWebhookSignatureValid(body, secret, sign(body, secret))).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(isWebhookSignatureValid(body, secret, sign(body, "wrong-secret"))).toBe(false);
  });

  it("rejects a signature that doesn't match a tampered body", () => {
    const validSignature = sign(body, secret);
    const tamperedBody = body.replace("true", "false");
    expect(isWebhookSignatureValid(tamperedBody, secret, validSignature)).toBe(false);
  });

  it("rejects an unsupported algorithm", () => {
    const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(isWebhookSignatureValid(body, secret, `sha1=${digest}`)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(isWebhookSignatureValid(body, secret, "not-a-valid-header")).toBe(false);
    expect(isWebhookSignatureValid(body, secret, "")).toBe(false);
  });
});
