export interface TurnCheckpoint {
  id: string;
  before: string;
  after?: string;
  error?: string;
  undone?: { previous: string; changed: string[]; conflicts: string[] };
}

export interface TurnFileChange {
  path: string;
  kind: "added" | "modified" | "removed";
}

export interface TurnFileDiff {
  path: string;
  before?: string;
  after?: string;
  unavailable?: "binary" | "too_large";
}

export interface TurnUndoResult {
  previous: string;
  changed: string[];
  conflicts: string[];
  version: string;
}
