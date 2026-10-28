import { DiagnosticSchema } from "@plotlint/diagnostics";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREDICTABILITY_BAND, findPredictableStretches, kneserNeyScorer, metricStateRules, predictabilityRule, type Scorer } from "../index.js";

// A small deterministic generator of varied prose, so no two chapters share their sentences.
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}
const SUBJECTS = "the miller,a stranger,her brother,the old captain,a boy from the docks,the widow,our neighbour,the clerk,a tall woman,the ferryman".split(",");
const VERBS = "carried,noticed,sold,buried,mended,painted,borrowed,forgot,counted,hid,burned,polished".split(",");
const OBJECTS = "a lantern,the ledger,three apples,a broken wheel,the blue coat,an iron key,his letters,a jar of honey,the map,a wooden horse,the ribbon,two candles".split(",");
const PLACES = "behind the mill,near the harbour,under the bridge,at the fair,in the attic,beside the well,on the hill road,in the chapel yard,by the river,at the inn".split(",");
const TIMES = "before dawn,after supper,in the rain,during the storm,at noon,late in autumn,on market day,while the bells rang".split(",");
function chapter(seed: number, sentences = 60): string {
  const next = prng(seed);
  const pick = (list: string[]) => list[Math.floor(next() * list.length)]!;
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) {
    const s = `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(PLACES)} ${pick(TIMES)}`;
    out.push(`${s[0]!.toUpperCase()}${s.slice(1)}.`);
  }
  const paragraphs: string[] = [];
  for (let i = 0; i < out.length; i += 5) paragraphs.push(out.slice(i, i + 5).join(" "));
  return paragraphs.join("\n\n");
}

// A ritual passage that recurs word for word: formulaic for this book.
const RITUAL = [
  "The keeper lit the seven lamps along the eastern wall.",
  "The keeper spoke the old words over the silver bowl.",
  "The keeper poured the water and waited for the bell.",
  "The keeper lit the seven lamps along the eastern wall.",
  "The keeper spoke the old words over the silver bowl.",
  "The keeper poured the water and waited for the bell.",
].join(" ");

const book = () => new Map([
  [1, `${chapter(1)}\n\n${RITUAL}`],
  [2, `${chapter(2)}\n\n${RITUAL}`],
  [3, chapter(3)],
  [4, `${chapter(4)}\n\n${RITUAL}\n\n${chapter(44, 20)}`],
  [5, chapter(5)],
]);

describe("metrics/predictability", () => {
  it("flags the recurring ritual passage as a ranged note in each chapter that repeats it", () => {
    const chapters = book();
    // This generated book is all template (1.7 bits per word against 7.5 to 8 in real
    // prose), which squeezes its spread: the ritual scores z -5.1, so the floor is set here.
    const diagnostics = metricStateRules()[1]!.check({ snapshot: {} as never, chapters, options: { min: -4.5 } });
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(DiagnosticSchema.parse(diagnostic)).toMatchObject({ ruleId: "metrics/predictability", layer: "metrics", severity: "note", confidence: "deterministic" });
      const quote = chapters.get(diagnostic.chapter!)!.slice(diagnostic.range!.start, diagnostic.range!.end);
      expect(quote).toContain("The keeper");
      expect(diagnostic.summary).toMatch(/^\d+ sentences far more predictable than the rest of the book$/u);
      expect(diagnostic.evidence.join("\n")).toMatch(/not for English/u);
    }
    expect(new Set(diagnostics.map((d) => d.chapter))).toEqual(new Set([1, 2, 4]));
  });

  it("leaves a book of varied prose alone", () => {
    const chapters = new Map([1, 2, 3, 4, 5].map((n) => [n, chapter(n)] as const));
    expect(findPredictableStretches(chapters).stretches).toEqual([]);
  });

  it("does not judge a book with too few chapters", () => {
    const chapters = new Map([[1, `${chapter(1)}\n\n${RITUAL}`], [2, `${chapter(2)}\n\n${RITUAL}`]]);
    expect(findPredictableStretches(chapters).stretches).toEqual([]);
  });

  it("scores held-out chapters: text found only in one chapter is not predictable from the others", () => {
    const scorer = kneserNeyScorer();
    const tokens = (text: string) => [text.toLowerCase().split(" ")];
    const scores = scorer.score(new Map([
      [1, tokens("the keeper lit the lamps")],
      [2, tokens("the keeper lit the lamps")],
      [3, tokens("a stranger sold the ledger")],
    ]));
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(scores.get(1)![0]!)).toBeLessThan(mean(scores.get(3)![0]!));
    for (const sentences of scores.values()) for (const bits of sentences[0]!) expect(bits).toBeGreaterThan(0);
  });

  it("keeps the band logic independent of the scorer, and reads the band from packs and rule options", () => {
    // A mock scorer: every word costs 10 bits, except in sentences mentioning "lamp".
    const mock: Scorer = {
      name: "mock model",
      reference: "nothing",
      score: (input) => new Map([...input].map(([chapter, sentences]) =>
        [chapter, sentences.map((sentence) => sentence.map(() => (sentence.includes("lamp") ? 1 : 10 + (sentence.length % 3))))])),
    };
    const lamp = Array.from({ length: 6 }, () => "She trimmed the lamp again and set the lamp down.").join(" ");
    const chapters = new Map([
      [1, chapter(1)], [2, chapter(2)], [3, `${chapter(3)}\n\n${lamp}`],
    ]);
    const found = predictabilityRule({ scorer: mock }).check({ snapshot: {} as never, chapters, options: {} });
    expect(found.map((d) => d.chapter)).toEqual([3]);
    expect(found[0]!.evidence).toContain("Measured with a mock model against nothing");
    // A band from the pack can switch it off by needing more chapters, and rule options win over it.
    expect(predictabilityRule({ scorer: mock, bands: { "metrics/predictability": { minChapters: 4 } } })
      .check({ snapshot: {} as never, chapters, options: {} })).toEqual([]);
    expect(predictabilityRule({ scorer: mock, bands: { "metrics/predictability": { minChapters: 4 } } })
      .check({ snapshot: {} as never, chapters, options: { minChapters: 3 } })).toHaveLength(1);
  });

  it("flags only a deep dip at the default floor, which plain prose in real novels stays above", () => {
    // Words cost 10 to 12 bits by sentence length; a "dim" sentence costs 1.5 bits less (a dip that
    // ordinary dialogue reaches in a novel), a "lamp" sentence 8 bits less (text the book has said before).
    const mock: Scorer = {
      name: "mock model",
      reference: "nothing",
      score: (input) => new Map([...input].map(([chapter, sentences]) =>
        [chapter, sentences.map((sentence) => sentence.map(() => 10 + (sentence.length % 3) - (sentence.includes("lamp") ? 8 : sentence.includes("dim") ? 1.5 : 0)))])),
    };
    const run = (word: string) => Array.from({ length: 6 }, () => `She looked at the ${word} corner and then at the ${word} door.`).join(" ");
    const chapters = new Map([[1, chapter(1)], [2, `${chapter(2)}\n\n${run("dim")}`], [3, `${chapter(3)}\n\n${run("lamp")}`]]);
    const report = findPredictableStretches(chapters, mock);
    expect(report.stretches.map((s) => s.chapter)).toEqual([3]);
    expect(findPredictableStretches(chapters, mock, { ...DEFAULT_PREDICTABILITY_BAND, min: -2.5 }).stretches.map((s) => s.chapter)).toEqual([2, 3]);
    expect(DEFAULT_PREDICTABILITY_BAND.min).toBe(-6);
  });

  it("is fast enough for a novel", () => {
    const chapters = new Map(Array.from({ length: 30 }, (_, i) => [i + 1, chapter(100 + i, 300)] as const));
    const started = Date.now();
    findPredictableStretches(chapters);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
