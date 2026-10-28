// Seeded-error evaluation: scores the registered rules on the corpus books and,
// with --auditor, InkOS's LLM-only ContinuityAuditor on wenlow's mutants. Writes
// eval/REPORT.md, eval/report.json and (with --auditor) eval/auditor-results.json.
//
//   node eval/run.mjs [--auditor] [--sample 4|all] [--repeats 3] [--concurrency 2]
//
// The auditor reads its endpoint from the environment: INKOS_LLM_API_KEY, and
// optionally INKOS_LLM_BASE_URL (default Z.ai) and INKOS_LLM_MODEL (default glm-4.5-flash).
// Run `pnpm --filter @plotlint/metrics... build` first: this script imports dist/,
// and the L2 metric rules from the metrics package beside this one (skipped,
// with their mutators, when it is not built).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { builtinRules, RuleRegistry } from "../dist/index.js";
import { allMutators, corpusOf, CORPUS_BOOKS, loadCorpusBook, renderReport, runAuditorBaseline, scoreAuditor, scoreBooks } from "../dist/eval/index.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

// @plotlint/metrics depends on this package, so it is not a dependency here; load its build by path.
let metrics;
try {
  metrics = await import(new URL("../../metrics/dist/index.js", import.meta.url).href);
} catch {
  console.error("@plotlint/metrics is not built; its rules are skipped.");
}
const registry = new RuleRegistry([...builtinRules, ...(metrics ? metrics.metricStateRules() : [])]);
const textRules = metrics ? metrics.createMetricRules() : [];

const books = await Promise.all(CORPUS_BOOKS.map((name) => loadCorpusBook(name)));
const result = scoreBooks(books, allMutators, { registry, textRules });

// The auditor sees the prose of wenlow's mutants, including those for rules not registered yet.
// Free glm-4.5-flash manages about one audit a minute, so by default it gets an
// evenly spaced sample of each mutator's mutants (--sample all for every one).
const clean = books.find((book) => book.name === "wenlow");
const sample = option("sample", "4");
const spread = (list, n) => (n >= list.length ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));
const allMutants = allMutators.filter((m) => corpusOf(m) === clean.name).flatMap((m) => {
  const mutants = m.mutants(clean);
  return sample === "all" ? mutants : spread(mutants, Number(sample));
});

let auditor;
const resultsPath = here("./auditor-results.json");
if (flag("auditor")) {
  const { createLLMClient } = await import("@actalk/inkos-core");
  const apiKey = process.env.INKOS_LLM_API_KEY;
  if (!apiKey) throw new Error("INKOS_LLM_API_KEY is not set");
  const model = process.env.INKOS_LLM_MODEL ?? "glm-4.5-flash";
  const client = createLLMClient({
    provider: "openai", service: "custom", configSource: "env",
    baseUrl: process.env.INKOS_LLM_BASE_URL ?? "https://api.z.ai/api/paas/v4",
    apiKey, model, temperature: 0.3, thinkingBudget: 0, apiFormat: "chat", stream: false,
  });
  const baseline = await runAuditorBaseline(clean, allMutants, {
    client, model,
    cacheDir: here("./.cache/"),
    repeats: Number(option("repeats", "3")),
    concurrency: Number(option("concurrency", "2")),
    log: (line) => console.error(line),
  });
  await writeFile(resultsPath, `${JSON.stringify(baseline, null, 1)}\n`, "utf-8");
  auditor = baseline;
} else {
  try {
    auditor = JSON.parse(await readFile(resultsPath, "utf-8"));
  } catch { /* no saved auditor run */ }
}

const { markdown, json } = renderReport(result, auditor && { baseline: auditor, scores: scoreAuditor(auditor, allMutants) });
await writeFile(here("./REPORT.md"), markdown, "utf-8");
await writeFile(here("./report.json"), `${JSON.stringify(json, null, 1)}\n`, "utf-8");
console.log(markdown.split("\n## Findings")[0]);
