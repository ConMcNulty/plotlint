// Seeded-error evaluation: scores the registered rules on the corpus and, with
// --auditor, InkOS's LLM-only ContinuityAuditor on the same mutants. Writes
// eval/REPORT.md, eval/report.json and (with --auditor) eval/auditor-results.json.
//
//   node eval/run.mjs [--auditor] [--sample 4|all] [--repeats 3] [--concurrency 2] [--book wenlow]
//
// The auditor reads its endpoint from the environment: INKOS_LLM_API_KEY, and
// optionally INKOS_LLM_BASE_URL (default Z.ai) and INKOS_LLM_MODEL (default glm-4.5-flash).
// Run `pnpm --filter @plotlint/rules build` first: this script imports dist/.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { allMutators, loadCorpusBook, renderReport, runAuditorBaseline, scoreAuditor, scoreRules } from "../dist/eval/index.js";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const clean = await loadCorpusBook(option("book", "wenlow"));
const result = scoreRules(clean, allMutators);
// The auditor sees the prose of every mutant, including those for rules not registered yet.
// Free glm-4.5-flash manages about one audit a minute, so by default it gets an
// evenly spaced sample of each mutator's mutants (--sample all for every one).
const sample = option("sample", "4");
const spread = (list, n) => (n >= list.length ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));
const allMutants = allMutators.flatMap((m) => {
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
