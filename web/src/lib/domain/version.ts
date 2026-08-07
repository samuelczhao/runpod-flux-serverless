export interface ModelBoundVersion {
  readonly model: string;
}

export function assertVersionModel(version: ModelBoundVersion, expected: string): void {
  if (version.model !== expected) {
    throw new Error(`Scene version model mismatch: expected ${expected}`);
  }
}
