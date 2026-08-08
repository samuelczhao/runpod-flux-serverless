import { expect, it } from "vitest";
import { isRetryableHttpStatus } from "@/lib/domain/polling";

it.each([401, 403, 404])("does not retry permanent HTTP %s", (status) => {
  expect(isRetryableHttpStatus(status)).toBe(false);
});

it.each([408, 429, 500, 503])("retries transient HTTP %s", (status) => {
  expect(isRetryableHttpStatus(status)).toBe(true);
});
