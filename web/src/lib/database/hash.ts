import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashJson(value: Readonly<Record<string, unknown>>): string {
  return sha256(JSON.stringify(value));
}
