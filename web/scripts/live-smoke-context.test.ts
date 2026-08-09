import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./live-smoke-context.ts";

const RETRY_DELAY_MS = 250;
const TOTAL_RETRY_BACKOFF_MULTIPLIER = 3;
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  it("retries a transient GET failure without replaying forever", async () => {
    vi.useFakeTimers();
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: reset }))
      .mockResolvedValueOnce(Response.json({ status: "READY" }));

    const result = requestJson("https://example.com/story", { method: "GET" });
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    await expect(result).resolves.toEqual({ status: "READY" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(MUTATING_METHODS)("never retries a %s request", async (method) => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed", { cause: reset }));

    await expect(requestJson("https://example.com/dreams", { method }))
      .rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stops retrying a transient GET after three attempts", async () => {
    vi.useFakeTimers();
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed", { cause: reset }));

    const result = expect(requestJson("https://example.com/story", { method: "GET" }))
      .rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * TOTAL_RETRY_BACKOFF_MULTIPLIER);

    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent network failure", async () => {
    const expired = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed", { cause: expired }));

    await expect(requestJson("https://example.com/story", { method: "GET" }))
      .rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
