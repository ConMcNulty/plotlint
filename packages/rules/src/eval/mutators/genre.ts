import type { CurrentStateFact } from "@actalk/inkos-core";
import { fact, insertAfter as ins, mutator, rewrite, transform, type CleanBook, type FactChange, type MutantSpec, type Mutator } from "../mutant.js";
import { CRANE, ELSPETH, JONAS, ROOK, THORNE } from "./words.js";

// Mutators for the genre rules. Wenlow, a mystery with no culprit unmasked by the
// state and no couple, cannot host fair play or the romance checks, so they run
// on `thornbury`, a four-chapter village mystery with a romance (Nell Ashby and
// Constable Tom Hale; Margaret Lyle poisons Silas Venn; Nell's POV but for ch2,
// Tom's). Invented-term spelling runs on wenlow's names.

const THORNBURY = "thornbury";
const NELL = ["Nell", "Ashby"];
const TOM = ["Tom", "Hale", "constable"];
const MARGARET = ["Margaret", "Lyle", "culprit", "killer", "poisoner"];
const FAIR = ["clue", "fair", "foreshadow", "set up", "introduced", "unearned", "out of nowhere", "first appears", "no hint", "reveal", "cheat"];
const HEA = ["ending", "happy", "hopeful", "romance", "unsatisfying", "bleak", "break", "together", "apart"];
const CENTRAL = ["romance", "relationship", "together", "absent", "subplot", "chemistry", "scenes together"];
const POVS = ["point of view", "pov", "viewpoint", "perspective", "inside", "interior"];
const SPELL = ["spell", "spelt", "typo", "inconsistent", "variant", "misspel", "different name"];

// ---- helpers over the fixture ---------------------------------------------

const replaceAll = (text: string, pairs: ReadonlyArray<readonly [string, string]>) =>
  pairs.reduce((out, [from, to]) => out.split(from).join(to), text);
const keyOf = (f: CurrentStateFact) => ({ subject: f.subject, predicate: f.predicate, object: f.object, validFromChapter: f.validFromChapter });

/**
 * Rename a person in some chapters, prose and facts alike, as if the author had
 * written another character there: every pair is replaced in order (full name first).
 */
function rename(clean: CleanBook, chapters: ReadonlyArray<number>, pairs: ReadonlyArray<readonly [string, string]>): Pick<MutantSpec, "edits" | "change"> {
  const edits = chapters.map((chapter) => transform(clean, chapter, (text) => replaceAll(text, pairs)));
  const change: FactChange[] = clean.facts.filter((f) => chapters.includes(f.sourceChapter)).flatMap((f) => {
    const next = { subject: replaceAll(f.subject, pairs), object: replaceAll(f.object, pairs), quote: f.evidence ? replaceAll(f.evidence.quote, pairs) : undefined };
    if (next.subject === f.subject && next.object === f.object && next.quote === f.evidence?.quote) return [];
    return [{ target: keyOf(f), set: { subject: next.subject, object: next.object, ...(next.quote ? { evidence: { quote: next.quote } } : {}) } }];
  });
  return { edits, change };
}

const factOf = (clean: CleanBook, subject: string, predicate: string, chapter: number) => {
  const found = clean.facts.find((f) => f.subject === subject && f.predicate === predicate && f.sourceChapter === chapter);
  if (!found) throw new Error(`thornbury has no fact ${subject} · ${predicate} in ch${chapter}`);
  return found;
};
const remove = (clean: CleanBook, subject: string, predicate: string, chapter: number): FactChange => ({ target: keyOf(factOf(clean, subject, predicate, chapter)), set: null });

// ---- fair play ------------------------------------------------------------

const MARGARET_TO = (name: string): Array<readonly [string, string]> => {
  const surname = name.split(" ").pop()!;
  return [["Margaret Lyle", name], ["Miss Lyle", `Miss ${surname}`], ["Margaret", name.split(" ")[0]!]];
};

/** Every clue before the reveal taken out: the bottle in her basket (ch1), the cut border and the missing bottle (ch3), and the debt fact. */
function noClues(clean: CleanBook): Pick<MutantSpec, "edits" | "change"> {
  return {
    edits: [
      rewrite(1, "In her basket, among the parsnips, was a green glass bottle with a cork in it, the sort chemists sell tonic in.", "In her basket were parsnips and a prayer book."),
      rewrite(3, "on her knees by the long border under the wall, and she did not hear Nell on the path. The border had been full of foxgloves all summer, tall and purple and freckled at the throat. Now every stem was cut down to the ground, and the cuttings were gone.", "on her knees by the long border under the wall, weeding the asters, and she did not hear Nell on the path."),
      rewrite(3, "Her basket was on the grass beside her. The parsnips were still in it, but the green glass bottle was not.", "She brushed the earth from her skirt."),
    ],
    change: [
      remove(clean, "Margaret Lyle", "owes", 1), remove(clean, "Margaret Lyle", "holds", 1),
      remove(clean, "Margaret Lyle", "cut down", 3), remove(clean, "Nell Ashby", "knows", 3),
    ],
  };
}
const REVEAL = { subject: "Margaret Lyle", predicate: "poisoned", object: "Silas Venn", validFromChapter: 4 } as const;
const merge = (...parts: Array<Partial<MutantSpec>>): Partial<MutantSpec> => ({
  edits: parts.flatMap((p) => p.edits ?? []), change: parts.flatMap((p) => p.change ?? []), add: parts.flatMap((p) => p.add ?? []),
});

/**
 * `structure/fair-play`: the culprit first on the page in the reveal chapter or
 * after the first third of the book, or a solution resting on nothing shown before it.
 */
export const fairPlayMutator: Mutator = mutator("structure/fair-play", "The mystery's solution is not fairly clued: the culprit appears late, or the clues are first given at the reveal.", (clean) => [
  { chapter: 4, description: "Every clue before the reveal is cut: no bottle in Margaret's basket, no cut foxgloves, no debt.", ...noClues(clean), match: [MARGARET, FAIR] },
  { chapter: 4, description: "Margaret Lyle is someone else (Agnes Pell) in ch1–3, so the culprit first appears in the reveal chapter.", ...rename(clean, [1, 3], MARGARET_TO("Agnes Pell")), match: [MARGARET, FAIR] },
  { chapter: 3, description: "Another woman (Ada Brough) quarrels with Venn in ch1, so Margaret first appears in ch3, after the first third.", ...rename(clean, [1], MARGARET_TO("Ada Brough")), match: [MARGARET, FAIR] },
  {
    chapter: 4, description: "A new culprit, Edwin Crabbe, never seen before, is named in the reveal.",
    edits: [rewrite(4, "I poisoned Silas Venn, Constable. I am not sorry.\"", "But it was Edwin Crabbe, the chemist's man, who poisoned Silas Venn, Constable. I only paid him.\"")],
    change: [{ target: REVEAL, set: { subject: "Edwin Crabbe", evidence: { quote: "it was Edwin Crabbe, the chemist's man, who poisoned Silas Venn" } } }],
    match: [["Crabbe", "chemist"], FAIR],
  },
  {
    chapter: 4, description: "No clues before the reveal, which GLM records as 'is the killer of'.",
    ...merge(noClues(clean), { change: [{ target: REVEAL, set: { predicate: "is the killer of" } }] }),
    match: [MARGARET, FAIR],
  },
  {
    chapter: 4, description: "Margaret is renamed in ch1–3 (Hester Quayle), and the reveal is recorded victim-first, 'Silas Venn · murdered by · Margaret Lyle'.",
    ...merge(rename(clean, [1, 3], MARGARET_TO("Hester Quayle")), { change: [{ target: REVEAL, set: { subject: "Silas Venn", predicate: "murdered by", object: "Margaret Lyle" } }] }),
    match: [MARGARET, FAIR],
  },
  {
    chapter: 4, description: "No clues before the reveal, and the solution turns on digitalis bought at the Hexham chemist, first mentioned in ch4.",
    ...merge(noClues(clean), {
      edits: [ins(4, "She folded her hands.", "\"I bought the digitalis at the Hexham chemist, under my mother's name.\"")],
      add: [fact("Margaret Lyle", "bought", "digitalis from the Hexham chemist", 4, { quote: "I bought the digitalis at the Hexham chemist" })],
    }),
    match: [MARGARET, FAIR],
  },
  {
    chapter: 3, description: "Margaret first appears in ch3 (renamed Ada Brough in ch1) and her ch3 clues are cut too.",
    ...merge(rename(clean, [1], MARGARET_TO("Ada Brough")), {
      edits: [
        rewrite(3, "on her knees by the long border under the wall, and she did not hear Nell on the path. The border had been full of foxgloves all summer, tall and purple and freckled at the throat. Now every stem was cut down to the ground, and the cuttings were gone.", "on her knees by the long border under the wall, weeding the asters, and she did not hear Nell on the path."),
        rewrite(3, "Her basket was on the grass beside her. The parsnips were still in it, but the green glass bottle was not.", "She brushed the earth from her skirt."),
      ],
      change: [remove(clean, "Margaret Lyle", "cut down", 3), remove(clean, "Nell Ashby", "knows", 3)],
    }),
    match: [MARGARET, FAIR],
  },
  {
    chapter: 4, description: "The vicar, Arthur Lyle, never on the page, confesses; his sister's surname in ch1 passes for his appearance, but nothing before the reveal links him to the crime.",
    edits: [rewrite(4, "I poisoned Silas Venn, Constable. I am not sorry.\"", "But it was my brother, Arthur Lyle, who poisoned Silas Venn, Constable, to save his living.\"")],
    change: [{ target: REVEAL, set: { subject: "Arthur Lyle", evidence: { quote: "it was my brother, Arthur Lyle, who poisoned Silas Venn" } } }],
    match: [["Arthur", "vicar"], FAIR],
  },
  {
    chapter: 4, description: "Expected miss: no clues before the reveal, which GLM words 'was responsible for the death of', outside the reveal vocabulary.",
    ...merge(noClues(clean), { change: [{ target: REVEAL, set: { predicate: "was responsible for the death of" } }] }),
    match: [MARGARET, FAIR],
  },
], undefined, THORNBURY);

// ---- romance --------------------------------------------------------------

const PROPOSAL = "\"Ask me now,\" said Nell. \"I love you, Tom Hale. I have for years. Yes, I will come to the dance, and yes to anything else you were going to ask.\"";
const LAST = "He kissed her on the doorstep, in front of the whole of Mill Lane, and by morning they were engaged and all Thornbury knew that too.";
const LEADS = { config: { version: 1 as const, rules: { "structure/hopeful-ending": { options: { leads: ["Nell Ashby", "Tom Hale"] } } } } };

/** The proposal scene rewritten to an unhappy ending, with the fact a settler records for it in place of the clean love and engagement. */
const ending = (clean: CleanBook, answer: string, last: string, recorded: CurrentStateFact | null, description: string, extra: Partial<MutantSpec> = {}): MutantSpec => ({
  chapter: 4, description,
  edits: [rewrite(4, PROPOSAL, answer), rewrite(4, LAST, last)],
  change: [remove(clean, "Nell Ashby", "in love with", 4), remove(clean, "Tom Hale", "engaged to", 4)],
  add: recorded ? [recorded] : [],
  match: [NELL, HEA],
  ...extra,
});

/** `structure/hopeful-ending`: the finished romance's last word on the couple is a break-up, a death or a parting. */
export const hopefulEndingMutator: Mutator = mutator("structure/hopeful-ending", "The romance ends unhappily for the leads.", (clean) => [
  ending(clean, "\"Don't ask me,\" said Nell. \"I cannot marry a man who arrests old women at tea. Go home, Tom Hale.\"", "He went home alone, and by morning all Thornbury knew that too.",
    fact("Nell Ashby", "rejected", "Tom Hale", 4, { kind: "relationship", quote: "Go home, Tom Hale." }), "Nell turns Tom down for good."),
  ending(clean, "\"I won't,\" said Tom, before she could speak. \"Not now. I don't think I can, after today.\"", "He broke it off there on the doorstep, and by morning all Thornbury knew that too.",
    fact("Tom Hale", "broke up with", "Nell Ashby", 4, { quote: "He broke it off there on the doorstep" }), "Tom breaks it off after the arrest."),
  ending(clean, "\"Ask me tomorrow,\" said Nell, and he smiled and said he would.", "But Margaret Lyle had poured his tea as well as Venn's, and by morning Tom Hale was dead.",
    fact("Tom Hale", "status", "dead", 4, { kind: "status", quote: "by morning Tom Hale was dead" }), "Margaret poisoned Tom's tea too: he dies the night of the arrest.", { book: LEADS }),
  ending(clean, "\"No,\" said Nell. \"Not to the dance, and not to anything else.\"", "They did not speak again that year, and by morning all Thornbury knew they were estranged.",
    fact("Nell Ashby", "relationship", "estranged from Tom Hale", 4, { kind: "relationship", quote: "all Thornbury knew they were estranged" }), "The leads are estranged at the end."),
  ending(clean, "\"Don't,\" said Nell, and he did not; whatever he had felt for her had gone out of him in the vicarage.", "He walked away up the lane, and by morning all Thornbury knew that too.",
    fact("Tom Hale", "no longer loves", "Nell Ashby", 4, { quote: "whatever he had felt for her had gone out of him in the vicarage" }), "Tom no longer loves Nell."),
  ending(clean, "\"Ask someone else,\" said Nell. \"We were sweethearts once, Tom Hale. Not now.\"", "He went, and by morning all Thornbury knew that too.",
    fact("Nell Ashby", "relationship", "former sweetheart of Tom Hale", 4, { kind: "relationship", quote: "We were sweethearts once, Tom Hale." }), "Nell calls Tom her former sweetheart."),
  ending(clean, "\"I'm going to London,\" said Nell. \"Goodbye, Tom Hale.\"", "She left on the morning train, and by morning all Thornbury knew that too.",
    fact("Nell Ashby", "said goodbye to", "Tom Hale", 4, { quote: "\"Goodbye, Tom Hale.\"" }), "Nell says goodbye and leaves for London."),
  ending(clean, "\"Ask me tomorrow,\" said Nell, and went in, and that night her heart gave out on the stairs.", "Doctor Marsh said it was the shock, and by morning all Thornbury knew that Nell Ashby was dead.",
    fact("Nell Ashby", "status", "dead", 4, { kind: "status", quote: "all Thornbury knew that Nell Ashby was dead" }), "Nell dies the night of the arrest.", { book: LEADS }),
  ending(clean, "\"Don't,\" said Nell. \"I would rather be on my own.\"", "He went home, and by morning all Thornbury knew that too.",
    fact("Nell Ashby", "relationship status", "single again", 4, { quote: "\"I would rather be on my own.\"" }), "Expected miss: GLM records Nell as 'single again', naming no one, so the fact is not about the couple."),
  ending(clean, "\"Not now,\" said Nell, and found she did not mind.", "He went home, and by morning all Thornbury knew that too.",
    fact("Nell Ashby", "feelings for Tom Hale", "cooled", 4, { quote: "found she did not mind" }), "Expected miss: 'feelings for Tom Hale · cooled' reads as neither together nor ended."),
], undefined, THORNBURY);

/** Tom out of ch1: the lines are another man's, and his ch1 facts that man's. */
const TOM_TO = (full: string): Array<readonly [string, string]> => [["Constable Tom Hale", full], ["Tom Hale", full], ["Tom", full.split(" ").slice(-2)[0]!]];
const NELL_TO = (full: string): Array<readonly [string, string]> => [["Nell Ashby", full], ["Nell", full.split(" ")[0]!]];

/**
 * `structure/central-relationship` (the leads should share 40% of the chapters):
 * the clean leads share ch1 and ch4 of four; a mutant takes one lead out of ch1.
 * A book-level finding.
 */
export const centralRelationshipMutator: Mutator = mutator("structure/central-relationship", "The leads share too few chapters for a romance.", (clean) => {
  const out = (description: string, pairs: Array<readonly [string, string]>, extra: Partial<MutantSpec> = {}): MutantSpec =>
    ({ chapter: 1, description, scope: "book", ...rename(clean, [1], pairs), match: [CENTRAL], ...extra });
  return [
    out("Another constable, Will Pryce, has Tom's part in ch1.", TOM_TO("Constable Will Pryce")),
    out("The doctor, Ellis Marsh, walks Nell home in ch1 instead of Tom.", TOM_TO("Doctor Ellis Marsh")),
    out("Peter Venn walks Nell home in ch1 instead of Tom.", TOM_TO("young Peter Venn")),
    out("Jack Dunn, the housekeeper's son, has Tom's part in ch1.", TOM_TO("Jack Dunn")),
    out("Constable Bob Kerr has Tom's part in ch1.", TOM_TO("Constable Bob Kerr")),
    out("Kitty Byrne, not Nell, keeps the bookshop and is asked to the dance in ch1.", NELL_TO("Kitty Byrne"), { changeScenes: [{ target: "ch1.s1", set: { pov: "Kitty Byrne" } }] }),
    out("Rose Abbott has Nell's part in ch1.", NELL_TO("Rose Abbott"), { changeScenes: [{ target: "ch1.s1", set: { pov: "Rose Abbott" } }] }),
    out("Mary Quayle has Nell's part in ch1 (the annotator keeps Nell as ch1's POV).", NELL_TO("Mary Quayle")),
    {
      chapter: 1, description: "Tom is an unnamed constable in ch1, and his ch1 facts are not recorded.", scope: "book",
      edits: [transform(clean, 1, (text) => replaceAll(text, [["Constable Tom Hale", "The constable"], ["Tom whistled", "He whistled"]]))],
      change: [remove(clean, "Tom Hale", "occupation", 1), remove(clean, "Tom Hale", "in love with", 1)],
      match: [CENTRAL],
    },
    out("Expected miss: Tom's part in ch1 goes to Will Pryce, but Tom is named in passing ('Tom Hale's bicycle'), which counts as on the page.", TOM_TO("Constable Will Pryce"), {
      edits: [transform(clean, 1, (text) => replaceAll(text, TOM_TO("Constable Will Pryce")).replace("\"Venn's shouting again,\" he said.", "Tom Hale's bicycle was against the railings. \"Venn's shouting again,\" Pryce said."))],
    }),
  ];
}, undefined, THORNBURY);

const CH2_OPEN = "Tom Hale had seen dead men before, in France, but never one in a room that smelled of beeswax and clocks.";
/** `structure/both-leads-pov`: Tom's one POV scene (ch2) is given to someone else, so only Nell has a point of view. */
export const bothLeadsPovMutator: Mutator = mutator("structure/both-leads-pov", "One of the romance's leads never has the point of view.", () => {
  const pov = (to: string | null, opening: string, description: string): MutantSpec => ({
    chapter: 2, description, scope: "book",
    edits: [rewrite(2, CH2_OPEN, opening)],
    changeScenes: [{ target: "ch2.s1", set: { pov: to } }],
    match: [TOM, POVS],
  });
  return [
    pov("Mrs Dunn", "Mrs Dunn watched the constable look at her master. She had never seen a dead man before, and she could not stop looking either.", "Ch2 is told from Mrs Dunn's point of view."),
    pov(null, "The constable had seen dead men before, people said, in France.", "Ch2 is told from outside anyone's head; the annotator leaves its POV empty."),
    pov("Doctor Marsh", "Doctor Marsh had seen a hundred dead men, and he knew poison when he smelled it.", "Ch2 is the doctor's point of view."),
    pov("Nell Ashby", "Nell heard all of it afterwards from Mrs Dunn, and pictured it so often that she might as well have been there.", "Ch2 is retold through Nell, so she has every POV scene."),
    pov("Peter Venn", "Peter Venn, who had come back from Hexham for his hat, stood in the doorway and watched the constable work.", "Ch2 is the nephew's point of view."),
    pov("the narrator", "It was the sort of room, the village said later, that smelled of beeswax and clocks.", "Ch2 is told by an omniscient narrator."),
    pov("Margaret Lyle", "Margaret Lyle, passing the shop window on her way to the butcher's, saw the constable kneel by the grate and felt her heart stop.", "Ch2 is told from the culprit's point of view."),
    pov("the sergeant from Hexham", "The sergeant from Hexham, who came over at ten, thought the village constable had done well enough.", "Ch2 is given to the Hexham sergeant."),
    pov("Mrs Dunn", "To Mrs Dunn it seemed that the constable had seen dead men before; he did not so much as blink.", "Ch2 is Mrs Dunn's, the annotator noting her name."),
    pov("the village", "All Thornbury agreed afterwards that the room had smelled of beeswax and clocks.", "Ch2 is told in the village's collective voice."),
  ];
}, undefined, THORNBURY);

// ---- invented-term spelling (wenlow) -------------------------------------

/** `style/invented-term-spelling`: one use of a name the book uses often, spelt another way (mid-sentence). */
export const inventedTermSpellingMutator: Mutator = mutator("style/invented-term-spelling", "A name or invented term is misspelt once.", () => {
  const typo = (chapter: number, find: string, replace: string, name: string[], description: string): MutantSpec =>
    ({ chapter, description, edits: [rewrite(chapter, find, replace)], match: [name, SPELL] });
  return [
    typo(2, "The road to Stavely was a full day's walk", "The road to Stavley was a full day's walk", ["Stavely", "Stavley"], "'Stavley' for Stavely (two letters swapped)."),
    typo(4, "and Thorne walked a little behind them", "and Throne walked a little behind them", THORNE, "'Throne' for Thorne."),
    typo(3, "I ferried the Margery's crew the night she sailed", "I ferried the Margary's crew the night she sailed", ["Margery", "Margary"], "'Margary' for the barge Margery."),
    typo(5, "the river went past Wenlow as it always had", "the river went past Wenlowe as it always had", ["Wenlow"], "'Wenlowe' for Wenlow (a letter added)."),
    typo(1, "She wants a word with you, Elspeth.\"", "She wants a word with you, Elsbeth.\"", ELSPETH, "'Elsbeth' for Elspeth."),
    typo(4, "\"Now what?\" said Jonas.", "\"Now what?\" said Jonah.", JONAS, "'Jonah' for Jonas."),
    typo(2, "You look like you walked from Wenlow.\"", "You look like you walked from Wen-low.\"", ["Wenlow", "Wen-low"], "'Wen-low' for Wenlow (a hyphen added)."),
    typo(5, "At the landing the ferry was tied up where Crane had left it.", "At the landing the ferry was tied up where Cranne had left it.", CRANE, "'Cranne' for Crane (a letter doubled)."),
    typo(5, "\"I will speak for you,\" said Thorne.", "\"I will speak for you,\" said Thorn.", THORNE, "'Thorn' for Thorne (a letter dropped)."),
    typo(2, "\"Marrow,\" Rook said, when she gave him the name.", "\"Marrow,\" Rooke said, when she gave him the name.", ROOK, "Expected miss: 'Rooke' for Rook; names under five letters are too short to judge."),
    typo(1, "Thorne watched him go.", "Throne watched him go.", THORNE, "Expected miss: 'Throne' only at the start of a sentence, where any word is capitalised."),
  ];
});

export const genreMutators: ReadonlyArray<Mutator> = [fairPlayMutator, hopefulEndingMutator, centralRelationshipMutator, bothLeadsPovMutator, inventedTermSpellingMutator];

