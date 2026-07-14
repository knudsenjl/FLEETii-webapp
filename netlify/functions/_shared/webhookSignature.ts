// Validates the X-Hub-Signature header 2hire signs webhook deliveries with
// (see https://developer.2hire.io/docs/message-signature-validation). Kept
// separate from twoHireClient.ts (which calls OUT to 2hire) since this only
// validates INCOMING requests to 2hire-webhook.mts.
import { createHmac, timingSafeEqual } from "node:crypto";

const SUPPORTED_ALGORITHMS = ["sha256"];

/**
 * True if `signatureHeader` (the raw "X-Hub-Signature" value, e.g.
 * "sha256=<hex>") is a valid HMAC of the exact raw request body string,
 * using `secret`. Must be called with the body as originally received —
 * hashing a re-stringified/re-parsed JSON body will not match, since 2hire
 * signs the literal bytes it sent.
 */
export function isWebhookSignatureValid(rawBody: string, secret: string, signatureHeader: string): boolean {
  const parts = signatureHeader.split("=");
  if (parts.length !== 2) {
    return false;
  }

  const [algorithm, hexDigest] = parts;
  if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
    return false;
  }

  const expected = createHmac(algorithm, secret).update(rawBody, "utf8").digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(hexDigest, "hex");
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch rather than returning false.
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
