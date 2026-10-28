import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@plotlint/diagnostics";
import {
  applyEdits, arbitrate, authorPrompt, blindOrder, changedScenes, detectGaming, editRegion, findingKey, judgeDefence, layerEditors,
  parseAuthorReply, placeEdit, readerEditor, readerFindings, rotation, runLoop, runSinglePass, shiftOffset, summarizePreferences,
  voiceDistance, voiceLimit, vocabularyOf, type Author, type AuthorInput, type Draft, type Finding, type PairKey,
} from "../index.js";

const chapter = 3;

function textFinding(text: string, quote: string, overrides: Partial<Diagnostic> = {}): Diagnostic {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`"${quote}" not in text`);
  return {
    ruleId: "style/general.FilterWords",
    layer: "style",
    severity: "warning",
    confidence: "deterministic",
    code: "FilterWords",
    summary: `Filter word "${quote}"`,
    evidence: [`"${quote}"`],
    chapter,
    range: { sourceId: `chapter:${chapter}`, start, end: start + quote.length },
    sourceRefs: [{ sourceId: `chapter:${chapter}`, quote }],
    ...overrides,
  };
}

const TEXT = [
  "# Chapter 3",
  "",
  "Mira felt that the tide was turning. She walked to the quay and waited for the boat.",
  "",
  "The harbour master watched her from his window. He did not wave.",
  "",
  "* * *",
  "",
  "At dusk the boat came in. Mira saw that it was empty.",
].join("\n");

/** A lint stand-in: one warning per filter phrase still in the text. */
const PHRASES = ["felt that", "saw that"];
const lint = async (draft: Draft): Promise<Diagnostic[]> =>
  PHRASES.filter((phrase) => draft.text.includes(phrase)).map((phrase) => textFinding(draft.text, phrase));

/** An author that removes "that" after each filter verb, quoting the whole phrase. */
const fixingAuthor: Author = {
  name: "fake",
  async respond({ findings, draft }: AuthorInput) {
    return findings.map((finding) => {
      const quote = draft.text.slice(finding.span!.start, finding.span!.end);
      return { id: finding.id, action: "fix" as const, reason: "cut the filter", edits: [{ find: quote, replace: quote.replace(" that", "") }] };
    });
  },
};

describe("spans", () => {
  it("places an edit only inside the region and only when unambiguous", () => {
    const sentence = editRegion(TEXT, { start: TEXT.indexOf("felt"), end: TEXT.indexOf("felt") + 4 }, "sentence")!;
    expect(TEXT.slice(sentence.start, sentence.end)).toBe("Mira felt that the tide was turning.");
    expect(placeEdit(TEXT, { find: "the tide", replace: "the sea" }, sentence)).toMatchObject({ span: { start: TEXT.indexOf("the tide") } });
    expect(placeEdit(TEXT, { find: "the boat", replace: "a boat" }, sentence)).toBe("outside-region");
    expect(placeEdit(TEXT, { find: "Mira", replace: "She" }, { start: 0, end: TEXT.length })).toBe("ambiguous");
    expect(placeEdit(TEXT, { find: "not here", replace: "x" }, sentence)).toBe("not-found");
    // Twice in the chapter, once in the region: the one in the region.
    const second = editRegion(TEXT, { start: TEXT.indexOf("Mira saw"), end: TEXT.indexOf("Mira saw") + 4 }, "sentence")!;
    expect(placeEdit(TEXT, { find: "Mira", replace: "She" }, second)).toMatchObject({ span: { start: TEXT.indexOf("Mira saw") } });
  });

  it("applies edits and maps offsets through them", () => {
    const a = placeEdit(TEXT, { find: "felt that", replace: "felt" }, { start: 0, end: TEXT.length });
    const b = placeEdit(TEXT, { find: "saw that", replace: "saw" }, { start: 0, end: TEXT.length });
    if (typeof a === "string" || typeof b === "string") throw new Error("not placed");
    const { text, changed } = applyEdits(TEXT, [b, a]);
    expect(text).toContain("Mira felt the tide");
    expect(text).toContain("Mira saw it was empty");
    expect(text.slice(changed[0]!.start, changed[0]!.end)).toBe("felt");
    const harbour = TEXT.indexOf("harbour");
    expect(text.slice(shiftOffset(harbour, [a, b]), shiftOffset(harbour, [a, b]) + 7)).toBe("harbour");
    expect(changedScenes(text, changed, chapter)).toHaveLength(2);
  });

  it("keys a finding by its words, not its offsets or numbers", () => {
    const moved = `Prologue.\n\n${TEXT}`;
    expect(findingKey(textFinding(TEXT, "felt that"), TEXT)).toBe(findingKey(textFinding(moved, "felt that"), moved));
    const metric = (value: number): Diagnostic => ({ ruleId: "metrics/lexical-diversity", layer: "metrics", severity: "note", confidence: "deterministic", code: "lexical-diversity", summary: `Lexical diversity is low: MTLD ${value}`, evidence: [`MTLD ${value}`], chapter });
    expect(findingKey(metric(60), TEXT)).toBe(findingKey(metric(64), TEXT));
  });
});

describe("arbiter", () => {
  it("merges duplicates, drops the lower-priority side of a conflict and ranks errors first", () => {
    const filter = textFinding(TEXT, "felt that");
    const harper: Diagnostic = { ...textFinding(TEXT, "felt that"), ruleId: "mechanics/harper", layer: "mechanics", severity: "note" };
    const error: Diagnostic = { ...textFinding(TEXT, "harbour master"), ruleId: "continuity/dead-entity-acts", layer: "continuity", severity: "error", confidence: "extracted" };
    const more: Diagnostic = { ruleId: "metrics/sensory-detail", layer: "metrics", severity: "note", confidence: "deterministic", code: "sensory-detail", summary: "Little sensory detail", evidence: ["2.0 per 1,000 words"], chapter };
    const less: Diagnostic = { ruleId: "judgment/beta-reader", layer: "judgment", severity: "note", confidence: "judged", code: "less:description", summary: "skeptic: too much scenery", evidence: ["x"], chapter };
    const { findings, log } = arbitrate([
      { editor: "line", diagnostic: filter }, { editor: "line", diagnostic: harper }, { editor: "continuity", diagnostic: error },
      { editor: "line", diagnostic: more }, { editor: "beta", diagnostic: less }, { editor: "line", diagnostic: filter },
    ], TEXT, ["metrics/*"]);
    expect(findings.map((finding) => finding.diagnostic.ruleId)).toEqual(["continuity/dead-entity-acts", "style/general.FilterWords", "metrics/sensory-detail"]);
    expect(findings[0]!.id).toBe("f1");
    expect(log.map((entry) => entry.kind).sort()).toEqual(["conflict", "merged"]);
  });

  it("escalates defences of errors from code and rejects empty ones", () => {
    const finding = (severity: Diagnostic["severity"]): Finding => ({ id: "f1", key: "k", editors: ["line"], diagnostic: textFinding(TEXT, "felt that", { severity }) });
    const reason = "the filter verb is deliberate: Mira doubts her own senses here";
    expect(judgeDefence(finding("warning"), { id: "f1", action: "defend", reason, edits: [] })).toBe("accepted");
    expect(judgeDefence(finding("error"), { id: "f1", action: "defend", reason, edits: [] })).toBe("escalated");
    expect(judgeDefence(finding("warning"), { id: "f1", action: "defend", reason: "It's fine.", edits: [] })).toBe("rejected");
  });
});

describe("author agent", () => {
  it("parses replies, ignores unknown ids and keeps edits only for fixes", () => {
    const reply = `<think>hm</think>Here: {"responses": [
      {"id": "f1", "action": "fix", "reason": "cut", "edits": [{"find": "felt that", "replace": "felt"}]},
      {"id": "f2", "action": "defend", "reason": "deliberate echo of the first chapter's opening", "edits": [{"find": "x", "replace": "y"}]},
      {"id": "f9", "action": "fix", "reason": "?", "edits": []}]}`;
    const responses = parseAuthorReply(reply, ["f1", "f2"]);
    expect(responses).toHaveLength(2);
    expect(responses[1]!.edits).toEqual([]);
  });

  it("shows each finding with the region it may edit", () => {
    const diagnostic = textFinding(TEXT, "felt that");
    const [{ content }] = authorPrompt({
      draft: { chapter, text: TEXT }, round: 1, voiceSample: TEXT,
      findings: [{ id: "f1", key: "k", editors: ["line"], diagnostic, span: { start: diagnostic.range!.start, end: diagnostic.range!.end }, region: { start: 0, end: 10 } }],
    }).slice(1);
    expect(content).toContain("[f1] warning style/general.FilterWords");
    expect(content).toContain(`you may edit only inside: "${TEXT.slice(0, 10)}"`);
  });
});

describe("beta readers", () => {
  it("rotates personas and models by round", () => {
    expect(rotation(["a", "b", "c"], ["m1", "m2"], 1)).toEqual([{ persona: "b", model: "m2" }]);
    expect(rotation(["a", "b", "c"], ["m1", "m2"], 2)).toEqual([{ persona: "c", model: "m1" }]);
  });

  it("keeps only reactions whose quote is in the passage", async () => {
    const reply = JSON.stringify({ reactions: [
      { kind: "confused", quote: "The harbour master watched her", note: "Who is he?", axis: null },
      { kind: "wants-less", quote: "At dusk the boat came in.", note: "Too slow", axis: "description" },
      { kind: "bored", quote: "words that are not there", note: "-", axis: null },
      { kind: "moved", quote: "He did not wave.", note: "Nice", axis: null },
    ], prediction: "The boat's crew is dead." });
    const { diagnostics, prediction } = readerFindings(reply, { name: "skeptic", brief: "" }, chapter, TEXT, { start: 0, end: TEXT.length });
    expect(diagnostics.map((d) => d.code)).toEqual(["confused", "less:description"]);
    expect(diagnostics.every((d) => d.severity === "note" && d.confidence === "judged")).toBe(true);
    expect(prediction).toBe("The boat's crew is dead.");

    const predictions: string[] = [];
    const editor = readerEditor({ models: [{ name: "fake", complete: async () => reply }], onPrediction: (p) => predictions.push(p.text) });
    const found = await editor.check({ draft: { chapter, text: TEXT }, round: 0, scope: [{ start: TEXT.indexOf("At dusk"), end: TEXT.length }] });
    expect(found.map((d) => d.code)).toEqual(["less:description"]);
    expect(predictions).toHaveLength(1);
  });
});

describe("gaming detectors", () => {
  const before = "She walked to the quay. The boat was late. She waited by the rail and watched the water for a long time.";
  const vocabulary = vocabularyOf([before]);
  const place = (text: string, find: string, replace: string) => {
    const at = placeEdit(text, { find, replace }, { start: 0, end: text.length });
    if (typeof at === "string") throw new Error(at);
    return at;
  };

  it("flags thesaurus words the book never used", () => {
    const edit = place(before, "watched the water", "contemplated the effervescent, iridescent, crepuscular water");
    const { text: after, changed } = applyEdits(before, [edit]);
    const flags = detectGaming({ chapter, before, after, edits: [{ ...edit, findingId: "f1" }], changed, findings: [], vocabulary });
    expect(flags.map((flag) => flag.ruleId)).toEqual(["loop/thesaurus-words"]);
  });

  it("flags an inserted mention-only line answering a setup finding", () => {
    const finding: Finding = { id: "f1", key: "k", editors: ["developmental"], diagnostic: { ruleId: "structure/unpaid-setup", layer: "structure", severity: "warning", confidence: "extracted", code: "unpaid-setup", summary: "The brass key never comes back", evidence: ["key"], chapter } };
    const edit = place(before, "The boat was late.", "The boat was late. She noticed the brass key in her pocket.");
    const { text: after, changed } = applyEdits(before, [edit]);
    const flags = detectGaming({ chapter, before, after, edits: [{ ...edit, findingId: "f1" }], changed, findings: [finding], vocabulary });
    expect(flags.map((flag) => flag.ruleId)).toEqual(["loop/empty-setup"]);
  });

  it("flags rote long-short alternation the revision made", () => {
    const long = "She walked the whole length of the quay past the nets and the crates and the sleeping dogs.";
    const short = "Nothing moved.";
    const paragraph = Array.from({ length: 4 }, () => `${long} ${short}`).join(" ");
    const edit = place(before, before, paragraph);
    const { text: after, changed } = applyEdits(before, [edit]);
    const flags = detectGaming({ chapter, before, after, edits: [{ ...edit, findingId: "f1" }], changed, findings: [], vocabulary: vocabularyOf([paragraph]) });
    expect(flags.map((flag) => flag.ruleId)).toEqual(["loop/uniform-variation"]);
  });
});

describe("voice", () => {
  it("is zero for the same text and grows with heavier rewriting", () => {
    expect(voiceDistance(TEXT, TEXT)).toBe(0);
    const light = TEXT.replace("walked", "went");
    const heavy = TEXT.replace(/\bthe\b/gu, "this").replace(/\bwas\b/gu, "remained").replace(/\bShe\b/gu, "One");
    expect(voiceDistance(TEXT, light)).toBeLessThan(voiceDistance(TEXT, heavy));
    expect(voiceLimit([TEXT], 0.07)).toBe(0.07);
  });
});

describe("runLoop", () => {
  it("fixes findings, reruns the checks and stops clean", async () => {
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(lint), author: fixingAuthor });
    expect(result.stop.reason).toBe("clean");
    expect(result.text).not.toContain("felt that");
    expect(result.text).not.toContain("saw that");
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]!.decisions.map((d) => d.outcome)).toEqual(["applied", "applied"]);
    expect(result.visible.end.weighted).toBe(0);
    expect(result.gate.needsHuman).toBe(false);
  });

  it("accepts a reasoned defence and does not ask again", async () => {
    let calls = 0;
    const defender: Author = {
      name: "fake",
      async respond({ findings }) {
        calls += 1;
        return findings.map((finding) => ({ id: finding.id, action: "defend" as const, reason: "Mira's uncertainty about her own senses is the point of this chapter", edits: [] }));
      },
    };
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(lint), author: defender, maxDefendShare: 1 });
    expect(result.stop.reason).toBe("clean");
    expect(result.defended).toHaveLength(2);
    expect(calls).toBe(1);
    expect(result.text).toBe(TEXT);
  });

  it("escalates defences beyond the allowed share to the human gate", async () => {
    const defender: Author = {
      name: "fake",
      async respond({ findings }) {
        return findings.map((finding) => ({ id: finding.id, action: "defend" as const, reason: "Mira's uncertainty about her own senses is the point of this chapter", edits: [] }));
      },
    };
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(lint), author: defender });
    expect(result.defended).toHaveLength(1);
    expect(result.escalated).toHaveLength(1);
    // The escalated warning still counts and the author is not asked again.
    expect(result.stop.reason).toBe("escalated");
    expect(result.visible.end.warnings).toBe(1);
    expect(result.open).toHaveLength(1);
    expect(result.gate.needsHuman).toBe(true);
  });

  it("rejects edits outside the flagged region and stops when nothing improves", async () => {
    const wanderer: Author = {
      name: "fake",
      async respond({ findings }) {
        return findings.map((finding) => ({ id: finding.id, action: "fix" as const, reason: "rewrite", edits: [{ find: "He did not wave.", replace: "He waved." }] }));
      },
    };
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(lint), author: wanderer, maxRounds: 5 });
    expect(result.text).toBe(TEXT);
    expect(result.stop.reason).toBe("stalled");
    expect(result.rounds[0]!.decisions[0]!.edits![0]!.problem).toBe("outside-region");
  });

  it("stops on the voice limit without keeping the round's edits", async () => {
    const rewriter: Author = {
      name: "fake",
      async respond({ findings, draft }) {
        return findings.slice(0, 1).map((finding) => ({ id: finding.id, action: "fix" as const, reason: "rewrite", edits: [{ find: draft.text.slice(finding.region!.start, finding.region!.end), replace: "Mira apprehended, with considerable trepidation, an oceanic reversal." }] }));
      },
    };
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(lint), author: rewriter, voiceLimit: 0.01, voiceMinWords: 0 });
    expect(result.stop.reason).toBe("voice");
    expect(result.text).toBe(TEXT);
  });

  it("stops when held-out checks fall while visible ones rise, keeping the last safe draft", async () => {
    // A held-out check that fires once the visible fix is made: the loop must not keep that draft.
    const heldLint = async (draft: Draft): Promise<Diagnostic[]> => [
      ...await lint(draft),
      ...(draft.text.includes("felt that") ? [] : [{ ...textFinding(draft.text, "Mira"), ruleId: "metrics/predictability", layer: "metrics" as const, severity: "warning" as const }]),
    ];
    const result = await runLoop({ chapter, text: TEXT, editors: layerEditors(heldLint), author: fixingAuthor, warningThreshold: -1, maxRounds: 3 });
    expect(result.stop.reason).toBe("held-out");
    expect(result.text).toBe(TEXT);
    expect(result.gate.needsHuman).toBe(true);
  });

  it("runs a single pass as one round", async () => {
    const result = await runSinglePass({ chapter, text: TEXT, editors: layerEditors(lint), author: fixingAuthor, warningThreshold: -1 });
    expect(result.rounds).toHaveLength(1);
    expect(result.stop.reason).toBe("rounds");
  });
});

describe("blind preferences", () => {
  it("counts people, not proxies, and calls the gate on the interval", () => {
    expect(blindOrder("pair-1")).toBe(blindOrder("pair-1"));
    const keys = new Map<string, PairKey>(Array.from({ length: 25 }, (_, i) => [`p${i}`, { version: 1, id: `p${i}`, chapter: 1, loop: i % 2 ? "A" : "B", createdAt: "2026-10-28" }] as const));
    const prefs = [...keys.values()].map((key, i) => ({ pair: key.id, choice: (i < 22 ? key.loop : key.loop === "A" ? "B" : "A") as "A" | "B", reader: "r1", at: "2026-10-28" }));
    const summary = summarizePreferences([...prefs, { pair: "p0", choice: "same", reader: "glm", proxy: true, at: "x" }], keys);
    expect(summary.n).toBe(25);
    expect(summary.loopWins).toBe(22);
    expect(summary.call).toBe("loop preferred");
    expect(summary.proxy.ties).toBe(1);
    expect(summarizePreferences(prefs.slice(0, 5), keys).call).toBe("not enough data");
  });
});
