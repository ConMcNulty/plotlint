import { appendVerdicts, loadVerdicts } from "@plotlint/diagnostics/node";
import { VerdictSchema, verdictOfAction, verdictStats, type RuleVerdictStats, type Verdict } from "@plotlint/diagnostics/verdicts";
import { adaptiveDecisions, type AdaptiveDecision } from "@plotlint/rules";

/**
 * The writer's verdicts on findings from the Studio editor: applying a quick
 * fix, editing a finding away, "Mark as intentional" and "Not useful". They
 * are appended to the book's `story/plotlint/verdicts.jsonl` for the writer
 * study and for lowering checks the author keeps rejecting.
 */

const MAX_VERDICTS = 100;
const MAX_QUOTE = 500;

/** Parse `{ bookId, verdicts: [...] }`; the server stamps `at` when a verdict has none. */
export function parseVerdictBody(body: unknown, now = () => new Date().toISOString()): { bookId: string; verdicts: Verdict[] } | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, verdicts } = body as Record<string, unknown>;
  if (typeof bookId !== "string") return "bookId must be a string";
  if (!Array.isArray(verdicts) || verdicts.length === 0) return "verdicts must be a non-empty array";
  if (verdicts.length > MAX_VERDICTS) return `at most ${MAX_VERDICTS} verdicts per request`;
  const parsed: Verdict[] = [];
  for (const [index, entry] of verdicts.entries()) {
    if (!entry || typeof entry !== "object") return `verdicts[${index}] must be an object`;
    const raw = entry as Record<string, unknown>;
    const candidate = {
      ...raw,
      at: raw.at ?? now(),
      // The action decides the verdict, so a client may send only the action.
      ...(raw.verdict === undefined && typeof raw.action === "string" ? { verdict: verdictOfAction(raw.action as never) } : {}),
      ...(typeof raw.quote === "string" ? { quote: raw.quote.slice(0, MAX_QUOTE) } : {}),
    };
    const result = VerdictSchema.safeParse(candidate);
    if (!result.success) return `verdicts[${index}]: ${result.error.issues.map((issue) => `${issue.path.join(".") || "verdict"} ${issue.message}`).join("; ")}`;
    parsed.push(result.data);
  }
  return { bookId, verdicts: parsed };
}

export async function recordVerdicts(bookDir: string, verdicts: ReadonlyArray<Verdict>): Promise<{ recorded: number }> {
  await appendVerdicts(bookDir, verdicts);
  return { recorded: verdicts.length };
}

export interface VerdictReport {
  /** Verdicts in the file, before taking the latest per finding. */
  readonly total: number;
  /** Line numbers of unreadable lines that were skipped. */
  readonly skipped: number[];
  readonly stats: RuleVerdictStats[];
  /** Checks the author's verdicts lower in this book. */
  readonly lowered: AdaptiveDecision[];
}

/** Per-check accept and reject stats for one book, for `GET /api/v1/plotlint/verdicts`. */
export async function verdictReport(bookDir: string): Promise<VerdictReport> {
  const { verdicts, skipped } = await loadVerdicts(bookDir);
  return { total: verdicts.length, skipped, stats: verdictStats(verdicts), lowered: adaptiveDecisions(verdicts) };
}
