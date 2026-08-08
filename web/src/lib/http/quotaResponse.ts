import { DatabaseOperationError } from "@/lib/database/errors";

const QUOTA_MESSAGES: Readonly<Record<string, string>> = {
  P4291: "Two dreams are already being made. Wait for one to finish.",
  P4292: "You’ve reached the hourly demo limit. Try again later.",
  P4293: "DreamTrace has reached today’s demo limit. Try again tomorrow.",
  P4294: "You’ve reached the hourly scene-edit limit. Try again later.",
  P4295: "You’ve reached the hourly photo limit. Try again later.",
  P4296: "DreamTrace has reached today’s photo limit. Try again tomorrow.",
  P4297: "Two photos are already being prepared. Finish or remove one before adding another.",
};

export function quotaResponse(error: unknown): Response | null {
  if (!(error instanceof DatabaseOperationError) || !error.code) return null;
  const message = QUOTA_MESSAGES[error.code];
  return message ? Response.json({ error: message }, { status: 429 }) : null;
}
