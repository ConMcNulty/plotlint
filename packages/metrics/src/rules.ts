import type { Diagnostic } from "@plotlint/diagnostics";
import { textDiagnostic, type TextDocument, type TextRule } from "@plotlint/rules";
import { baselineBands } from "./baselines.js";
import { bandNumber, describeBand, mergeBands, outside, type MetricBand, type MetricBands } from "./bands.js";
import { measureChapter, type ChapterMetrics } from "./measures.js";
import type { Span } from "./text.js";

/** What a metric rule is for, shown in rule lists and on hover. */
export interface MetricRuleInfo {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  /** The craft or research source behind the check. */
  readonly source: string;
}

export type MetricRule = TextRule & MetricRuleInfo;

export const METRIC_RULE_IDS = [
  "metrics/lexical-diversity",
  "metrics/sentence-rhythm",
  "metrics/dialogue-ratio",
  "metrics/sensory-detail",
  "metrics/wall-of-text",
] as const;
export type MetricRuleId = (typeof METRIC_RULE_IDS)[number];

export const metricRuleInfo: Readonly<Record<MetricRuleId | "metrics/repeated-phrase", MetricRuleInfo>> = {
  "metrics/lexical-diversity": {
    id: "metrics/lexical-diversity",
    title: "Low lexical diversity",
    rationale: "A chapter that keeps reusing the same small vocabulary reads as flat. MTLD measures how long a run of words stays varied, and hardly depends on chapter length. Only a floor is checked: going further past it is not better writing.",
    source: "McCarthy and Jarvis (2010), \"MTLD, vocd-D, and HD-D: A validation study of sophisticated approaches to lexical diversity assessment\", Behavior Research Methods 42(2)",
  },
  "metrics/sentence-rhythm": {
    id: "metrics/sentence-rhythm",
    title: "Flat sentence rhythm",
    rationale: "Sentences of nearly the same length, one after another, lull the reader; varying length is how prose controls pace and stress. Flags a chapter whose sentence lengths barely vary, and runs of eight or more narrative sentences of near-equal length.",
    source: "Gary Provost, \"100 Ways to Improve Your Writing\" (1985), on varying sentence length; Ursula K. Le Guin, \"Steering the Craft\" (1998), ch. 6 on sentence length and complex syntax",
  },
  "metrics/dialogue-ratio": {
    id: "metrics/dialogue-ratio",
    title: "Dialogue share outside the genre's range",
    rationale: "Novels in a genre tend to keep the share of words spoken aloud within a range. Far more than usual can read like a script with no ground under it; far less can keep characters at a distance. A band, not a target: many fine chapters sit near either edge.",
    source: "Share of words inside quotation marks across chapters of the pack's reference novels; cf. Jack M. Bickham, \"Scene and Structure\" (1993) on scene versus summary",
  },
  "metrics/sensory-detail": {
    id: "metrics/sensory-detail",
    title: "Little sensory detail",
    rationale: "Readers live in a scene through what they can see, hear, smell, taste and touch. A chapter that names almost nothing perceptible can feel abstract. Counts words from short per-sense lists (sensory.ts); only a floor is checked.",
    source: "Janet Burroway, \"Writing Fiction: A Guide to Narrative Craft\", ch. \"Seeing Is Believing: Showing and Telling\" on concrete, significant detail",
  },
  "metrics/wall-of-text": {
    id: "metrics/wall-of-text",
    title: "Wall of text",
    rationale: "A long stretch of narration with no dialogue and no paragraph break is where exposition piles up and readers skim. Measures the longest such run; only a ceiling is checked.",
    source: "Renni Browne and Dave King, \"Self-Editing for Fiction Writers\" (2nd ed. 2004), ch. 9 \"Easy Beats\" and ch. 10 \"Breaking Up Is Easy to Do\" on paragraphing and white space",
  },
  "metrics/repeated-phrase": {
    id: "metrics/repeated-phrase",
    title: "Phrase repeated across chapters",
    rationale: "A distinctive phrase of four to seven words that turns up in several chapters becomes a tic the reader notices. Common function-word strings, dialogue tags and character names are ignored.",
    source: "Browne and King, \"Self-Editing for Fiction Writers\", ch. 11 \"Sophistication\" on repetition; antislop phrase lists",
  },
};

// A rule judges a chapter only once it is long enough for the metric to mean something.
const DEFAULT_MIN_WORDS: Record<MetricRuleId, number> = {
  "metrics/lexical-diversity": 300,
  "metrics/sentence-rhythm": 300,
  "metrics/dialogue-ratio": 500,
  "metrics/sensory-detail": 500,
  "metrics/wall-of-text": 0,
};

// The five rules each measure the same chapter text; keep the last few results.
const cache = new Map<string, ChapterMetrics | null>();
function measured(text: string, band: MetricBand | undefined): ChapterMetrics | null {
  const window = bandNumber(band, "window", 8);
  const windowCv = bandNumber(band, "windowCv", 0.2);
  const key = `${window}:${windowCv}:${text}`;
  if (cache.has(key)) return cache.get(key)!;
  const metrics = measureChapter(text, { window, windowCv });
  cache.set(key, metrics);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return metrics;
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
};
const percent = (value: number) => `${Math.round(value * 100)}%`;

interface Finding {
  readonly span: Span;
  readonly summary: string;
  readonly evidence: string[];
  readonly code?: string;
}

function metricRule(
  id: MetricRuleId,
  band: MetricBand,
  findings: (metrics: ChapterMetrics, band: MetricBand, document: TextDocument) => Finding[],
): MetricRule {
  const info = metricRuleInfo[id];
  const rule: MetricRule = {
    ...info,
    layer: "metrics",
    check({ document }): Diagnostic[] {
      const metrics = measured(document.text, band);
      if (!metrics || metrics.words < bandNumber(band, "minWords", DEFAULT_MIN_WORDS[id])) return [];
      return findings(metrics, band, document).map((finding) => textDiagnostic({
        rule, document, start: finding.span.start, end: finding.span.end, summary: finding.summary,
        severity: "note", evidence: finding.evidence, ...(finding.code ? { code: finding.code } : {}),
      }));
    },
  };
  return rule;
}

// Chapter-level findings point at the first prose paragraph, so they have somewhere to sit in the editor.
const firstParagraph = (metrics: ChapterMetrics): Span => metrics.paragraphs[0]!;

/**
 * The L2 metric text rules, each checking one chapter against its band. `bands`
 * (a pack's `metrics:` section) is laid over the general baseline key by key, so
 * a pack can move just a floor. Every finding is a deterministic note.
 */
export function createMetricRules(bands?: MetricBands): MetricRule[] {
  const all = mergeBands(baselineBands("general"), bands);
  return [
    metricRule("metrics/lexical-diversity", all["metrics/lexical-diversity"] ?? {}, (metrics, band) => {
      if (metrics.mtld === null) return [];
      const side = outside(metrics.mtld, band);
      if (!side) return [];
      return [{
        span: firstParagraph(metrics),
        summary: side === "below"
          ? `Lexical diversity is low for this genre: MTLD ${round(metrics.mtld)}`
          : `Lexical diversity is unusually high for this genre: MTLD ${round(metrics.mtld)}`,
        evidence: [`MTLD ${round(metrics.mtld)} (${describeBand(band)})`, `${metrics.words} words in the chapter`],
      }];
    }),
    metricRule("metrics/sentence-rhythm", all["metrics/sentence-rhythm"] ?? {}, (metrics, band) => {
      const rhythm = metrics.rhythm;
      if (!rhythm || rhythm.lengths.length < bandNumber(band, "minSentences", 20)) return [];
      const findings: Finding[] = [];
      const two = (value: number) => round(value, 2);
      if (outside(rhythm.cv, band) === "below") {
        findings.push({
          span: firstParagraph(metrics),
          summary: `Sentence lengths barely vary across the chapter (CV ${two(rhythm.cv)})`,
          evidence: [
            `Sentence-length CV ${two(rhythm.cv)} (${describeBand({ ...band, max: undefined }, two)})`,
            `${rhythm.lengths.length} sentences, mean ${round(rhythm.mean, 1)} words, standard deviation ${round(rhythm.stdev, 1)}`,
          ],
        });
      }
      const window = bandNumber(band, "window", 8);
      const windowCv = bandNumber(band, "windowCv", 0.2);
      for (const stretch of rhythm.flat) {
        const count = stretch.toSentence - stretch.fromSentence;
        findings.push({
          span: stretch,
          code: "flat-stretch",
          summary: `${count} sentences in a row of nearly the same length (about ${round(stretch.meanWords)} words each)`,
          evidence: [
            `Lowest ${window}-sentence window CV ${two(stretch.cv)} (floor ${two(windowCv)}${typeof band.source === "string" ? ` from ${band.source}` : ""})`,
            `Lengths: ${rhythm.lengths.slice(stretch.fromSentence, stretch.toSentence).join(", ")} words`,
          ],
        });
      }
      return findings;
    }),
    metricRule("metrics/dialogue-ratio", all["metrics/dialogue-ratio"] ?? {}, (metrics, band) => {
      const { ratio, dialogueWords, words } = metrics.dialogue;
      const side = outside(ratio, band);
      if (!side) return [];
      return [{
        span: firstParagraph(metrics),
        summary: side === "below" ? `Very little dialogue for this genre: ${percent(ratio)} of words` : `Dialogue-heavy for this genre: ${percent(ratio)} of words`,
        evidence: [`Dialogue ${percent(ratio)} of words (${describeBand(band, percent)})`, `${dialogueWords} of ${words} words inside quotation marks`],
      }];
    }),
    metricRule("metrics/sensory-detail", all["metrics/sensory-detail"] ?? {}, (metrics, band) => {
      const { perThousand, bySense, count } = metrics.sensory;
      if (outside(perThousand, band) !== "below") return [];
      const senses = Object.entries(bySense).map(([sense, value]) => `${sense} ${round(value, 1)}`).join(", ");
      return [{
        span: firstParagraph(metrics),
        summary: `Little sensory detail: ${round(perThousand, 1)} sensory words per 1000`,
        evidence: [
          `Sensory words ${round(perThousand, 1)} per 1000 (${describeBand({ ...band, max: undefined }, (value) => round(value, 1))})`,
          `${count} sensory words; per 1000 by sense: ${senses}`,
        ],
      }];
    }),
    metricRule("metrics/wall-of-text", all["metrics/wall-of-text"] ?? {}, (metrics, band) => {
      const wall = metrics.wallOfText;
      if (!wall || outside(wall.words, { ...band, min: undefined }) !== "above") return [];
      return [{
        span: wall,
        summary: `${wall.words} words of narration with no dialogue or paragraph break`,
        evidence: [`Longest unbroken narration ${wall.words} words (${describeBand({ ...band, min: undefined })})`],
      }];
    }),
  ];
}
