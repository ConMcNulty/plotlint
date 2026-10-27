import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContinuityAuditor, type LLMClient, type Observation } from "@actalk/inkos-core";
import type { ChapterTexts } from "../evidence.js";
import type { CleanBook, Mutant } from "./mutant.js";

// The LLM-only baseline: InkOS's ContinuityAuditor, run on each clean chapter
// and on each mutant's seeded chapter, with every earlier chapter of the same
// (clean or mutated) book as governed context. That is more than InkOS gives it
// in a real run (state summaries, not whole chapters), so the baseline is if
// anything flattered.
//
// - False positives: every issue it raises on a clean chapter. The corpus is
//   written to have none, so each is either a false alarm or a style note filed
//   as an issue; both cost the writer the same attention.
// - Recall: a mutant counts as caught when an issue on its chapter matches the
//   mutant's keyword groups (Mutant.match: one word from each group, as a
//   case-insensitive substring of the issue's summary and its evidence strings,
//   not of the passages it cites, which contain the names anyway). Issues that
//   do not match are its collateral on that mutant. The same match is also run on
//   the clean audit of the chapter as a control: a match there means the keywords
//   are loose for that mutant, and the report counts recall both ways.
//
// Responses are cached on disk by a hash of the model, chapter and context, so a
// rerun only pays for what changed.

export interface AuditorIssue {
  readonly code: string;
  readonly summary: string;
  readonly evidence: ReadonlyArray<string>;
}

export interface AuditorRun {
  /** "clean:<chapter>:<repeat>" or the mutant id. */
  readonly id: string;
  readonly chapter: number;
  readonly issues: ReadonlyArray<AuditorIssue>;
  /** True when every attempt failed; the run is left out of the scores. */
  readonly failed?: boolean;
  readonly cached?: boolean;
}

export interface AuditorBaseline {
  readonly model: string;
  readonly repeats: number;
  readonly clean: ReadonlyArray<AuditorRun>;
  readonly mutants: ReadonlyArray<AuditorRun & { readonly ruleId: string }>;
}

export interface RunAuditorOptions {
  readonly client: LLMClient;
  readonly model: string;
  readonly cacheDir: string;
  /** Clean audits per chapter, for a steadier false-positive rate (temperature is 0.3). */
  readonly repeats?: number;
  readonly concurrency?: number;
  readonly attempts?: number;
  readonly log?: (line: string) => void;
}

const issuesOf = (observations: ReadonlyArray<Observation>): AuditorIssue[] => observations
  .filter((o) => o.assessment === undefined || o.assessment === "issue")
  // Only the auditor's own words: the quotes it cites would match a mutant's names whatever it said about them.
  .map((o) => ({ code: o.code, summary: o.summary, evidence: [...o.evidence] }));

function context(chapters: ChapterTexts, chapter: number) {
  return [...chapters].filter(([n]) => n < chapter).sort(([a], [b]) => a - b).map(([n, text]) => ({
    source: `story/chapters/${String(n).padStart(4, "0")}.md`,
    reason: `Chapter ${n}, earlier in the book`,
    excerpt: text,
    protection: "protected" as const,
  }));
}

async function audit(chapters: ChapterTexts, chapter: number, salt: string, options: RunAuditorOptions): Promise<{ issues: AuditorIssue[]; failed?: boolean; cached?: boolean }> {
  const text = chapters.get(chapter)!;
  const selectedContext = context(chapters, chapter);
  const key = createHash("sha256").update(JSON.stringify({ model: options.model, chapter, text, selectedContext, salt })).digest("hex").slice(0, 32);
  const path = join(options.cacheDir, `${key}.json`);
  try {
    return { ...(JSON.parse(await readFile(path, "utf-8")) as { issues: AuditorIssue[] }), cached: true };
  } catch { /* not cached */ }

  const auditor = new ContinuityAuditor({ client: options.client, model: options.model, projectRoot: tmpdir() });
  const attempts = options.attempts ?? 8;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await auditor.auditChapter(tmpdir(), text, chapter, undefined, { language: "en", contextPackage: { chapter, selectedContext } });
      const issues = issuesOf(result.observations);
      await writeFile(path, JSON.stringify({ issues, summary: result.summary }, null, 1), "utf-8");
      return { issues };
    } catch (error) {
      // Z.ai's free tier returns 500/429 under load: back off and retry.
      options.log?.(`  ch${chapter} attempt ${attempt} failed: ${(error as Error).message.slice(0, 160)}`);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, Math.min(120_000, 5000 * 2 ** (attempt - 1))));
    }
  }
  return { issues: [], failed: true };
}

async function pool<T, R>(items: ReadonlyArray<T>, size: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  }));
  return results;
}

export async function runAuditorBaseline(clean: CleanBook, mutants: ReadonlyArray<Mutant>, options: RunAuditorOptions): Promise<AuditorBaseline> {
  await mkdir(options.cacheDir, { recursive: true });
  const repeats = options.repeats ?? 3;
  const jobs = [
    ...[...clean.chapters.keys()].flatMap((chapter) => Array.from({ length: repeats }, (_, r) => ({ kind: "clean" as const, chapter, r }))),
    ...mutants.map((mutant) => ({ kind: "mutant" as const, mutant })),
  ];
  let done = 0;
  const runs = await pool(jobs, options.concurrency ?? 4, async (job) => {
    const result = job.kind === "clean"
      ? await audit(clean.chapters, job.chapter, `clean:${job.r}`, options)
      : await audit(job.mutant.chapters, job.mutant.chapter, "mutant", options);
    done += 1;
    const id = job.kind === "clean" ? `clean:${job.chapter}:${job.r + 1}` : job.mutant.id;
    options.log?.(`[${done}/${jobs.length}] ${id}: ${result.failed ? "FAILED" : `${result.issues.length} issues`}${result.cached ? " (cached)" : ""}`);
    return { job, run: { id, chapter: job.kind === "clean" ? job.chapter : job.mutant.chapter, issues: result.issues, ...(result.failed ? { failed: true } : {}) } };
  });
  return {
    model: options.model,
    repeats,
    clean: runs.filter((r) => r.job.kind === "clean").map((r) => r.run),
    mutants: runs.flatMap((r) => (r.job.kind === "mutant" ? [{ ...r.run, ruleId: r.job.mutant.ruleId }] : [])),
  };
}

/** True when an issue's summary or evidence has a word from every keyword group. */
export function auditorIssueMatches(issue: AuditorIssue, match: ReadonlyArray<ReadonlyArray<string>>): boolean {
  const text = [issue.summary, ...issue.evidence].join("\n").toLowerCase();
  return match.every((group) => group.some((word) => text.includes(word.toLowerCase())));
}

export interface AuditorRuleScore {
  readonly ruleId: string;
  readonly mutants: number;
  readonly caught: number;
  readonly recall: number | null;
  /** Caught, leaving out mutants whose keywords also match the clean audit of the chapter. */
  readonly caughtStrict: number;
  readonly recallStrict: number | null;
  /** Clean issues that match this rule's topic words (the last keyword group of its mutants), per clean chapter audit. */
  readonly topicalCleanRate: number;
  /** Issues on this rule's mutated chapters that are not about the seeded error, per mutant. */
  readonly collateralRate: number;
}

export function scoreAuditor(baseline: AuditorBaseline, mutants: ReadonlyArray<Mutant>): {
  cleanIssues: number; cleanRuns: number; cleanRate: number; failed: number; rules: AuditorRuleScore[];
} {
  const cleanRuns = baseline.clean.filter((r) => !r.failed);
  const cleanIssues = cleanRuns.flatMap((r) => r.issues);
  const byId = new Map(baseline.mutants.map((r) => [r.id, r]));
  const ruleIds = [...new Set(mutants.map((m) => m.ruleId))];
  const rules = ruleIds.map((ruleId): AuditorRuleScore => {
    const mine = mutants.filter((m) => m.ruleId === ruleId && byId.get(m.id) && !byId.get(m.id)!.failed);
    let caught = 0;
    let caughtStrict = 0;
    let collateral = 0;
    for (const mutant of mine) {
      const issues = byId.get(mutant.id)!.issues;
      const hits = issues.filter((issue) => auditorIssueMatches(issue, mutant.match));
      collateral += issues.length - hits.length;
      if (hits.length === 0) continue;
      caught += 1;
      const control = cleanRuns.filter((r) => r.chapter === mutant.chapter).flatMap((r) => r.issues);
      if (!control.some((issue) => auditorIssueMatches(issue, mutant.match))) caughtStrict += 1;
    }
    const topic = [...new Set(mutants.filter((m) => m.ruleId === ruleId).flatMap((m) => m.match[m.match.length - 1] ?? []))];
    const topical = cleanIssues.filter((issue) => auditorIssueMatches(issue, [topic])).length;
    return {
      ruleId, mutants: mine.length, caught, caughtStrict,
      recall: mine.length ? caught / mine.length : null,
      recallStrict: mine.length ? caughtStrict / mine.length : null,
      topicalCleanRate: cleanRuns.length ? topical / cleanRuns.length : 0,
      collateralRate: mine.length ? collateral / mine.length : 0,
    };
  });
  return {
    cleanIssues: cleanIssues.length, cleanRuns: cleanRuns.length,
    cleanRate: cleanRuns.length ? cleanIssues.length / cleanRuns.length : 0,
    failed: baseline.clean.filter((r) => r.failed).length + baseline.mutants.filter((r) => r.failed).length,
    rules,
  };
}
