const FAST_POLL_ATTEMPTS = 12;

export const PROVIDER_POLL_ATTEMPTS = 49;

export type ProviderPollDelay = "5s" | "15s";

export function providerPollDelay(completedPolls: number): ProviderPollDelay {
  const lastDelayIndex = PROVIDER_POLL_ATTEMPTS - 2;
  if (!Number.isInteger(completedPolls) || completedPolls < 0 || completedPolls > lastDelayIndex) {
    throw new RangeError("Provider poll index is outside the delay schedule");
  }
  return completedPolls < FAST_POLL_ATTEMPTS ? "5s" : "15s";
}
