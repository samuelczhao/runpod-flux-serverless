import { describe, expect, it } from "vitest";
import { RunpodHttpError } from "@/lib/runpod/http";
import { classifySubmissionFailure } from "@/lib/runpod/submission-policy";

describe("paid submission failures", () => {
  it("marks definite client rejection as failed", () => {
    expect(classifySubmissionFailure(new RunpodHttpError(400))).toBe("FAILED");
  });

  it("marks lost and malformed responses as ambiguous", () => {
    expect(classifySubmissionFailure(new TypeError("socket closed"))).toBe("SUBMIT_UNKNOWN");
    expect(classifySubmissionFailure(new Error("invalid response"))).toBe("SUBMIT_UNKNOWN");
    expect(classifySubmissionFailure(new RunpodHttpError(503))).toBe("SUBMIT_UNKNOWN");
  });

  it.each([408, 429])("keeps HTTP %i submissions available for reconciliation", (status) => {
    expect(classifySubmissionFailure(new RunpodHttpError(status))).toBe("SUBMIT_UNKNOWN");
  });
});
