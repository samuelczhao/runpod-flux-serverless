import { DatabaseOperationError } from "@/lib/database/errors";

const QUOTA_MESSAGES: Readonly<Record<string, string>> = {
  P4291: "Two dreams are already being made. Wait for one to finish.",
  P4292: "You’ve reached the hourly demo limit. Try again later.",
  P4293: "DreamTrace has reached today’s demo limit. Try again tomorrow.",
};

export function dreamQuotaResponse(error: unknown): Response | null {
  if (!(error instanceof DatabaseOperationError) || !error.code) return null;
  const message = QUOTA_MESSAGES[error.code];
  return message ? Response.json({ error: message }, { status: 429 }) : null;
}
