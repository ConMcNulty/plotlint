import { insertAfter as ins, mutator, rewrite, type CleanBook, type MutantSpec, type Mutator, type SceneChange } from "../mutant.js";
import type { SceneAnnotationInput } from "../../scene-annotations.js";
import { CRANE, ELSPETH, JONAS, ROOK, THORNE } from "./words.js";

// Mutators for the L4 rules over scene annotations (`story/plotlint/scenes.json`):
// scene-turn, goal-conflict-outcome, protagonist-agency, tension-curve and
// pov-discipline. Wenlow's oracle annotations are the author's (one scene per
// chapter; Elspeth's POV; the stakes rising to the abbey); a mutant changes the
// annotation as an annotator reading the mutated prose would, and the prose with
// a sentence to match. The corpus's rules.json sizes tension-curve and
// goal-conflict-outcome for a five-chapter book.

const TURN = ["turn", "change", "static", "flat", "nothing happens", "no progress", "stall", "marking time", "same place"];
const GOAL = ["goal", "aim", "purpose", "want", "conflict", "opposition", "obstacle", "aimless", "drift", "stakes"];
const AGENCY = ["passive", "agency", "reactive", "passenger", "decides", "choice", "acts", "things happen to"];
const TENSION = ["tension", "stakes", "climax", "peak", "pacing", "flat", "anticlimax", "build"];
const POV = ["point of view", "pov", "viewpoint", "head-hop", "head hop", "perspective", "omniscient", "could not know", "cannot know", "inside"];

/** The scene annotation of a chapter (wenlow has one scene a chapter). */
const s = (chapter: number) => `ch${chapter}.s1`;
const set = (chapter: number, fields: Partial<SceneAnnotationInput>): SceneChange => ({ target: s(chapter), set: fields });
const sceneOf = (clean: CleanBook, chapter: number) => clean.book.scenes!.scenes.find((scene) => scene.chapter === chapter)!;
/** End the scene where it began: the end value set back to the start value. */
const flat = (clean: CleanBook, chapter: number): SceneChange => set(chapter, { valueEnd: sceneOf(clean, chapter).valueStart, outcome: "none" });

// A sentence per chapter saying that the day changed nothing, for flattened scenes.
const STALL: Record<number, [string, string]> = {
  1: ["Thorne watched him go.", "Elspeth went home no wiser than she had come down, and no worse off."],
  2: ["Elspeth lay awake a long time in the room above the bar.", "Nothing they had heard that night told her anything she had not known in Wenlow."],
  3: ["They sat with him through the evening.", "He said nothing more that was new to her, then or later."],
  4: ["Elspeth carried the strongbox down the hill herself, though it bruised her arms.", "It changed nothing, she thought; the gold proved only that gold existed."],
  5: ["After the service she walked down to the ferry landing with Captain Thorne.", "Her father's name was no cleaner than it had been at the start of the week."],
};
const stall = (chapter: number) => ins(chapter, ...STALL[chapter]!);

/** `structure/scene-turn`: three or more scenes in a row that end where they began. */
export const sceneTurnMutator: Mutator = mutator("structure/scene-turn", "A run of three or more scenes that end with their value where it began.", (clean) => {
  const run = (chapters: number[], description: string, extra: Partial<MutantSpec> = {}): MutantSpec => ({
    chapter: chapters[0]!, description,
    edits: chapters.map(stall),
    changeScenes: chapters.map((chapter) => flat(clean, chapter)),
    match: [TURN], ...extra,
  });
  return [
    run([1, 2, 3], "Ch1–3 end where they began: nothing Elspeth learns moves her nearer the truth."),
    run([2, 3, 4], "Ch2–4 end where they began."),
    run([3, 4, 5], "Ch3–5 end where they began: the gold and the ledger change nothing."),
    run([1, 2, 3, 4], "Ch1–4 end where they began."),
    run([1, 2, 3, 4, 5], "No scene in the book turns."),
    {
      chapter: 2, description: "Ch2–4 flat, the annotator writing the axis with different case and spacing ('Truth', 'truth ').",
      edits: [stall(2), stall(3), stall(4)],
      changeScenes: [
        set(2, { valueStart: { axis: "Truth", value: 0 }, valueEnd: { axis: "truth ", value: 0 }, outcome: "none" }),
        set(3, { valueStart: { axis: "truth", value: 0 }, valueEnd: { axis: "Truth", value: 0 }, outcome: "none" }),
        set(4, { valueStart: { axis: "TRUTH", value: 1 }, valueEnd: { axis: "truth", value: 1 }, outcome: "none" }),
      ],
      match: [TURN],
    },
    {
      chapter: 1, description: "Ch1–3 flat, each scene on an axis of its own (safety, trust, hope) but ending where it began.",
      edits: [stall(1), stall(2), stall(3)],
      changeScenes: [
        set(1, { valueStart: { axis: "safety", value: 0 }, valueEnd: { axis: "safety", value: 0 } }),
        set(2, { valueStart: { axis: "trust", value: -1 }, valueEnd: { axis: "trust", value: -1 } }),
        set(3, { valueStart: { axis: "hope", value: 1 }, valueEnd: { axis: "hope", value: 1 } }),
      ],
      match: [TURN],
    },
    run([3, 4, 5], "Ch3–5 flat, the annotator still calling each outcome a success.", {
      changeScenes: [3, 4, 5].map((chapter) => set(chapter, { valueEnd: sceneOf(clean, chapter).valueStart, outcome: "success" })),
    }),
    {
      chapter: 1, description: "Expected miss: ch1–3 flat, but the annotator names the end on another axis ('truth' to 'trust'), so the scenes read as turning.",
      edits: [stall(1), stall(2), stall(3)],
      changeScenes: [1, 2, 3].map((chapter) => set(chapter, { valueStart: { axis: "truth", value: 0 }, valueEnd: { axis: "trust", value: 0 } })),
      match: [TURN],
    },
    {
      chapter: 1, description: "Expected miss: ch1–4 flat, but the annotator leaves ch3's end value blank, which breaks the run into two short ones.",
      edits: [stall(1), stall(2), stall(3), stall(4)],
      changeScenes: [flat(clean, 1), flat(clean, 2), set(3, { valueEnd: null }), flat(clean, 4)],
      match: [TURN],
    },
  ];
});

const AIMLESS: Record<number, [string, string]> = {
  1: ["Elspeth stared at the paper.", "She found she wanted nothing from it, and nobody stood in her way."],
  2: ["Jonas talked most of the morning and said nothing at all in the afternoon.", "Neither of them could have said what they hoped to find in Stavely."],
  3: ["Elspeth sat on the stool by the bed.", "She had not come for anything; she simply came."],
  4: ["Jonas went ahead with the compass.", "They climbed without much purpose, as people walk on a holiday."],
  5: ["After the service she walked down to the ferry landing with Captain Thorne.", "There was nothing left that anyone wanted of anyone."],
};
const aimless = (chapter: number) => ins(chapter, ...AIMLESS[chapter]!);

/**
 * `structure/goal-conflict-outcome` (window 3, at least 2 incomplete scenes, over
 * half of the window's): a stretch where most scenes have no goal or nothing in the way.
 */
export const goalConflictOutcomeMutator: Mutator = mutator("structure/goal-conflict-outcome", "A stretch of scenes with no goal or no opposition.", () => {
  const lack = (parts: Array<[number, "goal" | "opposition"]>, description: string): MutantSpec => ({
    chapter: Math.min(...parts.map(([chapter]) => chapter)), description,
    edits: [...new Set(parts.map(([chapter]) => chapter))].map(aimless),
    changeScenes: parts.map(([chapter, part]) => set(chapter, { [part]: null })),
    match: [GOAL],
  });
  return [
    lack([[1, "goal"], [2, "goal"]], "Ch1–2 have no goal: Elspeth drifts to Stavely with nothing she wants."),
    lack([[2, "opposition"], [3, "opposition"]], "Nothing stands in the way in ch2–3."),
    lack([[3, "goal"], [4, "goal"]], "No goal in ch3–4."),
    lack([[4, "opposition"], [5, "opposition"]], "No opposition in ch4–5: the box and the ledger are handed over unopposed."),
    lack([[1, "goal"], [2, "goal"], [3, "goal"]], "No goal in ch1–3."),
    lack([[2, "goal"], [3, "opposition"]], "No goal in ch2, nothing in the way in ch3."),
    lack([[1, "opposition"], [3, "goal"]], "Ch1 unopposed and ch3 aimless, with ch2 between them."),
    lack([[3, "opposition"], [5, "goal"]], "Ch3 unopposed and ch5 aimless."),
    {
      chapter: 1, description: "Expected miss: ch1–2 have no goal, but the annotator writes 'none' instead of leaving the field empty.",
      edits: [aimless(1), aimless(2)],
      changeScenes: [set(1, { goal: "none" }), set(2, { goal: "none" })],
      match: [GOAL],
    },
    {
      chapter: 2, description: "Expected miss: nothing in the way in ch2–3, which the annotator words as an opposition ('nothing stands in her way').",
      edits: [aimless(2), aimless(3)],
      changeScenes: [set(2, { opposition: "nothing stands in her way" }), set(3, { opposition: "no one, really" })],
      match: [GOAL],
    },
  ];
});

const HANDED: Record<4 | 5, { edit: ReturnType<typeof rewrite>; quote: string }> = {
  4: {
    edit: rewrite(4, "\"We are taking it back to Wenlow ourselves,\" said Elspeth. \"In daylight, where people can see.\"", "\"You will carry it back to Wenlow,\" Thorne said, before Elspeth could speak. \"In daylight, where people can see.\""),
    quote: "\"You will carry it back to Wenlow,\" Thorne said, before Elspeth could speak.",
  },
  5: {
    edit: rewrite(5, "She gave the ledger to Captain Thorne. Thorne held it", "Captain Thorne held out her hand, and Elspeth found she had given the ledger up without deciding to. Thorne held it"),
    quote: "Captain Thorne held out her hand, and Elspeth found she had given the ledger up",
  },
};
const LEDGER_TO_THORNE = { subject: "Ida Thorne", predicate: "holds", object: "ferry ledger", validFromChapter: 5 } as const;
type Turn = { description: string; causedBy: "protagonist" | "other" | "circumstance"; by?: string };
/** Ch4's or ch5's turn taken from Elspeth: the prose rewritten and the turning point re-annotated. */
const handed = (chapter: 4 | 5, turn: Turn): Partial<MutantSpec> => ({
  edits: [HANDED[chapter].edit],
  changeScenes: [set(chapter, { turningPoint: { ...turn, evidence: HANDED[chapter].quote } })],
  ...(chapter === 5 ? { change: [{ target: LEDGER_TO_THORNE, set: { evidence: { quote: HANDED[5].quote } } }] } : {}),
});

/**
 * `structure/protagonist-agency` (at least five turning points; the protagonist
 * should cause 30%): Elspeth causes two of wenlow's five (ch4, ch5); a mutant
 * hands one or both to others or to chance. Book-level findings: any one catches it.
 */
export const protagonistAgencyMutator: Mutator = mutator("structure/protagonist-agency", "The protagonist causes too few of the turning points.", () => {
  const passive = (chapter: number, description: string, spec: Partial<MutantSpec>): MutantSpec =>
    ({ chapter, description, scope: "book", match: [ELSPETH, AGENCY], ...spec });
  const both = (turn4: Turn, turn5: Turn): Partial<MutantSpec> => {
    const a = handed(4, turn4);
    const b = handed(5, turn5);
    return { edits: [...a.edits!, ...b.edits!], changeScenes: [...a.changeScenes!, ...b.changeScenes!], change: b.change! };
  };
  return [
    passive(4, "Thorne, not Elspeth, decides the box goes back to Wenlow in ch4.", handed(4, { description: "Thorne decides they will carry the box back to Wenlow", causedBy: "other", by: "Ida Thorne" })),
    passive(5, "Thorne takes the ledger from Elspeth in ch5.", handed(5, { description: "Thorne takes the ledger", causedBy: "other", by: "Ida Thorne" })),
    passive(4, "Ch4 turns by chance: the lid gives of itself (circumstance).", handed(4, { description: "The strongbox's lid gives way of itself", causedBy: "circumstance" })),
    passive(5, "Ch5 turns on circumstance: the ledger is handed over as a matter of course.", handed(5, { description: "The ledger passes to the warden as a matter of course", causedBy: "circumstance" })),
    passive(4, "Jonas decides to carry the box down in ch4.", handed(4, { description: "Jonas decides they carry the box down", causedBy: "other", by: "Jonas Marrow" })),
    passive(5, "Jonas gives the ledger to Thorne in ch5 ('by: Jonas').", handed(5, { description: "Jonas hands Thorne the ledger", causedBy: "other", by: "Jonas" })),
    passive(4, "Both of Elspeth's turns go to Thorne.", both({ description: "Thorne decides the box's fate", causedBy: "other", by: "Ida Thorne" }, { description: "Thorne takes the ledger", causedBy: "other", by: "Captain Thorne" })),
    passive(5, "The vicar, not Elspeth, takes the ledger to the warden in ch5.", handed(5, { description: "The vicar hands over the ledger", causedBy: "other", by: "the vicar" })),
    passive(5, "Thorne takes the ledger ('by: Captain Thorne', the annotator's spelling).", handed(5, { description: "Thorne takes the ledger", causedBy: "other", by: "Captain Thorne" })),
    passive(4, "Expected miss: Thorne decides ch4, but the annotator records no turning point for ch3, leaving four (fewer than the five the rule needs).", {
      ...handed(4, { description: "Thorne decides the box's fate", causedBy: "other", by: "Ida Thorne" }),
      changeScenes: [...handed(4, { description: "Thorne decides the box's fate", causedBy: "other", by: "Ida Thorne" }).changeScenes!, set(3, { turningPoint: null })],
    }),
  ];
});

/** Stakes per chapter 1..5; the clean book's are 3, 5, 7, 9, 6. */
const stakes = (values: number[]): SceneChange[] => values.map((value, i) => set(i + 1, { stakes: value }));
const DANGER: Record<number, [string, string]> = {
  1: ["\"Then I will read it for you.\"", "Her hand rested on the pistol at her belt, and Elspeth understood that whoever had written the letter might hang for it, and that the warden thought it was her."],
  2: ["\"Then help me prove it,\" said Thorne.", "\"If you cannot, they will hang his name and take your cottage, and the parish will see you both on the road by Christmas.\""],
  3: ["Crane closed his eyes.", "\"They will kill you for this ledger, Elspeth, as they killed him.\""],
};
const danger = (chapter: number) => ins(chapter, ...DANGER[chapter]!);
const SAMENESS: Record<number, [string, string]> = {
  2: ["By the time the roofs of Stavely showed over the hedges, the light was going and both of them were limping.", "It was a day like any other walking day."],
  3: ["The parish nurse let them in.", "Elspeth felt no more and no less than she had on the road."],
  4: ["Jonas went ahead with the compass.", "It felt like any other errand."],
};
const same = (chapter: number) => ins(chapter, ...SAMENESS[chapter]!);

/**
 * `structure/tension-curve` (minChapters 5 and flatRun 3 for this book; band 1;
 * peak by 60%): stakes held level for three chapters, or the peak moved early.
 * Judged findings, at the first flat chapter or the peak.
 */
export const tensionCurveMutator: Mutator = mutator("structure/tension-curve", "Tension stays flat, or peaks early and never returns.", () => [
  { chapter: 1, description: "Stakes level at 5 across ch1–3.", edits: [same(2), same(3)], changeScenes: stakes([5, 5, 5, 9, 6]), match: [TENSION] },
  { chapter: 2, description: "Stakes level at 5–6 across ch2–5: the abbey is no higher than the road.", edits: [same(2), same(3), same(4)], changeScenes: stakes([3, 5, 6, 6, 6]), match: [TENSION] },
  { chapter: 3, description: "Stakes level at 7 across ch3–5.", edits: [same(3), same(4)], changeScenes: stakes([3, 5, 7, 7, 7]), match: [TENSION] },
  { chapter: 1, description: "Stakes level at 5 through the whole book.", edits: [same(2), same(3), same(4)], changeScenes: stakes([5, 5, 5, 5, 5]), match: [TENSION] },
  { chapter: 2, description: "Stakes wobbling within one point (6, 7, 6, 6) across ch2–5.", edits: [same(2), same(3), same(4)], changeScenes: stakes([3, 6, 7, 6, 6]), match: [TENSION] },
  { chapter: 1, description: "The peak comes in ch1: Thorne all but accuses Elspeth, and nothing later matches it.", edits: [danger(1)], changeScenes: stakes([10, 5, 7, 9, 6]), match: [TENSION] },
  { chapter: 2, description: "The peak comes in ch2: the threat of the road by Christmas outweighs everything after.", edits: [danger(2)], changeScenes: stakes([3, 10, 7, 9, 6]), match: [TENSION] },
  { chapter: 2, description: "Peaks in ch1 and ch2 (10 each), lower after.", edits: [danger(1), danger(2)], changeScenes: stakes([10, 10, 7, 9, 6]), match: [TENSION] },
  { chapter: 1, description: "The peak in ch1 at 9, with the abbey lowered to 4.", edits: [danger(1), same(4)], changeScenes: stakes([9, 5, 7, 4, 6]), match: [TENSION] },
  { chapter: 3, description: "Expected miss: the peak is Crane's deathbed in ch3, three-fifths of the way, just at the rule's cut-off.", edits: [danger(3)], changeScenes: stakes([3, 5, 10, 9, 6]), match: [TENSION] },
]);

/** `structure/pov-discipline`: a passage outside the POV character's knowledge, as the annotator reports it. */
export const povDisciplineMutator: Mutator = mutator("structure/pov-discipline", "Narration slips outside Elspeth's point of view.", () => {
  const slip = (chapter: number, anchor: string, sentence: string, note: string, quote = sentence, match: string[][] = [POV]): MutantSpec => ({
    chapter, description: `${note} (ch${chapter}).`,
    edits: [ins(chapter, anchor, sentence)],
    changeScenes: [set(chapter, { povBreaks: [{ quote, note }] })],
    match,
  });
  return [
    slip(1, "Thorne watched him go.", "She was thinking of her own father, who had drowned in this same river, and of how much she hated the smell of it.", "Thorne's private thoughts in Elspeth's scene", undefined, [THORNE, POV]),
    slip(2, "who wiped every coin before he took it.", "Rook privately thought the girl looked too thin to last the winter.", "Rook's unspoken opinion", undefined, [ROOK, POV]),
    slip(3, "The parish nurse let them in.", "She was glad of them, for she was afraid to be alone with a dying man, though she would not have said so.", "The nurse's unspoken fear"),
    slip(4, "Thorne walked a little behind them, watching the path and the mist and the gorse on either side, as if she expected someone to come out of it.", "In truth she was wondering whether she could trust the girl with the gold at all.", "Thorne's doubts, which Elspeth cannot see", undefined, [THORNE, POV]),
    slip(5, "\"Someone has to,\" he said, when Elspeth looked at him.", "Inside he was terrified of the water, and had been since he was six.", "Jonas's hidden fear, told from inside him", undefined, [JONAS, POV]),
    slip(2, "Elspeth thought of Crane at once, and saw from Thorne's face that she had thought of him too.", "At that very moment, in Wenlow, Crane's nurse was burning a letter in the grate.", "Events in Wenlow that Elspeth, in Stavely, cannot perceive"),
    slip(3, "Crane closed his eyes.", "He was remembering the Margery's lantern going under, as he did every night.", "Crane's memory, from inside his head", undefined, [CRANE, POV]),
    slip(4, "The abbey had been a ruin for three hundred years.", "Behind the north wall, unseen, a man in a brown coat watched them begin to dig.", "A watcher Elspeth does not see"),
    slip(5, "and an old man who had not been over the river in twenty years and wanted to see his sister before the winter.", "He was thinking that he would not see another.", "The old passenger's thought"),
    slip(1, "Jonas was sixteen, broad in the shoulders and quick to laugh,", "and secretly ashamed of how much he liked the mill,", "Jonas's secret shame, which the annotator paraphrases", "secretly ashamed of how much he liked the mill", [JONAS, POV]),
  ];
});

export const sceneMutators: ReadonlyArray<Mutator> = [sceneTurnMutator, goalConflictOutcomeMutator, protagonistAgencyMutator, tensionCurveMutator, povDisciplineMutator];

