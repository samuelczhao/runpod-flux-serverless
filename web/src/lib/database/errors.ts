import type { z } from "zod";

interface DatabaseError {
  readonly code?: string;
  readonly message: string;
}

export class DatabaseOperationError extends Error {
  public readonly code: string | undefined;

  public constructor(error: DatabaseError) {
    super(`Database operation failed${error.code ? ` (${error.code})` : ""}: ${error.message}`);
    this.name = "DatabaseOperationError";
    this.code = error.code;
  }
}

export function throwIfDatabaseError(error: DatabaseError | null): void {
  if (error) throw new DatabaseOperationError(error);
}

export function parseDatabaseRow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function parseDatabaseRows<T>(schema: z.ZodType<T>, data: unknown): T[] {
  return schema.array().parse(data);
}
