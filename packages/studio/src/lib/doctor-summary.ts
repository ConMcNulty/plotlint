export interface DoctorChecks {
  readonly inkosJson: boolean;
  readonly projectEnv: boolean;
  readonly globalEnv: boolean;
  readonly booksDir: boolean;
  /** Missing on servers older than this field: treat as unknown → use llmConnected. */
  readonly llmConfigured?: boolean;
  readonly llmConnected: boolean;
  readonly bookCount: number;
}

export type DoctorLlmState = "connected" | "no-key" | "failed";

export function doctorLlmState(checks: DoctorChecks): DoctorLlmState {
  if (checks.llmConfigured === false) return "no-key";
  return checks.llmConnected ? "connected" : "failed";
}

/**
 * The environment is healthy when the project config and books folder exist
 * and a model is set up and reachable. The .env files are optional: Studio
 * keeps provider keys itself, so a missing .env is not a failure.
 */
export function doctorAllPassed(checks: DoctorChecks): boolean {
  return checks.inkosJson && checks.booksDir && doctorLlmState(checks) === "connected";
}
