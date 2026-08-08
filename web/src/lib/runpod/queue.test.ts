import { describe, expect, it, vi } from "vitest";
import { cancelQueueJob, getQueueStatus, submitQueueJob } from "@/lib/runpod/queue";

describe("Runpod queue client", () => {
  it("submits the exact queue envelope", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "job-1", status: "IN_QUEUE" }));
    await expect(submitQueueJob("endpoint-1", { prompt: "moon" }, "secret", fetcher)).resolves.toBe("job-1");
    expect(fetcher).toHaveBeenCalledWith("https://api.runpod.ai/v2/endpoint-1/run", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ input: { prompt: "moon" } }),
    }));
  });

  it("validates status responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "job-1", status: "COMPLETED", output: {} }));
    await expect(getQueueStatus("endpoint", "job-1", "secret", fetcher)).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("rejects unknown statuses", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "job-1", status: "MYSTERY" }));
    await expect(getQueueStatus("endpoint", "job-1", "secret", fetcher)).rejects.toThrow();
  });

  it.each(["status", "cancel"])("rejects a mismatched job ID from %s", async (operation) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "job-2", status: "COMPLETED" }));
    const request = operation === "status"
      ? getQueueStatus("endpoint", "job-1", "secret", fetcher)
      : cancelQueueJob("endpoint", "job-1", "secret", fetcher);
    await expect(request).rejects.toThrow("different job ID");
  });

  it("cancels a specific queued job", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "job-1", status: "CANCELLED" }));
    await expect(cancelQueueJob("endpoint", "job-1", "secret", fetcher)).resolves.toMatchObject({
      status: "CANCELLED",
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.runpod.ai/v2/endpoint/cancel/job-1", expect.objectContaining({
      method: "POST",
    }));
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
