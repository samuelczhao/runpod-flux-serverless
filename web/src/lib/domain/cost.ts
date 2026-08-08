import Decimal from "decimal.js";

const KONTEXT_EDIT_USD = new Decimal("0.025");
const QWEN_PER_MILLION_TOKENS_USD = new Decimal("10");
const MILLION = new Decimal(1_000_000);
const COST_SCALE = 8;

export function qwenCostUsd(tokenCount: number): string {
  validateTokenCount(tokenCount);
  return new Decimal(tokenCount).mul(QWEN_PER_MILLION_TOKENS_USD).div(MILLION).toFixed(COST_SCALE);
}

export function kontextCostUsd(imageCount: number): string {
  validateImageCount(imageCount);
  return KONTEXT_EDIT_USD.mul(imageCount).toFixed(COST_SCALE);
}

export function sumCostsUsd(costs: readonly string[]): string {
  return costs.reduce((total, cost) => total.add(cost), new Decimal(0)).toFixed(COST_SCALE);
}

export function providerCostUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Provider cost must be finite and non-negative");
  return new Decimal(cost.toString()).toFixed(COST_SCALE);
}

function validateTokenCount(tokenCount: number): void {
  if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
    throw new Error("Token count must be a non-negative safe integer");
  }
}

function validateImageCount(imageCount: number): void {
  if (!Number.isSafeInteger(imageCount) || imageCount < 0) {
    throw new Error("Image count must be a non-negative safe integer");
  }
}
