import { fact, insertAfter as ins, mutator, rewrite, type FactChange, type Mutator } from "../mutant.js";
import { CRANE, DATE, ELSPETH, ITEM, JONAS, PASK, PASSENGERS, ROOK, SECRET, THORNE, TRAVEL } from "./words.js";

// Mutators for the rules added in phase 3 alongside the eval: impossible-travel,
// timeline-order, item-from-nowhere, world-rule-broken, knowledge-leak and author
// invariants. Like every mutator they are keyed by rule id and skipped while no
// rule with that id is registered. The fact shapes follow each rule's file
// header; free-form variants outside a rule's vocabulary are kept on purpose,
// as with the other mutators.

const date = (chapter: number) => ({ subject: "story", predicate: "date", validFromChapter: chapter });
const DATES: Record<number, string> = { 1: "1 October 1851", 2: "2 October 1851", 3: "4 October 1851", 4: "5 October 1851", 5: "7 October 1851" };
const setDate = (chapter: number, object: string, quote: string, predicate = "date"): FactChange =>
  ({ target: { ...date(chapter), object: DATES[chapter]! }, set: { object, predicate, evidence: { quote } } });
const toSaltmere = (subject: string, object: string, from: number, quote: string): FactChange => ({
  target: { subject, predicate: "location", object, validFromChapter: from },
  set: { object: "Saltmere harbour", evidence: { quote } },
});

/**
 * `continuity/impossible-travel`: a move faster than the book's travel graph
 * (`story/plotlint/travel.json`: Wenlow–Stavely 12 h, Wenlow–Gorse Hill 6 h,
 * Stavely–Saltmere 48 h, Wenlow–Saltmere 72 h) allows in the time the chapters'
 * `story · date` facts leave. The rule is generous (from the start of the first
 * chapter's date to the end of the second's), so every mutant puts Saltmere a
 * single dated day from Wenlow or Gorse Hill.
 */
export const impossibleTravelMutator: Mutator = mutator("continuity/impossible-travel", "A character moves between places faster than the travel graph allows.", () => [
  {
    chapter: 2, description: "Jonas is at the Wenlow mill on 1 October and at Saltmere on 2 October.",
    edits: [ins(2, "Jonas talked most of the morning and said nothing at all in the afternoon.", "By evening he had somehow reached Saltmere harbour, three days' walk from Wenlow, and Elspeth went on to Stavely alone.")],
    change: [toSaltmere("Jonas Marrow", "the Heron inn, Stavely", 2, "By evening he had somehow reached Saltmere harbour")],
    match: [JONAS, TRAVEL],
  },
  {
    chapter: 2, description: "Elspeth is in Wenlow on 1 October and sleeps at Saltmere on 2 October.",
    edits: [ins(2, "Jonas talked most of the morning and said nothing at all in the afternoon.", "Elspeth, for her part, slept that night at Saltmere harbour on the coast, three days' walk from Wenlow.")],
    change: [toSaltmere("Elspeth Marrow", "the Heron inn, Stavely", 2, "Elspeth, for her part, slept that night at Saltmere harbour")],
    match: [ELSPETH, TRAVEL],
  },
  {
    chapter: 2, description: "Thorne is at the Wenlow landing on 1 October and at Saltmere on 2 October.",
    edits: [rewrite(2, "Captain Thorne was indeed already in Stavely.", "Captain Thorne, they heard, had spent the day at Saltmere harbour on warden's business.")],
    change: [toSaltmere("Ida Thorne", "Stavely", 2, "Captain Thorne, they heard, had spent the day at Saltmere harbour")],
    match: [THORNE, TRAVEL],
  },
  {
    chapter: 2, description: "Crane is on the Lune ferry on 1 October and at Saltmere on 2 October.",
    edits: [rewrite(2, "Crane was at that moment in his cottage in Wenlow, a day's walk behind them,", "Crane was at that moment at Saltmere harbour, three days' walk from home,")],
    change: [toSaltmere("Absalom Crane", "Crane's cottage, Wenlow", 2, "Crane was at that moment at Saltmere harbour")],
    match: [CRANE, TRAVEL],
  },
  {
    chapter: 4, description: "Thorne is at Saltmere on 4 October and on Gorse Hill on 5 October.",
    edits: [ins(3, "The parish nurse let them in.", "Captain Thorne, the nurse said, had ridden to Saltmere harbour that morning on warden's business.")],
    add: [fact("Ida Thorne", "location", "Saltmere harbour", 3, { until: 3, kind: "location", quote: "Captain Thorne, the nurse said, had ridden to Saltmere harbour that morning" })],
    match: [THORNE, TRAVEL],
  },
  {
    chapter: 4, description: "Elspeth is in Wenlow on 4 October and at Saltmere on 5 October.",
    edits: [ins(4, "Nobody did.", "By nightfall Elspeth was somehow at Saltmere harbour, three days' walk from Wenlow.")],
    change: [toSaltmere("Elspeth Marrow", "abbey ruins on Gorse Hill", 4, "By nightfall Elspeth was somehow at Saltmere harbour")],
    match: [ELSPETH, TRAVEL],
  },
  {
    chapter: 4, description: "Jonas is in Wenlow on 4 October and at Saltmere on 5 October.",
    edits: [ins(4, "Jonas went ahead with the compass.", "By evening Jonas was at Saltmere harbour instead, three days' walk from Wenlow.")],
    change: [toSaltmere("Jonas Marrow", "abbey ruins on Gorse Hill", 4, "By evening Jonas was at Saltmere harbour instead")],
    match: [JONAS, TRAVEL],
  },
  {
    chapter: 4, description: "Jonas is at Saltmere on 4 October and on Gorse Hill on 5 October.",
    edits: [ins(3, "The parish nurse let them in.", "Jonas was not with her; he had gone on to Saltmere harbour, two days past Stavely.")],
    change: [toSaltmere("Jonas Marrow", "Crane's cottage, Wenlow", 3, "he had gone on to Saltmere harbour, two days past Stavely")],
    match: [JONAS, TRAVEL],
  },
  {
    chapter: 4, description: "Elspeth is at Saltmere on 4 October and on Gorse Hill on 5 October.",
    edits: [ins(3, "The parish nurse let them in.", "Elspeth herself was still at Saltmere harbour that day, and only Jonas came to the bedside.")],
    change: [toSaltmere("Elspeth Marrow", "Crane's cottage, Wenlow", 3, "Elspeth herself was still at Saltmere harbour that day")],
    match: [ELSPETH, TRAVEL],
  },
  {
    chapter: 2, description: "Crane spends 1 October at Saltmere and is ill in his Wenlow cottage on 2 October.",
    edits: [ins(1, "He had three passengers that morning.", "He had come down from Saltmere harbour that morning, he said, where he had spent the night.")],
    change: [toSaltmere("Absalom Crane", "Lune ferry", 1, "He had come down from Saltmere harbour that morning")],
    match: [CRANE, TRAVEL],
  },
]);


/**
 * `continuity/timeline-order`: explicit dates go backwards from one chapter to the next.
 * Expected facts: `story · date · <day month year>` (kind "time"), one per chapter, in
 * several written forms; the rule is expected to report the chapter whose date
 * comes before an earlier chapter's.
 */
export const timelineOrderMutator: Mutator = mutator("continuity/timeline-order", "An explicit date goes backwards.", () => [
  {
    chapter: 4, description: "Ch4 is dated 3 October, after ch3's 4 October.",
    edits: [rewrite(4, "On the fifth of October they set out", "On the third of October they set out")],
    change: [setDate(4, "3 October 1851", "On the third of October they set out")],
    match: [DATE],
  },
  {
    chapter: 3, description: "Ch3 is dated 1 October, after ch2's 2 October.",
    edits: [rewrite(3, "It was the fourth of October when they came back", "It was the first of October when they came back")],
    change: [setDate(3, "1 October 1851", "It was the first of October when they came back")],
    match: [DATE],
  },
  {
    chapter: 5, description: "Ch5 (the funeral) is dated 4 October, after ch4's 5 October.",
    edits: [rewrite(5, "On the seventh of October they buried", "On the fourth of October they buried")],
    change: [setDate(5, "4 October 1851", "On the fourth of October they buried")],
    match: [DATE],
  },
  {
    chapter: 2, description: "Ch2 is dated 30 September, after ch1's 1 October.",
    edits: [rewrite(2, "on the second of October", "on the thirtieth of September")],
    change: [setDate(2, "30 September 1851", "on the thirtieth of September")],
    match: [DATE],
  },
  {
    chapter: 4, description: "Ch4 is dated 'October 3' (month first).",
    edits: [rewrite(4, "On the fifth of October they set out", "On October 3 they set out")],
    change: [setDate(4, "October 3, 1851", "On October 3 they set out")],
    match: [DATE],
  },
  {
    chapter: 3, description: "Ch3 is dated 'the 1st of October', before ch2's 2 October.",
    edits: [rewrite(3, "It was the fourth of October when they came back", "It was the 1st of October when they came back")],
    change: [setDate(3, "the 1st of October 1851", "It was the 1st of October when they came back")],
    match: [DATE],
  },
  {
    chapter: 5, description: "Ch5 is dated '3 Oct', with no year (the time parser reads no date without a year).",
    edits: [rewrite(5, "On the seventh of October they buried", "On 3 Oct they buried")],
    change: [setDate(5, "3 Oct", "On 3 Oct they buried")],
    match: [DATE],
  },
  {
    chapter: 4, description: "Ch4 is dated 2 October under the predicate 'current date'.",
    edits: [rewrite(4, "On the fifth of October they set out", "On the second of October they set out")],
    change: [setDate(4, "2 October 1851", "On the second of October they set out", "current date")],
    match: [DATE],
  },
  {
    chapter: 5, description: "Ch5 is dated 'the third day of October' under the predicate 'day' (free-form, no year).",
    edits: [rewrite(5, "On the seventh of October they buried", "On the third day of October they buried")],
    change: [setDate(5, "the third day of October", "On the third day of October they buried", "day")],
    match: [DATE],
  },
  {
    chapter: 3, description: "Ch3 is dated 'September 29'.",
    edits: [rewrite(3, "It was the fourth of October when they came back", "It was September 29 when they came back")],
    change: [setDate(3, "September 29, 1851", "It was September 29 when they came back")],
    match: [DATE],
  },
]);

/**
 * `continuity/item-from-nowhere`: a character uses an item they do not hold at that
 * point (someone else holds it, or nobody has it yet). Expected facts: a use
 * (`<user> · uses|reads|lights|unlocks with|digs with|writes in · <item>`) next to
 * the clean possession facts (`holds`/`carries`).
 */
export const itemFromNowhereMutator: Mutator = mutator("continuity/item-from-nowhere", "A character uses an item they do not have.", () => [
  {
    chapter: 2, description: "Jonas checks the compass Elspeth carries.",
    edits: [rewrite(2, "At the crossroads by the gibbet Elspeth took out the silver compass and checked their way, though she knew it already.", "At the crossroads by the gibbet Jonas took out the silver compass and checked their way, though he knew it already.")],
    add: [fact("Jonas Marrow", "uses", "silver compass", 2, { until: 2, quote: "Jonas took out the silver compass and checked their way" })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 4, description: "Elspeth uses the compass she gave Jonas in ch3.",
    edits: [rewrite(4, "\"East of true,\" Jonas said, tapping the compass, when she caught up with him.", "\"East of true,\" Elspeth said, tapping the silver compass from her own pocket, when she caught up with Jonas.")],
    add: [fact("Elspeth Marrow", "uses", "silver compass", 4, { until: 4, quote: "Elspeth said, tapping the silver compass from her own pocket" })],
    match: [ELSPETH, ITEM],
  },
  {
    chapter: 4, description: "Jonas opens the strongbox with the iron key Elspeth holds.",
    edits: [rewrite(4, "Elspeth knelt and fitted the iron key into the lock.", "Jonas knelt and fitted the iron key into the lock.")],
    add: [fact("Jonas Marrow", "uses", "iron key", 4, { until: 4, quote: "Jonas knelt and fitted the iron key into the lock." })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 2, description: "Rook reads Crane's ledger, which Crane holds in Wenlow.",
    edits: [ins(2, "Rook nodded slowly.", "He opened Crane's ferry ledger on the bar and ran his finger down the page for that night.")],
    add: [fact("Rook", "reads", "ferry ledger", 2, { until: 2, quote: "He opened Crane's ferry ledger on the bar" })],
    match: [ROOK, ITEM],
  },
  {
    chapter: 1, description: "Thorne reads the ledger Crane keeps under his seat.",
    edits: [ins(1, "\"Then I will read it for you.\"", "She opened the ferry ledger on her knee and read the page aloud.")],
    add: [fact("Ida Thorne", "reads", "ferry ledger", 1, { until: 1, quote: "She opened the ferry ledger on her knee and read the page aloud." })],
    match: [THORNE, ITEM],
  },
  {
    chapter: 5, description: "Elspeth writes in the ledger she has just given to Thorne.",
    edits: [ins(5, "She tucked the ledger inside her cloak.", "A moment later Elspeth was writing the date of Crane's burial on the ledger's last page.")],
    add: [fact("Elspeth Marrow", "writes in", "ferry ledger", 5, { quote: "Elspeth was writing the date of Crane's burial on the ledger's last page" })],
    match: [ELSPETH, ITEM],
  },
  {
    chapter: 3, description: "Jonas lights the lantern that is only bought in ch4.",
    edits: [ins(3, "They sat with him through the evening.", "Jonas lit the new lantern and set it on the sill.")],
    add: [fact("Jonas Marrow", "lights", "lantern", 3, { until: 3, quote: "Jonas lit the new lantern and set it on the sill." })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 3, description: "Elspeth digs with the spade that is only bought in ch4.",
    edits: [ins(3, "They sat with him through the evening.", "Elspeth dug the nurse's garden with the new spade while they waited.")],
    add: [fact("Elspeth Marrow", "digs with", "spade", 3, { until: 3, quote: "Elspeth dug the nurse's garden with the new spade" })],
    match: [ELSPETH, ["spade"]],
  },
  {
    chapter: 5, description: "Jonas unlocks the ferry chain with the iron key Elspeth holds.",
    edits: [ins(5, "Jonas was sitting in the stern.", "He had unlocked the ferry chain with the iron key from the strongbox.")],
    add: [fact("Jonas Marrow", "unlocks with", "iron key", 5, { quote: "He had unlocked the ferry chain with the iron key" })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 4, description: "Thorne followed them with the compass Jonas holds.",
    edits: [ins(4, "\"I followed Crane's nurse, who told me where you had gone, and I followed you from the village.\"", "She held up the silver compass. \"With this.\"")],
    add: [fact("Ida Thorne", "uses", "silver compass", 4, { until: 4, quote: "She held up the silver compass." })],
    match: [THORNE, ITEM],
  },
]);

const PASSENGERS_AT = (chapter: number) => ({ subject: "Crane's ferry", predicate: "passengers", object: "3", validFromChapter: chapter });
const carried = (chapter: number, object: string, quote: string, predicate = "passengers"): FactChange =>
  ({ target: PASSENGERS_AT(chapter), set: { object, predicate, evidence: { quote } } });
const FIVE_LIST = "Three people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, a boy with a dog, and an old man";

/**
 * `continuity/world-rule-broken`: a stated limit of the world is exceeded later.
 * Uses the rule's "maximum" form: the clean `Crane's ferry · max passengers · 3`
 * (kind "world_rule") and a later count (`Crane's ferry · passengers · <n>`, or a
 * free-form variant) above it.
 */
export const worldRuleBrokenMutator: Mutator = mutator("continuity/world-rule-broken", "A stated limit of the world (the ferry carries at most three) is exceeded.", () => [
  {
    chapter: 1, description: "The ferry comes in with five passengers.",
    edits: [rewrite(1, "He had three passengers that morning. Two were drovers in wet coats.", "He had five passengers that morning. Four were drovers in wet coats.")],
    change: [carried(1, "5", "He had five passengers that morning.")],
    match: [PASSENGERS],
  },
  {
    chapter: 5, description: "Jonas takes six across.",
    edits: [
      rewrite(5, FIVE_LIST, "Six people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, two pedlars, a boy with a dog, a curate, and an old man"),
      rewrite(5, "\"Three,\" he said. \"Just right.\"", "\"Six,\" he said. \"Close enough.\""),
    ],
    change: [carried(5, "6", "Six people were already waiting on the landing to cross")],
    match: [PASSENGERS],
  },
  {
    chapter: 5, description: "Jonas takes four across.",
    edits: [
      rewrite(5, FIVE_LIST, "Four people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, a pedlar, a boy with a dog, and an old man"),
      rewrite(5, "\"Three,\" he said. \"Just right.\"", "\"Four,\" he said. \"Near enough.\""),
    ],
    change: [carried(5, "4", "Four people were already waiting on the landing to cross")],
    match: [PASSENGERS],
  },
  {
    chapter: 1, description: "The ferry comes in with seven passengers.",
    edits: [rewrite(1, "He had three passengers that morning. Two were drovers in wet coats.", "He had seven passengers that morning. Six were drovers in wet coats.")],
    change: [carried(1, "7", "He had seven passengers that morning.")],
    match: [PASSENGERS],
  },
  {
    chapter: 3, description: "Crane's nephew brings them over with five aboard.",
    edits: [ins(3, "It was the fourth of October when they came back to Wenlow.", "Crane's nephew brought them over the Lune in the old ferry with two pedlars and a priest, five passengers and the boat low in the water.")],
    add: [fact("Crane's ferry", "passengers", "5", 3, { until: 3, quote: "five passengers and the boat low in the water" })],
    match: [PASSENGERS],
  },
  {
    chapter: 4, description: "From the hill they see the ferry cross with six passengers.",
    edits: [ins(4, "Nobody did.", "Down on the Lune they saw the ferry going over with six passengers packed in the stern.")],
    add: [fact("Crane's ferry", "passengers", "6", 4, { until: 4, quote: "Down on the Lune they saw the ferry going over with six passengers packed in the stern." })],
    match: [PASSENGERS],
  },
  {
    chapter: 5, description: "Jonas takes four across, recorded as 'ferried · four passengers' (free-form).",
    edits: [
      rewrite(5, FIVE_LIST, "Four people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, a pedlar, a boy with a dog, and an old man"),
      rewrite(5, "\"Three,\" he said. \"Just right.\"", "\"Four,\" he said. \"Near enough.\""),
    ],
    change: [carried(5, "four passengers", "Four people were already waiting on the landing to cross", "ferried")],
    match: [PASSENGERS],
  },
  {
    chapter: 5, description: "Jonas (not the ferry) carries five across ('Jonas Marrow · carried · 5 passengers across the Lune').",
    edits: [
      rewrite(5, FIVE_LIST, "Five people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, two pedlars, a boy with a dog, and an old man"),
      rewrite(5, "\"Three,\" he said. \"Just right.\"", "\"Five,\" he said. \"Near enough.\""),
    ],
    change: [{ target: PASSENGERS_AT(5), set: null }],
    add: [fact("Jonas Marrow", "carried", "5 passengers across the Lune", 5, { quote: "Five people were already waiting on the landing to cross" })],
    match: [PASSENGERS],
  },
  {
    chapter: 1, description: "The ferry comes in with four passengers ('passenger count').",
    edits: [rewrite(1, "He had three passengers that morning. Two were drovers in wet coats.", "He had four passengers that morning. Three were drovers in wet coats.")],
    change: [carried(1, "4", "He had four passengers that morning.", "passenger count")],
    match: [PASSENGERS],
  },
  {
    chapter: 5, description: "Jonas takes eight across ('passengers · eight', a word numeral).",
    edits: [
      rewrite(5, FIVE_LIST, "Eight people were already waiting on the landing to cross: a farmer's wife with a basket of eggs, three pedlars, a boy with a dog, two nuns, and an old man"),
      rewrite(5, "\"Three,\" he said. \"Just right.\"", "\"Eight,\" he said. \"We will manage.\""),
    ],
    change: [carried(5, "eight", "Eight people were already waiting on the landing to cross")],
    match: [PASSENGERS],
  },
]);

const SECRET_OBJECT = "the strongbox under the third flagstone of the abbey chapel on Gorse Hill";

/**
 * `continuity/knowledge-leak`: a character acts on a fact before the chapter in
 * which they learn it. Expected facts: the clean knowledge facts
 * (`Elspeth Marrow|Jonas Marrow · knows · the strongbox is under the third
 * flagstone ...`, from ch3, kind "knowledge"), the secret they are about
 * (`Wenlow parish strongbox · location · hidden under the third flagstone ...`,
 * and `Alderman Pask · secret · one of the men who sank the Margery`, learned by
 * Thorne in ch5), and an earlier goal or deliberate act whose object names it.
 * Thorne's flagstone mutant is an expected miss: she never learns it, and the
 * rule (on purpose) says nothing without a later knowledge-gained fact.
 */
export const knowledgeLeakMutator: Mutator = mutator("continuity/knowledge-leak", "A character acts on a secret before learning it.", () => [
  {
    chapter: 2, description: "Elspeth plans to lift the third flagstone in ch2; Crane only tells her in ch3.",
    edits: [ins(2, "Elspeth lay awake a long time in the room above the bar.", "She was already planning how she would lift the third flagstone of the abbey chapel on Gorse Hill and take the strongbox out from under it.")],
    add: [fact("Elspeth Marrow", "plans to dig up", SECRET_OBJECT, 2, { kind: "goal", quote: "She was already planning how she would lift the third flagstone of the abbey chapel on Gorse Hill" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 1, description: "Jonas proposes digging under the third flagstone in ch1.",
    edits: [ins(1, "He stopped laughing.", "\"Then it is time to dig under the third flagstone of the abbey chapel,\" he said. \"Where Father hid the strongbox.\"")],
    add: [fact("Jonas Marrow", "wants to dig up", SECRET_OBJECT, 1, { kind: "goal", quote: "\"Then it is time to dig under the third flagstone of the abbey chapel,\" he said." })],
    match: [JONAS, SECRET],
  },
  {
    chapter: 2, description: "Elspeth tells Thorne where the strongbox is in ch2.",
    edits: [ins(2, "Your father is the easiest man to blame, because he is not here to argue.\"", "\"It is under the third flagstone of the abbey chapel,\" Elspeth said. \"I would stake my life on it.\"")],
    add: [fact("Elspeth Marrow", "tells Thorne", SECRET_OBJECT, 2, { until: 2, quote: "\"It is under the third flagstone of the abbey chapel,\" Elspeth said." })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 1, description: "Elspeth searches under the third flagstone on the night of ch1.",
    edits: [ins(1, "That night Elspeth sat by the window of their cottage and counted her twelve shillings twice.", "Then she took a lamp up Gorse Hill to the abbey chapel and looked under the third flagstone, as if she already knew what was there.")],
    add: [fact("Elspeth Marrow", "searched", SECRET_OBJECT, 1, { until: 1, quote: "Then she took a lamp up Gorse Hill to the abbey chapel and looked under the third flagstone" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 2, description: "Thorne, who is never told, means to dig under the third flagstone in ch2.",
    edits: [ins(2, "\"Then help me prove it,\" said Thorne.", "\"I mean to dig under the third flagstone of the abbey chapel on Gorse Hill. That is where the strongbox is.\"")],
    add: [fact("Ida Thorne", "intends to dig up", SECRET_OBJECT, 2, { kind: "goal", quote: "\"I mean to dig under the third flagstone of the abbey chapel on Gorse Hill." })],
    match: [THORNE, SECRET],
  },
  {
    chapter: 2, description: "Thorne names Alderman Pask from the ledger in ch2; she only reads it in ch5.",
    edits: [ins(2, "Your father is the easiest man to blame, because he is not here to argue.\"", "\"Though if you ask me, it will be Alderman Pask. His name will be in Crane's ledger.\"")],
    add: [fact("Ida Thorne", "accuses", "Alderman Pask as one of the men who sank the Margery", 2, { until: 2, quote: "it will be Alderman Pask. His name will be in Crane's ledger." })],
    match: [THORNE, PASK],
  },
  {
    chapter: 2, description: "Jonas buys a spade in Stavely to dig under the third flagstone.",
    edits: [ins(2, "\"We did.\"", "Jonas asked him where to buy a spade, because they would need one for the third flagstone of the abbey chapel.")],
    add: [fact("Jonas Marrow", "buys a spade to dig up", SECRET_OBJECT, 2, { until: 2, kind: "goal", quote: "because they would need one for the third flagstone of the abbey chapel" })],
    match: [JONAS, SECRET],
  },
  {
    chapter: 2, description: "Elspeth asks Rook the way to the abbey chapel's third flagstone.",
    edits: [ins(2, "\"We did.\"", "Elspeth asked him the way to Gorse Hill, and whether the abbey chapel still had its floor, because the strongbox was under the third flagstone.")],
    add: [fact("Elspeth Marrow", "seeks", SECRET_OBJECT, 2, { kind: "goal", quote: "because the strongbox was under the third flagstone" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 1, description: "Elspeth tells Jonas where the strongbox is in ch1.",
    edits: [ins(1, "She told him about the letter.", "She told him, too, that their father had hidden the strongbox under the third flagstone of the abbey chapel.")],
    add: [fact("Elspeth Marrow", "tells Jonas", SECRET_OBJECT, 1, { until: 1, quote: "their father had hidden the strongbox under the third flagstone of the abbey chapel" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 2, description: "Jonas draws the abbey chapel floor and marks the third flagstone in ch2.",
    edits: [ins(2, "None of them knew yet how little time he had.", "Upstairs, Jonas drew the abbey chapel floor on the back of a bill and marked the third flagstone with a cross.")],
    add: [fact("Jonas Marrow", "marks on a map", SECRET_OBJECT, 2, { until: 2, quote: "marked the third flagstone with a cross" })],
    match: [JONAS, SECRET],
  },
]);

/**
 * `continuity/invariant`: the author's invariants in the corpus's
 * `story/plotlint/invariants.json` (approved, and all true of the clean book).
 * Each mutant breaks one of them.
 */
export const invariantMutator: Mutator = mutator("continuity/invariant", "An author-written invariant is broken.", () => [
  {
    chapter: 1, description: "strongbox-secret: Elspeth knows about the flagstone in ch1.",
    edits: [ins(1, "She told him about the letter.", "She already knew, though she could not have said how, that the strongbox lay under a flagstone of the abbey chapel.")],
    add: [fact("Elspeth Marrow", "knows", "the strongbox lies under a flagstone of the abbey chapel", 1, { kind: "knowledge", quote: "the strongbox lay under a flagstone of the abbey chapel" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 2, description: "strongbox-secret: Elspeth learns of the flagstone from Rook in ch2 ('learned').",
    edits: [ins(2, "\"Our father,\" said Jonas.", "\"He told me once the strongbox went under a flagstone up at the abbey,\" Rook said, and Elspeth never forgot it.")],
    add: [fact("Elspeth Marrow", "learned", "the strongbox went under a flagstone at the abbey", 2, { kind: "knowledge", quote: "the strongbox went under a flagstone up at the abbey" })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 2, description: "strongbox-secret: Elspeth is aware of the flagstone in ch2 ('is aware of').",
    edits: [ins(2, "Elspeth lay awake a long time in the room above the bar.", "She thought about the flagstone in the abbey chapel, and the box beneath it.")],
    add: [fact("Elspeth Marrow", "is aware of", "the box beneath the flagstone in the abbey chapel", 2, { quote: "She thought about the flagstone in the abbey chapel, and the box beneath it." })],
    match: [ELSPETH, SECRET],
  },
  {
    chapter: 3, description: "jonas-never-reads-ledger: Jonas reads the ledger at Crane's bedside.",
    edits: [ins(3, "They sat with him through the evening.", "Jonas read the ledger by the lamp, page after page.")],
    add: [fact("Jonas Marrow", "reads", "ferry ledger", 3, { until: 3, quote: "Jonas read the ledger by the lamp, page after page." })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 5, description: "jonas-never-reads-ledger: Jonas reads through the ledger before it goes to Thorne.",
    edits: [ins(5, "She had read her father's letter too.", "Jonas had read through the ledger as well, over her shoulder.")],
    add: [fact("Jonas Marrow", "read through", "the ferry ledger", 5, { until: 5, quote: "Jonas had read through the ledger as well" })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 3, description: "thorne-not-on-gorse-hill-early: Thorne is on Gorse Hill in ch3.",
    edits: [ins(3, "The parish nurse let them in.", "Captain Thorne, the nurse said, was already up at the abbey ruins on Gorse Hill.")],
    add: [fact("Ida Thorne", "location", "abbey ruins on Gorse Hill", 3, { until: 3, kind: "location", quote: "Captain Thorne, the nurse said, was already up at the abbey ruins on Gorse Hill." })],
    match: [THORNE, ["Gorse", "abbey"]],
  },
  {
    chapter: 3, description: "thorne-not-on-gorse-hill-early: Thorne is 'currently at' the abbey in ch3 (labelled location).",
    edits: [ins(3, "They sat with him through the evening.", "Out on Gorse Hill, Captain Thorne was walking the abbey ruins alone.")],
    add: [fact("Ida Thorne", "currently at", "the abbey on Gorse Hill", 3, { until: 3, kind: "location", quote: "Out on Gorse Hill, Captain Thorne was walking the abbey ruins alone." })],
    match: [THORNE, ["Gorse", "abbey"]],
  },
  {
    chapter: 1, description: "pask-named-late: Pask is named in ch1 (text only).",
    edits: [ins(1, "\"He is lying,\" she said, \"or he is afraid. In my experience it is often both.\"", "\"Alderman Pask said the same of him.\"")],
    match: [PASK],
  },
  {
    chapter: 2, description: "pask-named-late: Pask is named in ch2 (text only).",
    edits: [ins(2, "\"I think somebody did.", "Alderman Pask thinks so too.")],
    match: [PASK],
  },
  {
    chapter: 4, description: "pask-named-late: Pask is named in ch4 (text only).",
    edits: [ins(4, "The parish council will be very glad, and some of them will be very frightened.", "Alderman Pask most of all.")],
    match: [PASK],
  },
]);

export const futureMutators: ReadonlyArray<Mutator> = [
  impossibleTravelMutator,
  timelineOrderMutator, itemFromNowhereMutator, worldRuleBrokenMutator, knowledgeLeakMutator, invariantMutator,
];
