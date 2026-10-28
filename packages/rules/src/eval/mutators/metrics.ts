import type { CurrentStateFact } from "@actalk/inkos-core";
import { insertAfter as ins, mutator, rewrite, transform, type CleanBook, type FactChange, type MutantSpec, type Mutator } from "../mutant.js";

// Mutators for the L2 metric rules (`@plotlint/metrics`). They are text-only:
// each mutant rewrites one chapter's prose (a 600-word wall of narration, a run
// of equal-length sentences, a chapter turned into one long speech, the sensory
// words taken out, a small vocabulary repeated) and leaves the facts alone,
// except to keep their evidence quotes verbatim. The metric rules live in a
// package that depends on this one, so the harness runs them only when the
// caller passes them in (`textRules`, and the repeated-phrase state rule in the
// registry), as eval/run.mjs and the metrics package's tests do.

const METRIC = ["pacing", "prose", "style", "rhythm", "monoton", "repetit", "dialogue", "exposition", "info-dump", "wall", "sensory", "description", "vocabulary"];

/**
 * A chapter's prose rewritten by `change`, with the facts' evidence quotes from it
 * rewritten the same way; `change` gets where the text starts in the chapter.
 */
function retext(clean: CleanBook, chapter: number, change: (text: string, offset: number) => string): Pick<MutantSpec, "edits" | "change"> {
  const facts: CurrentStateFact[] = clean.facts.filter((f) => f.sourceChapter === chapter && f.evidence);
  const text = clean.chapters.get(chapter)!;
  return {
    edits: [transform(clean, chapter, (whole) => change(whole, 0))],
    change: facts.flatMap((f): FactChange[] => {
      const quote = change(f.evidence!.quote, text.indexOf(f.evidence!.quote));
      return quote === f.evidence!.quote ? [] : [{ target: { subject: f.subject, predicate: f.predicate, object: f.object, validFromChapter: f.validFromChapter }, set: { evidence: { quote } } }];
    }),
  };
}

/** The anchors after which an inserted passage goes: one early, one late, per chapter. */
const ANCHORS: Record<number, [string, string]> = {
  1: ["which was all the money she had in the world.", "\"The mill has turned for three hundred years without me. It can turn for three more days.\""],
  2: ["though she knew it already.", "\"Then help me prove it,\" said Thorne."],
  3: ["and they went straight to Crane's cottage without stopping at their own.", "They sat with him through the evening."],
  4: ["which left her seven.", "\"That is wiser than giving it to me. I will walk beside you.\""],
  5: ["Half the village came.", "\"I will speak for you,\" said Thorne."],
};
/** A new paragraph after the anchor. */
const paragraphAfter = (chapter: number, anchor: string, passage: string) => rewrite(chapter, anchor, `${anchor}\n\n${passage}`);
const eachPlace = (make: (chapter: number, anchor: string, place: "early" | "late") => MutantSpec): MutantSpec[] =>
  [1, 2, 3, 4, 5].flatMap((chapter) => (["early", "late"] as const).map((place, i) => make(chapter, ANCHORS[chapter]![i]!, place)));

// ---- wall of text -----------------------------------------------------------

const WALL = [
  "The Margery had been built at Stavely in the year of the great frost, of oak from the Kirkby woods and elm from the parish glebe, and for thirty years she had carried the river trade between the mills and the coast: grain down, coal and salt and timber up, and now and then a cargo that did not appear on any list.",
  "Her owners had changed four times in those years, as owners do, and each of them had sworn that she was the soundest barge on the Lune and each of them had sold her at a loss to the next.",
  "Tobias Marrow had come to her as a boy of fourteen, first to coil rope and scrub the hold and then to take the tiller on the slack water above the weir, and by the time he was thirty he knew every shoal and sandbar between Wenlow and the sea as well as he knew the floor of his own kitchen in the dark.",
  "The bargemen said he could smell a change in the river before it came, and that he had never once in twenty years put the Margery on the mud, which was more than could be said for any other pilot on that water.",
  "He was not a talking man, and he did not drink in the Heron with the others or sing on the long reaches when the wind was fair, but he was paid well and he was trusted, and when the parish wanted its money carried to the bank at Stavely it was the Margery and her pilot that the council chose, as they had chosen them twice before without any trouble at all.",
  "Nobody now could say who had first suggested it, or who had signed the order, or why the strongbox had been loaded at night instead of in the morning as the custom was; the clerk who kept those papers had died of the fever the next spring, and his books had gone to the vestry and then, by some carelessness that nobody had ever explained, into the vestry stove.",
  "What was known was only this: that the Margery had left the Wenlow staithe an hour after dark with a full hold and a crew of four and the parish money aboard, that the night was clear and the river quiet, and that by morning there was nothing on the water below the bend but a hatch cover and a coil of rope and a single oar, which a boy found in the reeds and carried home to his mother, who burned it.",
  "For ten years afterwards the bargemen would not moor at that bend, and the children of the village dared each other to stand on the bank there after dark and listen for the creak of a tiller that was no longer anywhere at all.",
].join(" ");
/** The wall cut to its first `words` words, ended as a sentence. */
const wallOf = (words: number) => `${WALL.split(/\s+/u).slice(0, words).join(" ").replace(/[,;:]$/u, "")}.`;

/** `metrics/wall-of-text` (ceiling 350 words): a long paragraph of narration with no dialogue. */
export const wallOfTextMutator: Mutator = mutator("metrics/wall-of-text", "A wall of narration: a long paragraph with no dialogue or break.", () => [
  ...eachPlace((chapter, anchor, place) => ({
    chapter, description: `A ${place === "early" ? 600 : 450}-word paragraph of the Margery's history, ${place} in ch${chapter}.`,
    edits: [paragraphAfter(chapter, anchor, wallOf(place === "early" ? 600 : 450))],
    match: [["Margery", "history", "backstory"], METRIC],
  })).slice(0, 9),
  {
    chapter: 3, description: "Expected miss: a 330-word paragraph of history, just under the ceiling.",
    edits: [paragraphAfter(3, ANCHORS[3]![0], wallOf(330))],
    match: [["Margery", "history", "backstory"], METRIC],
  },
]);

// ---- sentence rhythm --------------------------------------------------------

// Sentences of nine words each, for a stretch that never changes pace.
const EVEN = [
  "The road ran on between the wet stone walls.",
  "A crow sat on the gate and watched them pass.",
  "Elspeth kept her hands deep inside her coat pockets.",
  "Jonas walked ahead of her with his cap pulled down.",
  "The fields on either side were brown and empty.",
  "They passed a farm where nobody came to the door.",
  "The wind came off the river and smelled of rain.",
  "Neither of them spoke for a mile or more.",
  "At the next stile Jonas stopped to tie his boot.",
  "Elspeth waited for him and looked back the way.",
  "The village was already out of sight behind them.",
  "They went on again at the same slow pace.",
  "A cart passed them going the other way at noon.",
  "The carter raised his whip to them and said nothing.",
  "They ate bread and cheese under a dripping hedge.",
  "Jonas threw the crusts to a robin on the bank.",
  "The sky was the colour of an old pewter plate.",
  "Elspeth counted the milestones as they went by them.",
  "Each one said the same thing in worn letters.",
  "Her feet hurt and she did not tell her brother.",
];
const evenPassage = (from: number, count: number) => Array.from({ length: count }, (_, i) => EVEN[(from + i) % EVEN.length]!).join(" ");

/** `metrics/sentence-rhythm`: a run of eight or more narrative sentences of the same length. */
export const sentenceRhythmMutator: Mutator = mutator("metrics/sentence-rhythm", "Flat sentence rhythm: a long run of sentences of nearly the same length.", () => [
  ...eachPlace((chapter, anchor, place) => ({
    chapter, description: `Twelve nine-word sentences in a row, ${place} in ch${chapter}.`,
    edits: [paragraphAfter(chapter, anchor, evenPassage(chapter * 3 + (place === "late" ? 7 : 0), 12))],
    match: [["sentence", "rhythm", "monoton", "repetitive", "choppy"], METRIC],
  })).slice(0, 9),
  {
    chapter: 4, description: "Expected miss: only six nine-word sentences in a row, under the eight the rule looks for.",
    edits: [paragraphAfter(4, ANCHORS[4]![0], evenPassage(2, 6))],
    match: [["sentence", "rhythm", "monoton", "repetitive"], METRIC],
  },
]);

// ---- dialogue ratio ---------------------------------------------------------

/** Every paragraph without a quotation mark (except the heading) put inside one: the chapter told as one long speech. Evidence quotes stay verbatim inside. */
const asSpeech = (keepFirst: number) => (text: string) => {
  let seen = 0;
  return text.split("\n\n").map((paragraph) => {
    if (paragraph.startsWith("#") || paragraph.includes("\"")) return paragraph;
    seen += 1;
    return seen <= keepFirst ? paragraph : `"${paragraph}"`;
  }).join("\n\n");
};

/** `metrics/dialogue-ratio` (ceiling 75% of words in quotes): a chapter that is nearly all speech. */
export const dialogueRatioMutator: Mutator = mutator("metrics/dialogue-ratio", "A chapter nearly all dialogue, a script with no ground under it.", (clean) => {
  const speech = (chapter: number, keep: number, description: string): MutantSpec => ({
    chapter, description, edits: [transform(clean, chapter, asSpeech(keep))], match: [["dialogue", "speech", "script", "talking heads"], METRIC],
  });
  return [
    ...[1, 2, 3, 4].map((chapter) => speech(chapter, 0, `Ch${chapter}'s narration recast as a character's speech, every paragraph in quotation marks.`)),
    ...[2, 3, 4].map((chapter) => speech(chapter, 1, `Ch${chapter} recast as speech but for its first narrative paragraph.`)),
    speech(3, 2, "Ch3 recast as speech but for its first two narrative paragraphs."),
    speech(3, 3, "Ch3 recast as speech but for its first three narrative paragraphs."),
    speech(1, 1, "Expected miss: ch1 recast as speech but for its long first paragraph, which leaves 73% of its words in quotes, inside the band."),
    speech(5, 0, "Expected miss: ch5 recast as speech; at 455 words it is under the 500 the rule needs to judge a chapter."),
  ];
});

// ---- sensory detail ---------------------------------------------------------

// The corpus's sensory words (sensory.ts lists) and plain stand-ins for them.
const PLAIN: Record<string, string> = {
  brown: "swift", silver: "old", wet: "worn", blue: "long", grey: "steady", stared: "looked", watched: "followed", laugh: "talk",
  laughing: "talking", black: "deep", light: "day", heavy: "large", smelled: "seemed", gold: "coin", loud: "long", cold: "plain",
  sound: "moment", hard: "long", dark: "night", hears: "learns", tapping: "holding", damp: "age", lit: "took up", watching: "minding",
  hear: "know", laughed: "smiled",
};
const PLAIN_WORD = new RegExp(`\\b(${Object.keys(PLAIN).join("|")})\\b`, "giu");
/** Every sensory word replaced by a plain one, but for the first `keep`. */
const unsensed = (keep: number, chapter: string) => {
  const kept = new Set([...chapter.matchAll(PLAIN_WORD)].slice(0, keep).map((match) => match.index));
  return (text: string, offset: number) => text.replace(PLAIN_WORD, (word, _group, at: number) => {
    if (kept.has(offset + at)) return word;
    const plain = PLAIN[word.toLowerCase()]!;
    return word[0] === word[0]!.toUpperCase() ? plain[0]!.toUpperCase() + plain.slice(1) : plain;
  });
};

/** `metrics/sensory-detail` (floor 10 sensory words per 1000): a chapter with its seeing, hearing and touch taken out. */
export const sensoryDetailMutator: Mutator = mutator("metrics/sensory-detail", "Little sensory detail: the chapter's sensory words replaced with abstract ones.", (clean) => {
  const plain = (chapter: number, keep: number, description: string): MutantSpec => ({
    chapter, description, ...retext(clean, chapter, unsensed(keep, clean.chapters.get(chapter)!)), match: [["sensory", "description", "abstract", "vivid", "concrete", "detail"], METRIC],
  });
  return [
    ...[1, 2, 3, 4].map((chapter) => plain(chapter, 0, `Ch${chapter} with every colour, sound, smell and touch word replaced by a plain one.`)),
    ...[1, 2, 3, 4].map((chapter) => plain(chapter, chapter === 2 ? 1 : 3, `Ch${chapter} with all but ${chapter === 2 ? "one" : "three"} of its sensory words replaced.`)),
    plain(3, 5, "Ch3 with all but five of its sensory words replaced."),
    plain(5, 0, "Expected miss: ch5 with every sensory word replaced; at 455 words it is under the 500 the rule needs to judge a chapter."),
  ];
});

// ---- lexical diversity ------------------------------------------------------

// Sentences of mixed length, so the stretch is flat in vocabulary but not in rhythm.
const SAME = [
  "They walked and they walked, and the road was long, and the road was wet, and they walked on and on down the long wet road.",
  "It was a long day.",
  "Jonas walked and Elspeth walked, and the road went on, and the day went on.",
  "The road was long.",
  "And on they walked, and on the road went, long and wet, and on the day went, long and wet, and on and on and on they went, and the road was long and the day was long.",
  "They walked on.",
  "It was a wet day and a long day, and they were wet.",
];
const samePassage = (paragraphs: number) => Array.from({ length: paragraphs }, (_, i) => `${SAME[i % SAME.length]} ${SAME[(i + 2) % SAME.length]} ${SAME[(i + 4) % SAME.length]}`).join("\n\n");

/** `metrics/lexical-diversity` (MTLD floor 60): a stretch that keeps reusing a handful of words. */
export const lexicalDiversityMutator: Mutator = mutator("metrics/lexical-diversity", "Low lexical diversity: a long stretch written in a handful of words.", () => [
  ...eachPlace((chapter, anchor, place) => ({
    chapter, description: `Five paragraphs of 'they walked and walked' prose, ${place} in ch${chapter}.`,
    edits: [paragraphAfter(chapter, anchor, samePassage(5))],
    match: [["repetit", "vocabulary", "word choice", "same words", "monoton"], METRIC],
  })).slice(0, 9),
  {
    chapter: 2, description: "Expected miss: one paragraph of 'they walked and walked' prose, too little to pull a whole chapter under the floor.",
    edits: [paragraphAfter(2, ANCHORS[2]![0], samePassage(1))],
    match: [["repetit", "vocabulary", "same words"], METRIC],
  },
]);

// ---- repeated phrase --------------------------------------------------------

const TICS: Array<[string, number[]]> = [
  ["with a heart like a stone", [1, 2, 4]],
  ["as quiet as a held breath", [2, 3, 5]],
  ["the colour of old pewter", [1, 3, 5]],
  ["like a door swinging shut", [1, 2, 3]],
  ["with the patience of a heron", [3, 4, 5]],
  ["as cold as the river bottom", [1, 4, 5]],
  ["like a hand on her shoulder", [2, 4, 5]],
  ["with nothing left to lose", [1, 2, 3, 4]],
  ["the weight of ten long years", [2, 3, 4]],
];
const TIC_AT: Record<number, string> = {
  1: "Thorne watched him go.",
  2: "Rook nodded slowly.",
  3: "Elspeth sat on the stool by the bed.",
  4: "Elspeth counted the flagstones from the chapel door.",
  5: "Jonas was sitting in the stern.",
};

/** `metrics/repeated-phrase`: a distinctive phrase that turns up in three or more chapters. */
export const repeatedPhraseMutator: Mutator = mutator("metrics/repeated-phrase", "A pet phrase repeated across chapters.", () => [
  ...TICS.map(([phrase, chapters]): MutantSpec => ({
    chapter: chapters[1]!, description: `"${phrase}" in ch${chapters.join(", ch")}.`,
    edits: chapters.map((chapter) => ins(chapter, TIC_AT[chapter]!, `It came ${phrase}.`)),
    match: [["repeat", "phrase", "again", phrase.split(" ").slice(-1)[0]!], METRIC],
  })),
  {
    chapter: 3, description: "Expected miss: \"like a door swinging shut\" in only two chapters (ch1, ch3).",
    edits: [1, 3].map((chapter) => ins(chapter, TIC_AT[chapter]!, "It came like a door swinging shut.")),
    match: [["repeat", "phrase", "door"], METRIC],
  },
]);

export const metricMutators: ReadonlyArray<Mutator> = [wallOfTextMutator, sentenceRhythmMutator, dialogueRatioMutator, sensoryDetailMutator, lexicalDiversityMutator, repeatedPhraseMutator];
