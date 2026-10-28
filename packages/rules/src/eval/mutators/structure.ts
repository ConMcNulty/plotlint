import type { HookRecord } from "@actalk/inkos-core";
import { fact, hook, insertAfter as ins, mutator, rewrite, type CleanBook, type HookChange, type Mutator } from "../mutant.js";
import type { BookPlan } from "../../book.js";
import { CRANE, ELSPETH, JONAS, ROOK, THORNE, TOBIAS } from "./words.js";

// Mutators for the L4 structural rules over the hook ledger, facts and chapter
// text (rules/structure/). Wenlow's oracle `hooks.json` holds the story's real
// setups and payoffs, and its `book.json` marks it finished, so a mutant changes
// the ledger (a payoff dropped, a hook resolved where it is raised) or plants a
// setup the rest of the book never returns to, with a sentence in the prose to
// match. Hook-only mutants change the prose where the ledger change happens,
// which can be after the chapter the finding belongs to (a dropped payoff is
// reported at its setup).

const SETUP = ["setup", "set up", "payoff", "pay off", "paid off", "never", "unresolved", "dropped", "forgotten", "loose end", "thread", "promise", "returns", "chekhov"];
const EARNED = ["unearned", "too quickly", "too easily", "same chapter", "immediately", "abrupt", "convenient", "rushed", "no build", "deus ex"];
const CUT = ["cut", "unnecessary", "irrelevant", "digression", "tangent", "padding", "nothing to do", "does not advance", "doesn't advance", "self-contained", "no bearing"];
const QUESTIONS = ["question", "mystery", "suspense", "tension", "curiosity", "too many", "overwhelm", "confusing", "answered", "resolved too early", "nothing left"];
const SUBPLOT = ["subplot", "thread", "dropped", "vanish", "forgotten", "abandoned", "never returns", "disappears", "storyline"];

/** The book at chapter 5 of a planned twelve: setups that are not overdue are not flagged yet. */
const UNFINISHED: { plan: BookPlan } = { plan: { targetChapters: 12, status: "active" } };

const resolveAt = (target: string, chapter: number, extra: Partial<HookRecord> = {}): HookChange =>
  ({ target, set: { status: "resolved", lastAdvancedChapter: chapter, ...extra } });
const reopen = (target: string, last: number, status: HookRecord["status"] = "open", extra: Partial<HookRecord> = {}): HookChange =>
  ({ target, set: { status, lastAdvancedChapter: last, ...extra } });
const drop = (target: string): HookChange => ({ target, set: null });
const PASK_FACTS = [
  { target: { subject: "Ida Thorne", predicate: "learned", object: "Alderman Pask is one of the men who sank the Margery", validFromChapter: 5 }, set: null },
  { target: { subject: "Alderman Pask", predicate: "secret", object: "one of the men who sank the Margery", validFromChapter: 5 }, set: null },
] as const;

/**
 * `structure/unpaid-setup`: in a finished book, a hook still open whose last
 * advance is before the final chapter, or an emphasised object (named in two
 * facts, or the subject of one) that no later fact or chapter names again. The
 * finding is at the setup's chapter.
 */
export const unpaidSetupMutator: Mutator = mutator("structure/unpaid-setup", "A setup is never paid off: a hook's payoff is dropped, or an object or question is planted and never returns.", () => [
  {
    chapter: 4, description: "Tobias's letter is never read: ch5 no longer says what it told, and father-letter stays open from ch4.",
    edits: [rewrite(5, "She had read her father's letter too. They told the same story in two different hands.", "Her father's letter she had put away unopened; she could not yet bring herself to read it.")],
    changeHooks: [reopen("father-letter", 4)],
    match: [ELSPETH, ["letter"], SETUP],
  },
  {
    chapter: 1, description: "Jonas's 'east of true' line on Gorse Hill is cut, so the compass's oddity planted in ch1 is never paid off.",
    edits: [rewrite(4, "\"East of true,\" Jonas said, tapping the compass, when she caught up with him. \"Father always said so. If you know how wrong a thing is, you can still steer by it.\"", "Jonas was waiting for her by a fallen wall.")],
    changeHooks: [reopen("compass-east-of-true", 1, "progressing")],
    match: [["compass"], SETUP],
  },
  {
    chapter: 1, description: "Crane never admits writing the letter (ch3 rewritten); letter-writer stays open from ch1, last advanced in ch2.",
    edits: [rewrite(3, "\"I did. I signed your father's name because I thought the warden would come for his name and not for mine.\" He coughed for a long time.", "Crane only shook his head and coughed for a long time.")],
    changeHooks: [reopen("letter-writer", 2)],
    match: [["letter"], SETUP],
  },
  {
    chapter: 3, description: "The ledger's names are never given: ch5 drops Pask, and council-conspirator stays open from ch3.",
    edits: [rewrite(5, "\"There are three names in it,\" Elspeth said. \"One of them is Alderman Pask.\"", "\"There are three names in it,\" Elspeth said, and said no more.")],
    change: PASK_FACTS,
    changeHooks: [reopen("council-conspirator", 3)],
    match: [["council", "Pask", "alderman"], SETUP],
  },
  {
    chapter: 3, description: "Jonas never takes the ferry across in ch5; crane-ferry (who rows after Crane) stays open from ch3.",
    edits: [rewrite(5, "He took them across.", "\"Not today,\" he said after a while, and tied the ferry up again, and the three of them walked round by the bridge.")],
    changeHooks: [reopen("crane-ferry", 3)],
    match: [JONAS, ["ferry", "oar"], SETUP],
  },
  {
    chapter: 2, description: "The strongbox hole is empty in ch4; missing-strongbox is due by ch4 (paysOffInArc) and still progressing in ch5.",
    edits: [rewrite(4, "Underneath, in a hole lined with slate, was a strongbox the size of a bread oven, black with damp and bound in iron.", "Underneath was a hole lined with slate and nothing in it but black water; Elspeth knelt and tried the key in a lock that was not there.")],
    changeHooks: [reopen("missing-strongbox", 3, "progressing", { paysOffInArc: "ch4" })],
    match: [["strongbox", "box", "gold", "money"], SETUP],
  },
  {
    chapter: 2, description: "Rook hands Elspeth a brass spyglass from the Margery in ch2 (possession, and the spyglass the subject of its own fact); it never returns.",
    edits: [ins(2, "\"Our father,\" said Jonas.", "Rook went behind the bar and came back with a brass spyglass, green with age. \"It came off the Margery,\" he said, and gave it to Elspeth. \"It should be yours.\"")],
    add: [
      fact("Elspeth Marrow", "holds", "brass spyglass", 2, { kind: "possession", quote: "came back with a brass spyglass, green with age" }),
      fact("brass spyglass", "came from", "the barge Margery", 2, { quote: "\"It came off the Margery,\" he said" }),
    ],
    match: [["spyglass"], SETUP],
  },
  {
    chapter: 1, description: "Thorne gives Elspeth a sealed warrant in ch1 (two facts name it); it is never mentioned again.",
    edits: [ins(1, "\"So I have always been told,\" said Thorne. \"I would like to know who wrote this letter.\"", "She put a second paper into Elspeth's hand, a warrant sealed in red wax. \"Keep this. You will know when to open it.\"")],
    add: [
      fact("Elspeth Marrow", "holds", "sealed warrant", 1, { kind: "possession", quote: "a warrant sealed in red wax" }),
      fact("sealed warrant", "sealed with", "red wax", 1, { quote: "You will know when to open it." }),
    ],
    match: [["warrant"], SETUP],
  },
  {
    chapter: 3, description: "Crane presses a pewter locket on Jonas in ch3 ('carries', and the locket's own fact); it never comes up again.",
    edits: [ins(3, "The key was cold and pitted with rust.", "Then he took a pewter locket from round his own neck and gave it to Jonas. \"For your mother,\" he said. \"She will know what it means.\"")],
    add: [
      fact("Jonas Marrow", "carries", "pewter locket", 3, { kind: "possession", quote: "took a pewter locket from round his own neck and gave it to Jonas" }),
      fact("pewter locket", "meant for", "the Marrows' mother", 3, { quote: "\"For your mother,\" he said." }),
    ],
    match: [["locket"], SETUP],
  },
  {
    chapter: 2, description: "Rook hints he saw something from the bridge the night the Margery sank (a new hook, opened ch2); no chapter returns to it.",
    edits: [ins(2, "\"The Margery. I remember the night.", "I saw something from the bridge that night I have never told a soul, and maybe I never will.")],
    addHooks: [hook("rook-bridge-night", 2, 2, "open", "What Rook saw from the Stavely bridge the night the Margery sank")],
    match: [ROOK, SETUP],
  },
  {
    chapter: 3, description: "GLM-style ledger row: 'hook-11', a question about the nurse raised in ch3 and never advanced.",
    edits: [ins(3, "The nurse came and went.", "Once she bent and whispered something to Crane that made him turn his face to the wall.")],
    addHooks: [hook("hook-11", 3, 3, "open", "What the parish nurse whispered to Crane", { type: "plot" })],
    match: [["nurse"], SETUP],
  },
  {
    chapter: 2, description: "Expected miss: Elspeth buys 'a tin whistle' at the Heron (GLM's indefinite value, read as a kind rather than one object).",
    edits: [ins(2, "Elspeth paid him three shillings for the room and their supper, which left her nine.", "From a pedlar by the fire she bought a tin whistle for Jonas, who blew it once and put it away.")],
    add: [
      fact("Elspeth Marrow", "bought", "a tin whistle", 2, { kind: "possession", quote: "she bought a tin whistle for Jonas" }),
      fact("Jonas Marrow", "holds", "a tin whistle", 2, { kind: "possession", quote: "who blew it once and put it away" }),
    ],
    match: [["whistle"], SETUP],
  },
]);

/**
 * `structure/unearned-payoff`: a hook resolved in the chapter that raises it.
 * The other case (a long gap with no recorded advance) needs chapter summaries
 * that name hooks, which the corpus does not have; those mutants are expected misses.
 */
export const unearnedPayoffMutator: Mutator = mutator("structure/unearned-payoff", "A payoff without a setup: a question raised and answered in the same chapter.", () => [
  {
    chapter: 4, description: "The boot prints are explained the moment they are found (cottage-break-in resolved in ch4).",
    edits: [ins(4, "and in the morning they found boot prints in the mud under the sill.", "They were Rook's; he had walked from Stavely in the night to warn them, and lost his nerve at the window.")],
    changeHooks: [resolveAt("cottage-break-in", 4)],
    match: [["boot", "window", "break-in", "Rook"], EARNED],
  },
  {
    chapter: 1, description: "The late passenger on Crane's ferry is raised and named in the same paragraph of ch1 (new hook).",
    edits: [ins(1, "It was Crane's ferry, crossing late, with one passenger she could not make out.", "Then the lantern swung, and she saw it was only the vicar, going over to the sick.")],
    addHooks: [hook("night-passenger", 1, 1, "resolved", "Who Crane's late passenger was")],
    match: [["passenger", "vicar"], EARNED],
  },
  {
    chapter: 2, description: "Why Rook wipes every coin is asked and answered at once in ch2 (new hook).",
    edits: [ins(2, "The innkeeper was a heavy, careful man named Rook, who wiped every coin before he took it.", "He had been paid once in coins dipped in lamp-black, he told them before they could ask, and had never forgotten it.")],
    addHooks: [hook("rook-coins", 2, 2, "resolved", "Why Rook wipes every coin before he takes it", { type: "character" })],
    match: [ROOK, EARNED],
  },
  {
    chapter: 3, description: "The ledger records Crane's illness only at his bedside, where it ends (crane-illness opened and resolved in ch3).",
    edits: [ins(3, "Absalom Crane lay propped on three pillows, grey in the face, and his breath came short and loud.", "\"Will he last the night?\" Jonas asked, and the nurse shook her head.")],
    changeHooks: [{ target: "crane-illness", set: { startChapter: 3 } }],
    match: [CRANE, EARNED],
  },
  {
    chapter: 4, description: "Elspeth reads her father's letter on the spot in ch4 (father-letter opened and resolved in ch4).",
    edits: [rewrite(4, "She did not read it. She could not, not there.", "She read it there, on her knees in the wet: it said what Crane had said.")],
    changeHooks: [resolveAt("father-letter", 4)],
    match: [TOBIAS, ["letter"], EARNED],
  },
  {
    chapter: 5, description: "Who will speak for Jonas's licence is raised and settled in two lines of ch5 (new hook).",
    edits: [ins(5, "\"I will speak for you,\" said Thorne.", "And that was the licence settled.")],
    addHooks: [hook("jonas-licence", 5, 5, "resolved", "Whether the parish will license Jonas to row the ferry", { type: "character" })],
    match: [JONAS, ["licen"], EARNED],
  },
  {
    chapter: 3, description: "GLM records the compass hook only when Elspeth gives it away, and Jonas explains it at once (compass-east-of-true opened and resolved in ch3).",
    edits: [ins(3, "Jonas closed his hand around the compass.", "\"East of true,\" he said. \"I know. I can steer by it.\"")],
    changeHooks: [{ target: "compass-east-of-true", set: { startChapter: 3, lastAdvancedChapter: 3 } }],
    match: [["compass"], EARNED],
  },
  {
    chapter: 2, description: "GLM-style row 'hook' (an id too bare to trace): why the warden is in Stavely, asked and answered in ch2.",
    edits: [ins(2, "She is staying at the warden's house on Fuller Street.", "\"Why is the warden here at all?\" Jonas asked, and Rook said it was the letter; the whole town knew.")],
    addHooks: [hook("hook", 2, 2, "resolved", "Why the warden has come to Stavely", { type: "plot" })],
    match: [THORNE, EARNED],
  },
  {
    chapter: 5, description: "Expected miss: the strongbox question (opened ch2) is answered in ch5 with nothing in between; spotting the gap needs chapter summaries.",
    edits: [rewrite(4, "Underneath, in a hole lined with slate, was a strongbox the size of a bread oven, black with damp and bound in iron.", "Underneath, in a hole lined with slate, was a bundle of oilcloth.")],
    changeHooks: [resolveAt("missing-strongbox", 5)],
    match: [["strongbox", "box"], EARNED],
  },
  {
    chapter: 5, description: "Expected miss: the break-in (ch4) is explained in ch5, one chapter on, which the rule allows.",
    edits: [ins(5, "The strongbox was already locked in the vestry, with the vicar and two churchwardens sworn to it.", "The boot prints, the vicar said, were from Pask's man, who had been seen on the lane that night.")],
    changeHooks: [resolveAt("cottage-break-in", 5)],
    match: [["boot", "break-in", "Pask"], EARNED],
  },
]);

const scene = (anchor: string, text: string) => `${anchor}\n\n* * *\n\n${text}`;

/**
 * `structure/cut-candidate`: a self-contained scene appended to a chapter (after
 * a `* * *` break), whose facts introduce things no later fact or chapter names.
 * Only chapters 1–3 can be flagged (the last two are protected).
 */
export const cutCandidateMutator: Mutator = mutator("structure/cut-candidate", "A self-contained scene whose facts nothing later uses.", () => [
  {
    chapter: 1, description: "A scene at the forge: the smith's apprentice Davy Quill makes a pike weathervane (ch1.s2); nothing returns to it.",
    edits: [rewrite(1, "with one passenger she could not make out.", scene("with one passenger she could not make out.", "At the forge that night a red-haired apprentice called Davy Quill hammered out a weathervane in the shape of a pike. He sang while he worked, and the sparks went up the chimney like bees."))],
    add: [
      fact("Davy Quill", "occupation", "forge apprentice", 1, { kind: "identity", quote: "a red-haired apprentice called Davy Quill" }),
      fact("Davy Quill", "made", "pike weathervane", 1, { quote: "hammered out a weathervane in the shape of a pike" }),
    ],
    match: [["Quill", "weathervane", "forge"], CUT],
  },
  {
    chapter: 2, description: "A scene in the Heron's kitchen: the cook Hester Bly bakes a damson tart for a wedding (ch2.s2).",
    edits: [rewrite(2, "full of things it would not give back.", scene("full of things it would not give back.", "Down in the kitchen the cook, Hester Bly, was up before anyone, baking a damson tart for her niece's wedding at Kirkby. She burned the first and swore, and the second came out perfect."))],
    add: [
      fact("Hester Bly", "occupation", "cook at the Heron", 2, { kind: "identity", quote: "the cook, Hester Bly, was up before anyone" }),
      fact("Hester Bly", "baked", "damson tart", 2, { quote: "baking a damson tart for her niece's wedding at Kirkby" }),
    ],
    match: [["Hester", "tart", "kitchen", "cook"], CUT],
  },
  {
    chapter: 3, description: "A scene at the Wenlow alehouse: two drovers argue over a lame heifer (ch3.s2).",
    edits: [rewrite(3, "Before anyone on the parish council hears that Crane is dead.\"", scene("Before anyone on the parish council hears that Crane is dead.\"", "At the Plough that night two drovers argued over a lame heifer until the landlord, Amos Tull, put them both out into the rain. Neither of them had heard of Absalom Crane."))],
    add: [
      fact("Amos Tull", "occupation", "landlord of the Plough", 3, { kind: "identity", quote: "the landlord, Amos Tull, put them both out into the rain" }),
      fact("Amos Tull", "location", "the Plough alehouse, Wenlow", 3, { kind: "location", until: 3, quote: "At the Plough that night two drovers argued over a lame heifer" }),
    ],
    match: [["Tull", "Plough", "heifer", "drover"], CUT],
  },
  {
    chapter: 2, description: "A scene on the Stavely bridge: a fiddler, Nat Ormerod, busks for pennies (ch2.s2).",
    edits: [rewrite(2, "full of things it would not give back.", scene("full of things it would not give back.", "On the bridge outside, a blind fiddler called Nat Ormerod played reels for the carters until midnight, and went home with a hat full of buttons."))],
    add: [fact("Nat Ormerod", "location", "Stavely bridge", 2, { kind: "location", quote: "a blind fiddler called Nat Ormerod played reels for the carters" })],
    match: [["Ormerod", "fiddler"], CUT],
  },
  {
    chapter: 1, description: "A scene at the mill: the miller's widow, Martha Gell, counts sacks and finds one short (ch1.s2).",
    edits: [rewrite(1, "with one passenger she could not make out.", scene("with one passenger she could not make out.", "At the mill the miller's widow, Martha Gell, counted the sacks by candlelight and found one short. She counted again and found it, behind the hoist, where it always was."))],
    add: [
      fact("Martha Gell", "role", "miller's widow", 1, { kind: "identity", quote: "the miller's widow, Martha Gell, counted the sacks by candlelight" }),
      fact("Martha Gell", "found", "missing flour sack", 1, { quote: "She counted again and found it, behind the hoist" }),
    ],
    match: [["Gell", "sack"], CUT],
  },
  {
    chapter: 3, description: "GLM-style free-form facts for an appended scene: the sexton, Eli Danby, 'is busy with' a new bell rope (ch3.s2).",
    edits: [rewrite(3, "Before anyone on the parish council hears that Crane is dead.\"", scene("Before anyone on the parish council hears that Crane is dead.\"", "In the church tower the sexton, Eli Danby, spliced a new bell rope and tested it with three slow pulls that nobody in the village heard."))],
    add: [fact("Eli Danby", "is busy with", "splicing a new bell rope", 3, { quote: "the sexton, Eli Danby, spliced a new bell rope" })],
    match: [["Danby", "sexton", "bell"], CUT],
  },
  {
    chapter: 2, description: "A scene of Thorne alone at the warden's house, writing a report on river tolls (ch2.s2).",
    edits: [rewrite(2, "full of things it would not give back.", scene("full of things it would not give back.", "Across the street Captain Thorne sat up late at the warden's house writing her quarterly report on the Kirkby river tolls, which were down by a fifth."))],
    add: [fact("Ida Thorne", "wrote", "quarterly report on the Kirkby river tolls", 2, { quote: "writing her quarterly report on the Kirkby river tolls" })],
    match: [THORNE, ["report", "tolls"], CUT],
  },
  {
    chapter: 1, description: "A scene of the drovers going on to market with forty ewes (ch1.s2), recorded with a generic value ('some ewes').",
    edits: [rewrite(1, "with one passenger she could not make out.", scene("with one passenger she could not make out.", "The two drovers from the ferry slept that night in Hebden's barn, and at first light drove forty ewes on towards Kirkby market."))],
    add: [fact("the drovers", "drove", "forty ewes to Kirkby market", 1, { quote: "drove forty ewes on towards Kirkby market" })],
    match: [["drover", "ewes"], CUT],
  },
  {
    chapter: 2, description: "Expected miss: the appended scene's object, a lantern, happens to be named again in ch4, so it reads as depended on.",
    edits: [rewrite(2, "full of things it would not give back.", scene("full of things it would not give back.", "In the yard the ostler, Ned Barrow, trimmed the wick of a lantern and hung it on the stable door for the late coach."))],
    add: [
      fact("Ned Barrow", "occupation", "ostler at the Heron", 2, { kind: "identity", quote: "the ostler, Ned Barrow, trimmed the wick of a lantern" }),
      fact("Ned Barrow", "hung", "lantern", 2, { quote: "hung it on the stable door for the late coach" }),
    ],
    match: [["Barrow", "ostler"], CUT],
  },
  {
    chapter: 3, description: "Expected miss: the appended scene's fact has no evidence quote, so it cannot be placed in the scene and counts for the whole chapter.",
    edits: [rewrite(3, "Before anyone on the parish council hears that Crane is dead.\"", scene("Before anyone on the parish council hears that Crane is dead.\"", "Up at the vicarage a curate called Silas Pym practised a sermon on patience to an empty room."))],
    add: [fact("Silas Pym", "occupation", "curate", 3, { kind: "identity" })],
    match: [["Pym", "curate"], CUT],
  },
]);

const allResolvedBy = (clean: CleanBook, last: number): HookChange[] => clean.hooks.map((h) =>
  h.startChapter >= last ? drop(h.hookId) : resolveAt(h.hookId, Math.min(h.lastAdvancedChapter, last)));
const newHooks = (chapter: number, count: number, resolvedIn = 5): HookRecord[] => Array.from({ length: count }, (_, i) =>
  hook(`ch${chapter}-question-${i + 1}`, chapter, resolvedIn, "resolved", `Question ${i + 1} raised in ch${chapter}`));

/**
 * `structure/open-questions`: a run of three chapters with no open question (every
 * hook answered early), or a chapter opening more than six at once.
 */
export const openQuestionsMutator: Mutator = mutator("structure/open-questions", "Too few or too many open questions: every hook answered early, or many opened at once.", (clean) => [
  {
    chapter: 3, description: "Thorne lays the whole affair out in ch2: every hook is answered by ch2, and ch3–5 have no open question.",
    edits: [ins(2, "\"Then help me prove it,\" said Thorne.", "And then, because she was tired of secrets, she told them all of it: who wrote the letter, who sank the Margery and why, and where the gold was.")],
    changeHooks: allResolvedBy(clean, 3),
    match: [QUESTIONS],
  },
  {
    chapter: 3, description: "Crane's deathbed answers everything in ch3 and the ledger records no new question after it (ch3–5 flat).",
    edits: [ins(3, "\"It is in the ledger. Names, dates, the price.", "And the gold is under the abbey floor, and the man on the council sits two pews behind the vicar, and that is the whole of it.")],
    changeHooks: allResolvedBy(clean, 3),
    match: [QUESTIONS],
  },
  {
    chapter: 2, description: "Every question raised in ch1 is answered by ch2, and the next is not raised until ch5 (ch2–4 flat).",
    edits: [ins(2, "\"Then help me prove it,\" said Thorne.", "\"Though there is nothing left to prove,\" she added. \"I know the whole story now.\"")],
    changeHooks: clean.hooks.map((h) => (h.startChapter >= 2 ? drop(h.hookId) : resolveAt(h.hookId, 2))),
    addHooks: [hook("ferry-future", 5, 5, "progressing", "Whether Jonas can keep the ferry going")],
    match: [QUESTIONS],
  },
  {
    chapter: 1, description: "The ledger opens nothing until ch4: the questions of ch1–3 are not recorded as open (ch1–3 flat).",
    edits: [ins(1, "\"Then I will read it for you.\"", "But Elspeth found she did not much care what the ledger said.")],
    changeHooks: clean.hooks.filter((h) => h.startChapter < 4).map((h) => drop(h.hookId)),
    match: [QUESTIONS],
  },
  {
    chapter: 1, description: "Ch1 raises eight questions at once (four new hooks on top of the four it opens).",
    edits: [ins(1, "\"So I have always been told,\" said Thorne. \"I would like to know who wrote this letter.\"", "\"And who paid the crew, and who has the gold, and why the pilot's body was never found, and what your father kept in his sea chest.\"")],
    addHooks: newHooks(1, 4),
    match: [QUESTIONS],
  },
  {
    chapter: 2, description: "Ch2 raises seven questions at once (five new hooks besides the strongbox and Crane's illness).",
    edits: [ins(2, "\"I think somebody did.", "Who signed for the cargo, who held the bank's receipt, who paid the boy, who drew up the shipping list, and who has been writing to me since?")],
    addHooks: newHooks(2, 5),
    match: [QUESTIONS],
  },
  {
    chapter: 3, description: "Ch3 raises seven questions at once (five new hooks besides the council man and the ferry).",
    edits: [ins(3, "\"Who?\"", "Who else was on the bank, who held the lantern, who carried the gold, who paid, and who has kept quiet since?")],
    addHooks: newHooks(3, 5),
    match: [QUESTIONS],
  },
  {
    chapter: 4, description: "Ch4 raises seven questions at once (five new hooks besides the letter and the break-in), one left as an open ending.",
    edits: [ins(4, "\"You followed us,\" Elspeth said.", "How had she known the way, who had told her, why alone, why now, and what did she want with the box?")],
    addHooks: [...newHooks(4, 4), hook("ch4-question-5", 4, 5, "progressing", "What Thorne wants with the box")],
    match: [THORNE, QUESTIONS],
  },
  {
    chapter: 1, description: "Seven of the book's hooks are recorded as opened in ch1 (the settler backdates them to the letter).",
    edits: [ins(1, "Elspeth stared at the paper.", "Everything that followed began with this paper, though she could not know it yet.")],
    changeHooks: ["missing-strongbox", "crane-illness", "council-conspirator"].map((id) => ({ target: id, set: { startChapter: 1 } })),
    match: [QUESTIONS],
  },
  {
    chapter: 3, description: "Expected miss: everything is answered in ch3, but the settler leaves the hooks 'progressing', so the ledger still reads them as open.",
    edits: [ins(3, "\"It is in the ledger. Names, dates, the price.", "And the gold is under the abbey floor, and the man on the council sits two pews behind the vicar, and that is the whole of it.")],
    changeHooks: clean.hooks.filter((h) => h.startChapter < 3).map((h) => reopen(h.hookId, 3, "progressing")),
    // Unfinished, so the hooks left open are not also unpaid setups.
    book: UNFINISHED,
    match: [QUESTIONS],
  },
]);

/**
 * `structure/subplot-balance` (the corpus's rules.json sets `gap` 2 for a
 * five-chapter book): a subplot of two or more hooks, one unresolved, that goes
 * quiet three chapters before the end. Most mutants mark the book unfinished
 * (chapter 5 of 12), where an open hook is no unpaid setup yet, so the finding
 * is the subplot rule's alone.
 */
export const subplotBalanceMutator: Mutator = mutator("structure/subplot-balance", "A subplot drops out mid-book with questions unresolved.", () => [
  {
    chapter: 2, description: "A Rook subplot (what he saw from the bridge, what he owes Tobias) is opened in ch2 and never comes back (book at ch5 of 12).",
    edits: [ins(2, "\"The Margery. I remember the night.", "I owed your father money, and I saw something from the bridge that night. Come back when you can and I will tell you both.")],
    addHooks: [
      hook("rook-bridge-night", 2, 2, "open", "What Rook saw from the Stavely bridge the night the Margery sank"),
      hook("rook-debt", 2, 2, "open", "What Rook owes Tobias Marrow", { type: "character" }),
    ],
    book: UNFINISHED,
    match: [ROOK, SUBPLOT],
  },
  {
    chapter: 3, description: "A thread about the parish nurse (two linked hooks, ch3) is dropped after ch3 (book at ch5 of 12).",
    edits: [ins(3, "The nurse came and went.", "She had nursed the Margery's pilot's wife too, she said once, and had a letter of hers still, and then she went out and did not say more.")],
    addHooks: [
      hook("nurse-letter", 3, 3, "open", "What the nurse's letter from the pilot's wife says"),
      hook("nurse-past", 3, 3, "open", "How the nurse knew the Marrows' mother", { type: "backstory", dependsOn: ["nurse-letter"] }),
    ],
    book: UNFINISHED,
    match: [["nurse"], SUBPLOT],
  },
  {
    chapter: 2, description: "The post-office boy thread (who paid him, where he went; linked hooks) opens in ch2 and vanishes (book at ch5 of 12).",
    edits: [ins(2, "He does not know who paid him, only that it was an old man with a bad cough who smelled of river water.", "And the boy himself has not been seen since.")],
    addHooks: [
      hook("post-boy-gone", 2, 2, "open", "Where the boy who carried the letter has gone"),
      hook("post-boy-penny", 2, 2, "open", "Who gave the boy his penny", { dependsOn: ["post-boy-gone"] }),
    ],
    book: UNFINISHED,
    match: [["boy"], SUBPLOT],
  },
  {
    chapter: 1, description: "Thorne's own drowned father, two linked hooks raised in ch1, is never touched again (book at ch5 of 12).",
    edits: [ins(1, "Thorne watched him go.", "Her own father had gone into this river too, she had once told the magistrate, and nobody had ever said how.")],
    addHooks: [
      hook("thorne-father", 1, 1, "open", "How Captain Thorne's father drowned", { type: "backstory" }),
      hook("thorne-magistrate", 1, 1, "open", "What Thorne told the magistrate", { dependsOn: ["thorne-father"] }),
    ],
    book: UNFINISHED,
    match: [THORNE, ["father"], SUBPLOT],
  },
  {
    chapter: 2, description: "Tobias's debts and his second family (hooks naming Tobias Marrow) surface in ch1–2 and are dropped (book at ch5 of 12).",
    edits: [ins(2, "\"Our father,\" said Jonas.", "\"He left debts in this town,\" Rook said, \"and a woman in Saltmere who says she was his wife.\"")],
    addHooks: [
      hook("tobias-debts", 2, 2, "open", "What debts Tobias Marrow left in Stavely", { type: "backstory" }),
      hook("tobias-saltmere-wife", 2, 2, "open", "Who the Saltmere woman claiming to be Tobias Marrow's wife is", { type: "backstory", dependsOn: ["tobias-debts"] }),
    ],
    book: UNFINISHED,
    match: [TOBIAS, SUBPLOT],
  },
  {
    chapter: 3, description: "The council thread is dropped: the ledger's names are never read out, and council-conspirator is left open after ch3 (finished book; unpaid-setup sees it too).",
    edits: [rewrite(5, "\"There are three names in it,\" Elspeth said. \"One of them is Alderman Pask.\"", "\"There are three names in it,\" Elspeth said, and said no more.")],
    change: PASK_FACTS,
    changeHooks: [reopen("council-conspirator", 3), resolveAt("margery-sinking", 3), resolveAt("crane-ledger", 3)],
    match: [["council", "Pask", "alderman"], SUBPLOT],
  },
  {
    chapter: 1, description: "The drovers' thread (two linked hooks, ch1): why they crossed with the warden is never answered (book at ch5 of 12).",
    edits: [ins(1, "Two were drovers in wet coats.", "They kept their eyes on the warden the whole way over, and one of them had a pistol under his coat.")],
    addHooks: [
      hook("drovers-pistol", 1, 1, "open", "Why one of the drovers carries a pistol"),
      hook("drovers-warden", 1, 1, "open", "Why the drovers watch the warden", { dependsOn: ["drovers-pistol"] }),
    ],
    book: UNFINISHED,
    match: [["drover"], SUBPLOT],
  },
  {
    chapter: 2, description: "A Saltmere smuggling thread (linked hooks, ch2) is raised by Thorne and dropped (book at ch5 of 12).",
    edits: [ins(2, "\"I think somebody did.", "There are men at Saltmere who would buy gold and ask nothing, and I have had my eye on them for years.")],
    addHooks: [
      hook("saltmere-buyers", 2, 2, "open", "Who the Saltmere buyers of gold are"),
      hook("saltmere-watch", 2, 2, "progressing", "What Thorne has seen at Saltmere", { dependsOn: ["saltmere-buyers"] }),
    ],
    book: UNFINISHED,
    match: [["Saltmere", "smuggl"], SUBPLOT],
  },
  {
    chapter: 2, description: "Expected miss: GLM-style rows 'hook-12' and 'hook-13' name no character and are not linked, so they form no subplot.",
    edits: [ins(2, "\"I think somebody did.", "There are men at Saltmere who would buy gold and ask nothing, and I have had my eye on them for years.")],
    addHooks: [
      hook("hook-12", 2, 2, "open", "Who the buyers of gold on the coast are"),
      hook("hook-13", 2, 2, "open", "What the warden has seen on the coast"),
    ],
    book: UNFINISHED,
    match: [["Saltmere", "coast"], SUBPLOT],
  },
  {
    chapter: 1, description: "Expected miss: a Thorne thread (two hooks naming her) is dropped after ch1, but Thorne herself is on the page in every chapter, so it reads as alive.",
    edits: [ins(1, "Thorne watched him go.", "She had a brother on the Stavely bench, Elspeth would learn, and a debt to him she meant to pay.")],
    addHooks: [
      hook("thorne-brother", 1, 1, "open", "Who Ida Thorne's brother on the Stavely bench is", { type: "backstory" }),
      hook("thorne-debt", 1, 1, "open", "What Ida Thorne owes her brother", { type: "backstory" }),
    ],
    book: UNFINISHED,
    match: [THORNE, SUBPLOT],
  },
]);

export const structureMutators: ReadonlyArray<Mutator> = [unpaidSetupMutator, unearnedPayoffMutator, cutCandidateMutator, openQuestionsMutator, subplotBalanceMutator];

