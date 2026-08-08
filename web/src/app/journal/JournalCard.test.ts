import { describe, expect, it } from "vitest";
import { journalStatusLabel } from "@/app/journal/JournalCard";
import type { JournalDream } from "@/lib/database/journal";

describe("journal status copy", () => {
  it.each([
    ["DRAFT", "In progress"],
    ["TRANSCRIBING", "In progress"],
    ["GENERATING_ANCHOR", "In progress"],
    ["READY", "Ready"],
    ["FAILED", "Needs attention"],
    ["DELETING", "Removing"],
  ] satisfies readonly (readonly [JournalDream["status"], string])[])(
    "maps %s to %s",
    (status, label) => expect(journalStatusLabel(status)).toBe(label),
  );
});
