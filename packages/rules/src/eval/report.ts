import type { AuditorBaseline, scoreAuditor } from "./auditor.js";
import type { FindingRef, RuleEvalResult } from "./score.js";

type AuditorScores = ReturnType<typeof scoreAuditor>;

const pct = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);
const rate = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const short = (id: string) => id.replace(/^continuity\//u, "");
/** "ch3", "thornbury ch3", or "book" for a finding about the whole book. */
const where = (f: FindingRef) => `${f.book && f.book !== "wenlow" ? `${f.book} ` : ""}${f.chapter === undefined ? "book" : `ch${f.chapter}`}`;

/** The eval report as markdown and as JSON (the JSON keeps every outcome; the markdown the tables). */
export function renderReport(result: RuleEvalResult, auditor?: { baseline: AuditorBaseline; scores: AuditorScores }, generated = new Date().toISOString()): { markdown: string; json: unknown } {
  const a = auditor?.scores;
  const auditorRule = (ruleId: string) => a?.rules.find((r) => r.ruleId === ruleId);
  const lines: string[] = [];
  lines.push(
    "# Seeded-error evaluation",
    "",
    `Generated ${generated} by \`pnpm --filter @plotlint/rules eval\` (see "How to run" below). Book: \`${result.book}\`, ${result.chapters} clean chapters, ${result.mutants.length} mutants.`,
    "",
    "Phase 3 gate (PLAN.md): recall and false-alarm rate per rule, and each rule beats the LLM-only auditor on false positives. Phase 4 adds the structural (L4), genre-pack and prose-metric (L2) rules, scored the same way; the auditor was run on the continuity mutants only, so its columns are empty for the rest.",
    "",
    "## Per rule",
    "",
    "| Rule | Mutants | Recall | Clean findings (per ch) | Collateral (per other mutant) | Auditor recall (strict) | Auditor clean issues per ch: all / on topic | Fewer FPs than auditor |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const rule of result.rules) {
    const ar = auditorRule(rule.ruleId);
    const ruleFp = rule.cleanRate;
    const beats = a ? (ruleFp < a.cleanRate ? "yes" : ruleFp === 0 && a.cleanRate === 0 ? "tie (both 0)" : "no") : "–";
    lines.push(`| \`${short(rule.ruleId)}\` | ${rule.mutants} | ${rule.mutants ? `${rule.caught}/${rule.mutants} (${pct(rule.recall)})` : "–"} | ${rule.cleanFindings.length} (${rate(rule.cleanRate)}) | ${rule.collateral.length} (${rate(rule.collateralRate)}) | ${ar?.mutants ? `${ar.caught}/${ar.mutants} ${pct(ar.recall)} (${pct(ar.recallStrict)})` : "–"} | ${a ? `${rate(a.cleanRate)} / ${ar ? rate(ar.topicalCleanRate) : "–"}` : "–"} | ${beats} |`);
  }
  for (const ar of a?.rules ?? []) {
    if (result.rules.some((r) => r.ruleId === ar.ruleId)) continue;
    lines.push(`| \`${short(ar.ruleId)}\` (not registered) | ${ar.mutants} | – | – | – | ${ar.caught}/${ar.mutants} ${pct(ar.recall)} (${pct(ar.recallStrict)}) | ${rate(a!.cleanRate)} / ${rate(ar.topicalCleanRate)} | – |`);
  }
  const totalMutants = result.rules.reduce((n, r) => n + r.mutants, 0);
  const totalCaught = result.rules.reduce((n, r) => n + r.caught, 0);
  const cleanTotal = result.rules.reduce((n, r) => n + r.cleanFindings.length, 0);
  const collateralTotal = result.rules.reduce((n, r) => n + r.collateral.length, 0);
  lines.push(
    "",
    `All rules: ${totalCaught}/${totalMutants} mutants caught (${pct(totalMutants ? totalCaught / totalMutants : null)}), ${cleanTotal} findings on the clean book, ${collateralTotal} collateral findings over ${result.mutants.length} mutants.`,
  );
  if (a) {
    const auditorMutants = a.rules.reduce((n, r) => n + r.mutants, 0);
    const auditorCaught = a.rules.reduce((n, r) => n + r.caught, 0);
    const auditorStrict = a.rules.reduce((n, r) => n + r.caughtStrict, 0);
    lines.push(
      `Auditor (\`${auditor!.baseline.model}\`): ${a.cleanIssues} issues over ${a.cleanRuns} clean chapter audits (${rate(a.cleanRate)} per chapter, ${auditor!.baseline.repeats} runs per chapter); recall ${auditorCaught}/${auditorMutants} (${pct(auditorMutants ? auditorCaught / auditorMutants : null)}), strict ${auditorStrict}/${auditorMutants}; ${a.failed} audits failed after retries and are left out.`,
    );
  }
  if (result.skipped.length) lines.push("", `Mutators skipped because their rule is not registered: ${result.skipped.map((id) => `\`${id}\``).join(", ")}.`);

  lines.push("", "## Findings on the clean book", "");
  const cleanFindings = result.rules.flatMap((r) => r.cleanFindings);
  if (cleanFindings.length === 0) lines.push("None.");
  for (const f of cleanFindings) lines.push(`- \`${short(f.ruleId)}\` ${where(f)}: ${f.summary}`);

  lines.push("", "## Misses", "", "Mutants the seeded rule did not report in the mutant's chapter. Most are deliberate: free-form predicates or values outside the rule's vocabulary, kept so recall reflects what a real settler writes.", "");
  const misses = result.rules.flatMap((r) => r.outcomes.filter((o) => !o.caught));
  if (misses.length === 0) lines.push("None.");
  for (const o of misses) lines.push(`- \`${o.id}\` (ch${o.chapter}): ${o.description}${o.echoes.length ? ` Reported in ch${o.echoes.map((e) => e.chapter).join(", ch")} instead.` : ""}`);

  lines.push("", "## Collateral", "", "New findings of other rules on a mutant. Some are true positives (one slip can break two rules, e.g. a death and an alive status at once); they are listed so each can be judged.", "");
  const collateral = result.rules.flatMap((r) => r.collateral);
  if (collateral.length === 0) lines.push("None.");
  for (const f of collateral) lines.push(`- \`${short(f.ruleId)}\` on \`${f.mutant}\` ${where(f)}: ${f.summary}`);

  if (auditor) {
    lines.push("", "## Auditor issues on the clean book", "");
    for (const run of auditor.baseline.clean) {
      if (run.failed) { lines.push(`- ${run.id}: failed`); continue; }
      for (const issue of run.issues) lines.push(`- ${run.id} \`${issue.code}\`: ${issue.summary.replace(/\s+/gu, " ")}`);
    }
  }

  lines.push(
    "",
    "## Method",
    "",
    "- **Corpus.** `eval/corpus/wenlow`: a five-chapter story written for the eval with no continuity errors, and `facts.json`, hand-written oracle facts in the shape InkOS's settler writes (free-form subject, predicate and object; validity; `kind`; an evidence quote that is verbatim in the chapter). `story/plotlint/` holds its travel graph and four approved author invariants, all true of the clean book. For the structural rules it also has `hooks.json`, the oracle hook ledger in InkOS's shape (the story's real setups and payoffs; the break-in left open on purpose and advanced in the last chapter), `story/plotlint/scenes.json`, the author's own scene annotations (`annotator: \"author\"`), `book.json` marking it finished at five chapters, and `story/plotlint/rules.json`, which sizes three rules for a five-chapter book (tension-curve `minChapters` 5 and `flatRun` 3, subplot-balance `gap` 2, goal-conflict-outcome `window` 3 and `minScenes` 2). Wenlow has no culprit the state unmasks and no couple, so `eval/corpus/thornbury`, a four-chapter village mystery with a romance written the same way, hosts fair play and the romance checks. Every rule's clean findings and collateral are measured on both books.",
    "- **Clean findings.** The only ones are `metrics/repeated-phrase` on \"the river went past\", wenlow's refrain (ch2, ch3, ch5), which is deliberate: a writer would suppress them.",
    "- **Mutants.** Each mutator (`src/eval/mutators/`) seeds one plausible slip per mutant into the prose (an inserted or rewritten sentence, so the auditor can see it) and into the facts as a settler would record it, and names the chapter it should be reported in. A mutator only runs when its rule id is registered. Structural mutants change the hook ledger or the scene annotations as a settler or annotator reading the mutated prose would; metric mutants change only the prose (a 600-word wall, twelve equal-length sentences, a chapter recast as speech, its sensory words replaced). Several mutants of each rule are written as a GLM-style settler or annotator would record them (bare hook ids, `none` for an empty field, free-form predicates), and some are expected misses, marked so in the list below.",
    "- **Rule scores.** Rules run over the oracle facts with `checkSnapshot`, chapter text and book data. Recall: the seeded rule reports the mutant's chapter. False alarms: findings on the clean book, and collateral (other rules' new findings on a mutant). A seeded rule's findings in other chapters are echoes and not counted as false alarms. Rules that judge the whole book (protagonist agency, central relationship, both leads' POV) report no chapter, so any new finding of theirs catches their mutant. The L2 metric rules come from `@plotlint/metrics` (which depends on this package) and run on every chapter beside the state rules.",
    "- **Auditor.** InkOS's `ContinuityAuditor` on each clean chapter (repeated, temperature 0.3) and on each mutant's chapter, with all earlier chapters as context. Free `glm-4.5-flash` manages about one audit a minute, so it audits an evenly spaced sample of each mutator's mutants (`--sample`, 4 by default; the recall column gives the count). Clean issues are its false positives; \"on topic\" counts only those matching a rule's topic words, a fairer per-rule comparison. A mutant is caught when an issue's summary or evidence has a word from each of the mutant's keyword groups (a name and a topic); strict recall leaves out mutants whose keywords also match the clean audit of that chapter.",
    "- **Limits.** Two short books, written by the same hand as the mutants; structural recall on a five-chapter book says the mechanism works, not that its thresholds suit a novel (three rules are configured for the length); oracle facts, not a real settler's (extracted mode is not built yet), so rule recall here is an upper bound for the facts a settler gets right and a lower bound where it phrases them unusually. Keyword matching can over- or under-credit the auditor; its issues are listed in `report.json`.",
    "",
    "## How to run",
    "",
    "```",
    "pnpm --filter @plotlint/metrics... build   # the rules and their dependencies, and the metric rules",
    "cd packages/rules",
    "node eval/run.mjs                      # rules only; reuses eval/auditor-results.json if present",
    "node eval/run.mjs --auditor            # also run the auditor (needs INKOS_LLM_API_KEY; cached in eval/.cache/)",
    "node eval/run.mjs --auditor --sample all --repeats 3 --concurrency 2",
    "```",
    "",
  );

  const json = {
    generated,
    book: result.book,
    chapters: result.chapters,
    skipped: result.skipped,
    rules: result.rules,
    ...(auditor ? { auditor: { model: auditor.baseline.model, repeats: auditor.baseline.repeats, scores: auditor.scores } } : {}),
  };
  return { markdown: lines.join("\n"), json };
}
