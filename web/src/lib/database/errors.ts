import type { z } from "zod";

interface DatabaseError {
  readonly code?: string;
  readonly message: string;
}

export function throwIfDatabaseError(error: DatabaseError | null): void {
  if (error) {
    throw new Error(`Database operation failed${error.code ? ` (${error.code})` : ""}: ${error.message}`);
  }
}

export function parseDatabaseRow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function parseDatabaseRows<T>(schema: z.ZodType<T>, data: unknown): T[] {
  return schema.array().parse(data);
}
