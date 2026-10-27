import type { RuntimeStateDelta, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic, DiagnosticLayer } from "@plotlint/diagnostics";

export interface RuleContext {
  /** The state the rule judges: the persisted snapshot, or the proposed next one when checking a delta. */
  readonly snapshot: RuntimeStateSnapshot;
  /** Present when checking a delta: the snapshot before it was applied, and the delta itself. */
  readonly previous?: RuntimeStateSnapshot;
  readonly delta?: RuntimeStateDelta;
}

export interface Rule {
  /** `<layer>/<name>`, stable across releases so suppressions keep working. */
  readonly id: string;
  readonly layer: DiagnosticLayer;
  /** Why the rule matters, shown on hover. */
  readonly rationale: string;
  check(context: RuleContext): Diagnostic[];
}
