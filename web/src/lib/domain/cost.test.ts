import { describe, expect, it } from "vitest";
import { kontextCostUsd, providerCostUsd, qwenCostUsd, sumCostsUsd } from "@/lib/domain/cost";

describe("generation cost", () => {
  it("uses decimal arithmetic at the money boundary", () => {
    expect(qwenCostUsd(272)).toBe("0.00272000");
    expect(kontextCostUsd(2)).toBe("0.05000000");
    expect(sumCostsUsd(["0.00272000", "0.05000000"])).toBe("0.05272000");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid token count %s", (value) => {
    expect(() => qwenCostUsd(value)).toThrow("Token count");
  });

  it("handles zero without negative zero", () => {
    expect(qwenCostUsd(0)).toBe("0.00000000");
    expect(kontextCostUsd(0)).toBe("0.00000000");
  });

  it("normalizes provider costs at the database scale", () => {
    expect(providerCostUsd(0.025)).toBe("0.02500000");
    expect(() => providerCostUsd(Number.NaN)).toThrow("finite");
  });
});
