import { afterEach, describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

describe("mapWithConcurrency", () => {
  it("keeps input order and never runs more than `concurrency` at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10, 2], 3, async (ms, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight--;
      return `${index}:${ms}`;
    });
    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:2"]);
    expect(maxInFlight).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("fetchWithTimeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a timeout into a readable, service-named error", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    await expect(fetchWithTimeout("https://x.test", { label: "2hire", timeoutMs: 20 })).rejects.toThrow(
      "2hire svarede ikke inden for 0 sekunder.",
    );
  });

  it("passes a normal response straight through", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const response = await fetchWithTimeout("https://x.test", { label: "MotorAPI" });
    expect(await response.text()).toBe("ok");
  });
});
