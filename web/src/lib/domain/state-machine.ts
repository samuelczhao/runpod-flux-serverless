import type { DreamStatus } from "@/lib/domain/dream";

const NEXT_STATES: Readonly<Record<DreamStatus, readonly DreamStatus[]>> = {
  DRAFT: ["UPLOADED", "PLANNING", "DELETING"],
  UPLOADED: ["TRANSCRIBING", "DELETING"],
  TRANSCRIBING: ["PLANNING", "FAILED", "DELETING"],
  PLANNING: ["GENERATING_ANCHOR", "FAILED", "DELETING"],
  GENERATING_ANCHOR: ["GENERATING_SCENES", "FAILED", "DELETING"],
  GENERATING_SCENES: ["READY", "FAILED", "DELETING"],
  READY: ["DELETING"],
  FAILED: ["TRANSCRIBING", "PLANNING", "GENERATING_ANCHOR", "GENERATING_SCENES", "DELETING"],
  DELETING: [],
};

export function canTransition(from: DreamStatus, to: DreamStatus): boolean {
  return NEXT_STATES[from].includes(to);
}

export function assertTransition(from: DreamStatus, to: DreamStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid dream transition: ${from} -> ${to}`);
  }
}
