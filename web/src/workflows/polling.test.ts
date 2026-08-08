import { describe, expect, it } from "vitest";
import { PROVIDER_POLL_ATTEMPTS, providerPollDelay } from "@/workflows/polling";

const SECONDS_BY_DELAY = { "5s": 5, "15s": 15 } as const;

describe("provider polling schedule", () => {
  it("keeps the ten-minute timeout with fewer durable events", () => {
    const delays = Array.from(
      { length: PROVIDER_POLL_ATTEMPTS - 1 },
      (_, index) => providerPollDelay(index),
    );
    const seconds = delays.reduce((total, delay) => total + SECONDS_BY_DELAY[delay], 0);
    expect(seconds).toBe(600);
    expect(delays).toHaveLength(48);
  });

  it("polls quickly for one minute before backing off", () => {
    expect(providerPollDelay(11)).toBe("5s");
    expect(providerPollDelay(12)).toBe("15s");
  });

  it("rejects invalid schedule indexes", () => {
    expect(() => providerPollDelay(-1)).toThrow(RangeError);
    expect(() => providerPollDelay(48)).toThrow(RangeError);
  });
});
