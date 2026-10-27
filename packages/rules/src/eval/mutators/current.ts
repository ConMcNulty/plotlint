import { fact, insertAfter as ins, mutator, rewrite, type FactChange, type Mutator } from "../mutant.js";
import { AGE, CRANE, DEATH, ELSPETH, ITEM, JONAS, LIFE, MONEY, PLACE, ROOK, THORNE, TOBIAS } from "./words.js";

// Mutators for the rules that ship today. Each mutant is one plausible slip, put
// into the prose (so the LLM-only auditor can see it) and into the facts the way
// a settler would record it. Some variants use free-form GLM-style predicates the
// rule's vocabulary does not know; those are expected misses that keep the
// recall figure honest rather than defects in the mutator.

const CRANE_DEATH = { subject: "Absalom Crane", predicate: "status", object: "dead", validFromChapter: 3 } as const;
const TOBIAS_DEATH = { subject: "Tobias Marrow", predicate: "status", object: "dead", validFromChapter: 1 } as const;
const endCraneDeath = (until: number, extra: Record<string, unknown> = {}): FactChange => ({ target: CRANE_DEATH, set: { validUntilChapter: until, ...extra } });

export const deadEntityActsMutator: Mutator = mutator("continuity/dead-entity-acts", "A character recorded as dead gains new state (moves, holds, acts) while the death still stands.", () => [
  {
    chapter: 4, description: "Crane, dead in ch3, waits at the abbey in ch4 (location).",
    edits: [ins(4, "The abbey had been a ruin for three hundred years.", "Absalom Crane was waiting for them by the chapel door, leaning on his oar and coughing.")],
    add: [fact("Absalom Crane", "location", "abbey ruins on Gorse Hill", 4, { until: 4, kind: "location", quote: "Absalom Crane was waiting for them by the chapel door" })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 5, description: "Crane takes his oar back at the landing in ch5 (GLM free-form 'took possession of').",
    edits: [ins(5, "Jonas was sitting in the stern.", "Old Absalom Crane stood on the landing beside him and took his oar back without a word.")],
    add: [fact("Absalom Crane", "took possession of", "his oar", 5, { quote: "Old Absalom Crane stood on the landing beside him and took his oar back without a word." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Crane points out the flagstone in ch4 (free-form action predicate).",
    edits: [ins(4, "The third was cracked across one corner and sat a finger's breadth lower than the others.", "\"That's the one,\" said Absalom Crane, pointing with his pipe.")],
    add: [fact("Absalom Crane", "points out", "the third flagstone", 4, { until: 4, quote: "\"That's the one,\" said Absalom Crane, pointing with his pipe." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 5, description: "Crane watches his own funeral from the lych-gate in ch5 (whereabouts).",
    edits: [ins(5, "Half the village came.", "Absalom Crane himself watched from the lych-gate, his cap in his hands.")],
    add: [fact("Absalom Crane", "whereabouts", "Wenlow churchyard lych-gate", 5, { kind: "location", quote: "Absalom Crane himself watched from the lych-gate, his cap in his hands." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Thorne drowns in ch2 but walks into the abbey in ch4 (clean ch4 facts now follow a death).",
    edits: [ins(2, "Elspeth lay awake a long time in the room above the bar.", "Before dawn the watch pulled Captain Ida Thorne out of the river below the Stavely weir. She was dead, and nobody could say how she had fallen in.")],
    add: [fact("Ida Thorne", "status", "dead", 2, { kind: "status", quote: "She was dead, and nobody could say how she had fallen in." })],
    match: [THORNE, DEATH],
  },
  {
    chapter: 4, description: "Jonas dies of fever in ch3 (copula 'is · dead') but climbs Gorse Hill in ch4.",
    edits: [ins(3, "Absalom Crane died a little before midnight, with the lamp still burning and the window open to the sound of the river.", "Jonas died in the same hour, of the same fever, and they laid him on the settle by the door.")],
    add: [fact("Jonas Marrow", "is", "dead", 3, { quote: "Jonas died in the same hour, of the same fever" })],
    match: [JONAS, DEATH],
  },
  {
    chapter: 4, description: "Tobias Marrow, dead since the Margery sank, steps out of the abbey ruins in ch4.",
    edits: [ins(4, "Inside, wrapped in oilcloth, were the bags of the Wenlow parish money, and on top of them a letter in her father's hand.", "Then Tobias Marrow himself stepped out from behind the chapel wall, older and thinner, and held out his hand for the key.")],
    add: [fact("Tobias Marrow", "location", "abbey ruins on Gorse Hill", 4, { until: 4, kind: "location", quote: "Then Tobias Marrow himself stepped out from behind the chapel wall" })],
    match: [TOBIAS, DEATH],
  },
  {
    chapter: 2, description: "The dead Tobias Marrow hands in the letter at the Stavely post office in ch2 (free-form action).",
    edits: [ins(2, "He does not know who paid him, only that it was an old man with a bad cough who smelled of river water.", "The postmaster swears it was Tobias Marrow himself who paid the boy. He knew him well.")],
    add: [fact("Tobias Marrow", "handed in", "the letter at the Stavely post office", 2, { until: 2, quote: "The postmaster swears it was Tobias Marrow himself who paid the boy." })],
    match: [TOBIAS, DEATH],
  },
  {
    chapter: 5, description: "Crane's death recorded as 'died from' a chest sickness; he rows the second boat in ch5.",
    edits: [ins(5, "He took them across.", "Absalom Crane rowed the second boat beside him, keeping time.")],
    change: [{ target: CRANE_DEATH, set: { predicate: "died from", object: "a sickness of the chest", kind: undefined } }],
    add: [fact("Absalom Crane", "rows", "the second ferry boat", 5, { quote: "Absalom Crane rowed the second boat beside him, keeping time." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Crane's death recorded as 'fate · passed away' (outside the death vocabulary); he mends nets at the landing in ch4.",
    edits: [ins(4, "Before they left, Elspeth went to the smithy and bought a spade and a lantern.", "On the way she passed Absalom Crane at the ferry landing, mending a net.")],
    change: [{ target: CRANE_DEATH, set: { predicate: "fate", object: "passed away" } }],
    add: [fact("Absalom Crane", "location", "Wenlow ferry landing", 4, { until: 4, kind: "location", quote: "On the way she passed Absalom Crane at the ferry landing, mending a net." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 3, description: "Footpads kill Jonas on the road in ch2 ('was killed by'); he is at Crane's bedside in ch3.",
    edits: [ins(2, "Jonas talked most of the morning and said nothing at all in the afternoon.", "At the last stile footpads came out of the hedge, and Jonas was killed by them before Elspeth could even scream.")],
    add: [fact("Jonas Marrow", "was killed by", "footpads on the river road", 2, { quote: "Jonas was killed by them before Elspeth could even scream" })],
    match: [JONAS, DEATH],
  },
]);

export const deadThenAliveMutator: Mutator = mutator("continuity/dead-then-alive", "A recorded death ends and the character is alive or acting again.", () => [
  {
    chapter: 5, description: "Crane's death is ended after ch3 and he walks into his own funeral, alive, in ch5.",
    edits: [ins(5, "Half the village came.", "Then Absalom Crane walked in through the lych-gate, alive and very cross, and asked whose funeral it was.")],
    change: [endCraneDeath(3)],
    add: [fact("Absalom Crane", "status", "alive", 5, { kind: "status", quote: "Then Absalom Crane walked in through the lych-gate, alive and very cross" })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 5, description: "Crane's death is ended after ch4 and he sits on the bollard at the landing in ch5 (location only).",
    edits: [ins(5, "At the landing the ferry was tied up where Crane had left it.", "Crane himself was sitting on the bollard beside it, pale but breathing, as if the grave had sent him back.")],
    change: [endCraneDeath(4)],
    add: [fact("Absalom Crane", "location", "Wenlow ferry landing", 5, { kind: "location", quote: "Crane himself was sitting on the bollard beside it" })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Thorne is laid out for dead in ch2 (death ended after ch3) and is at the abbey in ch4.",
    edits: [ins(2, "Elspeth lay awake a long time in the room above the bar.", "Below her, the watch carried Captain Thorne out of the Heron and laid her out for dead in the stable.")],
    add: [fact("Ida Thorne", "status", "dead", 2, { until: 3, kind: "status", quote: "the watch carried Captain Thorne out of the Heron and laid her out for dead in the stable" })],
    match: [THORNE, DEATH],
  },
  {
    chapter: 3, description: "Jonas is dead in ch2 ('is · dead', ended after ch2) and back at Crane's cottage in ch3.",
    edits: [ins(2, "Jonas talked most of the morning and said nothing at all in the afternoon.", "By the last stile he was dead of the cold, and Elspeth went on alone.")],
    add: [fact("Jonas Marrow", "is", "dead", 2, { until: 2, quote: "By the last stile he was dead of the cold" })],
    match: [JONAS, DEATH],
  },
  {
    chapter: 4, description: "Tobias Marrow's death is ended and he is alive at the abbey in ch4.",
    edits: [ins(4, "Inside, wrapped in oilcloth, were the bags of the Wenlow parish money, and on top of them a letter in her father's hand.", "Then her father, Tobias Marrow, alive after ten years, stepped out from behind the chapel wall.")],
    change: [{ target: TOBIAS_DEATH, set: { validUntilChapter: 3 } }],
    add: [
      fact("Tobias Marrow", "status", "alive", 4, { kind: "status", quote: "Then her father, Tobias Marrow, alive after ten years" }),
      fact("Tobias Marrow", "location", "abbey ruins on Gorse Hill", 4, { until: 4, kind: "location", quote: "stepped out from behind the chapel wall" }),
    ],
    match: [TOBIAS, DEATH],
  },
  {
    chapter: 2, description: "Tobias Marrow's death is ended after ch1; Rook says he lives at Saltmere (free-form 'lives in').",
    edits: [ins(2, "\"Our father,\" said Jonas.", "Rook frowned. \"Your father? Tobias Marrow lives at Saltmere now. I drank with him there at midsummer.\"")],
    change: [{ target: TOBIAS_DEATH, set: { validUntilChapter: 1 } }],
    add: [fact("Tobias Marrow", "lives in", "Saltmere", 2, { quote: "Tobias Marrow lives at Saltmere now." })],
    match: [TOBIAS, DEATH],
  },
  {
    chapter: 5, description: "Crane's death is ended after ch4 and he rows the second boat in ch5 (free-form action).",
    edits: [ins(5, "He took them across.", "Absalom Crane, who had been dead four days, rowed the second boat beside him.")],
    change: [endCraneDeath(4)],
    add: [fact("Absalom Crane", "rows", "the second ferry boat", 5, { quote: "Absalom Crane, who had been dead four days, rowed the second boat beside him." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Crane's death recorded as 'died from' and ended after ch3; he holds his oar at the abbey in ch4.",
    edits: [ins(4, "The abbey had been a ruin for three hundred years.", "Absalom Crane was at the chapel door, leaning on his oar and coughing.")],
    change: [endCraneDeath(3, { predicate: "died from", object: "a sickness of the chest", kind: undefined })],
    add: [fact("Absalom Crane", "holds", "his oar", 4, { until: 4, kind: "possession", quote: "Absalom Crane was at the chapel door, leaning on his oar and coughing." })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 2, description: "Thorne is found deceased at the end of ch1 ('condition · deceased', ended) and is in Stavely in ch2.",
    edits: [ins(1, "It was Crane's ferry, crossing late, with one passenger she could not make out.", "In the morning the village heard that the river warden, Captain Thorne, had been found deceased in her room at the inn.")],
    add: [fact("Ida Thorne", "condition", "deceased", 1, { until: 1, quote: "Captain Thorne, had been found deceased in her room at the inn" })],
    match: [THORNE, DEATH],
  },
  {
    chapter: 5, description: "Crane's death recorded as 'fate · passed away' (outside the death vocabulary) and ended; alive in ch5.",
    edits: [ins(5, "Half the village came.", "Then Absalom Crane walked in through the lych-gate, alive and very cross, and asked whose funeral it was.")],
    change: [endCraneDeath(3, { predicate: "fate", object: "passed away" })],
    add: [fact("Absalom Crane", "status", "alive", 5, { kind: "status", quote: "Then Absalom Crane walked in through the lych-gate, alive and very cross" })],
    match: [CRANE, DEATH],
  },
  {
    chapter: 4, description: "Jonas is pulled from the river drowned at the end of ch3 (ended) and climbs Gorse Hill in ch4.",
    edits: [ins(3, "\"We go tomorrow. Before anyone on the parish council hears that Crane is dead.\"", "That night Jonas went down to the river alone, and in the morning they pulled him out of it drowned.")],
    add: [fact("Jonas Marrow", "status", "drowned", 3, { until: 3, kind: "status", quote: "in the morning they pulled him out of it drowned" })],
    match: [JONAS, DEATH],
  },
]);

export const twoPlacesAtOnceMutator: Mutator = mutator("continuity/two-places-at-once", "A second location is recorded for a character without ending the first.", () => [
  {
    chapter: 2, description: "Jonas is at the Wenlow mill while at the Heron in Stavely (whereabouts).",
    edits: [ins(2, "None of them knew yet how little time he had.", "Jonas was at that moment at the Wenlow mill as well, working the sluice gates through the night shift.")],
    add: [fact("Jonas Marrow", "whereabouts", "Wenlow mill", 2, { until: 2, kind: "location", quote: "Jonas was at that moment at the Wenlow mill as well" })],
    match: [JONAS, PLACE],
  },
  {
    chapter: 4, description: "Elspeth sits at home in Wenlow while digging on Gorse Hill (current location).",
    edits: [ins(4, "They took turns with the spade.", "All that afternoon Elspeth sat at home in the Marrow cottage in Wenlow, mending her brother's coat.")],
    add: [fact("Elspeth Marrow", "current location", "Marrow cottage, Wenlow", 4, { until: 4, quote: "All that afternoon Elspeth sat at home in the Marrow cottage in Wenlow" })],
    match: [ELSPETH, PLACE],
  },
  {
    chapter: 5, description: "Thorne stays behind in Stavely while at the Wenlow landing (located in).",
    edits: [ins(5, "\"I will speak for you,\" said Thorne.", "Captain Thorne had stayed behind in Stavely that week and never came to Wenlow at all.")],
    add: [fact("Ida Thorne", "located in", "Stavely", 5, { quote: "Captain Thorne had stayed behind in Stavely that week" })],
    match: [THORNE, PLACE],
  },
  {
    chapter: 2, description: "Rook spends the week at Saltmere while serving them at the Heron.",
    edits: [ins(2, "The innkeeper was a heavy, careful man named Rook, who wiped every coin before he took it.", "Rook was spending that whole week at Saltmere harbour, buying wine off the boats.")],
    add: [fact("Rook", "location", "Saltmere harbour", 2, { until: 2, kind: "location", quote: "Rook was spending that whole week at Saltmere harbour" })],
    match: [ROOK, PLACE],
  },
  {
    chapter: 2, description: "Crane is staying at the Heron while ill in his Wenlow cottage (staying at).",
    edits: [ins(2, "She is staying at the warden's house on Fuller Street.\"", "\"And old Crane from Wenlow is staying here at the Heron tonight, in the room under yours.\"")],
    add: [fact("Absalom Crane", "staying at", "the Heron inn, Stavely", 2, { until: 2, quote: "old Crane from Wenlow is staying here at the Heron tonight" })],
    match: [CRANE, PLACE],
  },
  {
    chapter: 3, description: "Elspeth is still at the Heron while at Crane's bedside (GLM 'is at', labelled location).",
    edits: [ins(3, "The parish nurse let them in.", "Elspeth, meanwhile, was still at the Heron inn in Stavely, waiting for a letter.")],
    add: [fact("Elspeth Marrow", "is at", "the Heron inn, Stavely", 3, { until: 3, kind: "location", quote: "Elspeth, meanwhile, was still at the Heron inn in Stavely" })],
    match: [ELSPETH, PLACE],
  },
  {
    chapter: 4, description: "Jonas has arrived at Saltmere while on Gorse Hill (free-form 'arrived at', no kind label).",
    edits: [ins(4, "Jonas went ahead with the compass.", "By noon Jonas had arrived at Saltmere harbour on the coast, where he meant to sell the compass.")],
    add: [fact("Jonas Marrow", "arrived at", "Saltmere harbour", 4, { until: 4, quote: "By noon Jonas had arrived at Saltmere harbour on the coast" })],
    match: [JONAS, PLACE],
  },
  {
    chapter: 5, description: "Jonas is at the Heron in Stavely while rowing the ferry (free-form 'arrived at', labelled location).",
    edits: [ins(5, "Nobody had rowed it since he fell ill, and people who needed to cross had been walking the six miles round to the bridge at Stavely.", "Jonas had arrived at the Heron inn in Stavely that morning and would not be back in Wenlow until the spring.")],
    add: [fact("Jonas Marrow", "arrived at", "the Heron inn, Stavely", 5, { kind: "location", quote: "Jonas had arrived at the Heron inn in Stavely that morning" })],
    match: [JONAS, PLACE],
  },
  {
    chapter: 4, description: "Thorne writes letters in Stavely while at the abbey.",
    edits: [ins(4, "The abbey had been a ruin for three hundred years.", "Captain Thorne spent that whole day at the warden's house in Stavely, writing letters.")],
    add: [fact("Ida Thorne", "location", "the warden's house, Stavely", 4, { until: 4, kind: "location", quote: "Captain Thorne spent that whole day at the warden's house in Stavely" })],
    match: [THORNE, PLACE],
  },
  {
    chapter: 1, description: "Elspeth spends the first day in Stavely while at the Wenlow landing and cottage.",
    edits: [ins(1, "On the first of October, 1851, the river Lune ran high and brown past the village of Wenlow.", "Elspeth Marrow spent that day and night in Stavely, a full day's walk from home.")],
    add: [fact("Elspeth Marrow", "location", "Stavely", 1, { until: 1, kind: "location", quote: "Elspeth Marrow spent that day and night in Stavely" })],
    match: [ELSPETH, PLACE],
  },
  {
    chapter: 1, description: "Crane is up at the mill all morning while rowing the ferry.",
    edits: [ins(1, "Crane had not moved from his seat.", "Crane was up at the Wenlow mill all that morning, arguing with the miller.")],
    add: [fact("Absalom Crane", "location", "Wenlow mill", 1, { until: 1, kind: "location", quote: "Crane was up at the Wenlow mill all that morning" })],
    match: [CRANE, PLACE],
  },
]);

export const itemTwoHoldersMutator: Mutator = mutator("continuity/item-two-holders", "One item is recorded as held by two characters at once.", () => [
  {
    chapter: 4, description: "Thorne has the ledger under her arm while Elspeth holds it.",
    edits: [ins(4, "Thorne came forward and looked down into the hole.", "She had the ferry ledger under her arm already, the same ledger Elspeth had in her coat.")],
    add: [fact("Ida Thorne", "holds", "ferry ledger", 4, { until: 4, kind: "possession", quote: "She had the ferry ledger under her arm already" })],
    match: [THORNE, ITEM],
  },
  {
    chapter: 4, description: "Elspeth carries the compass in ch4 after giving it to Jonas in ch3.",
    edits: [ins(4, "Before they left, Elspeth went to the smithy and bought a spade and a lantern.", "She carried the silver compass in her own pocket, as she always had.")],
    add: [fact("Elspeth Marrow", "carries", "silver compass", 4, { until: 4, kind: "possession", quote: "She carried the silver compass in her own pocket, as she always had." })],
    match: [ELSPETH, ITEM],
  },
  {
    chapter: 2, description: "The compass Elspeth carries hangs on Rook's watch chain (item-first 'held by').",
    edits: [ins(2, "Rook nodded slowly.", "On his watch chain hung the silver compass that Elspeth had been carrying since Wenlow.")],
    add: [fact("silver compass", "held by", "Rook", 2, { until: 2, kind: "possession", quote: "On his watch chain hung the silver compass that Elspeth had been carrying since Wenlow." })],
    match: [ROOK, ITEM],
  },
  {
    chapter: 4, description: "Jonas has the iron key around his neck while Elspeth holds it (in possession of).",
    edits: [ins(4, "Jonas went ahead with the compass.", "He had the iron key on a string around his neck, where Elspeth could not lose it.")],
    add: [fact("Jonas Marrow", "in possession of", "iron key", 4, { until: 4, quote: "He had the iron key on a string around his neck" })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 4, description: "Jonas carries the strongbox down the hill while Elspeth does (item-first 'carried by').",
    edits: [ins(4, "Elspeth carried the strongbox down the hill herself, though it bruised her arms.", "Jonas carried the strongbox too, the whole way down, and would not let it go.")],
    add: [fact("Wenlow parish strongbox", "carried by", "Jonas Marrow", 4, { until: 4, quote: "Jonas carried the strongbox too, the whole way down" })],
    match: [JONAS, ITEM],
  },
  {
    chapter: 5, description: "Elspeth still has the ledger after giving it to Thorne.",
    edits: [ins(5, "\"Now I can.\"", "But Elspeth still had the ferry ledger in her coat pocket; she could feel its weight.")],
    add: [fact("Elspeth Marrow", "holds", "ferry ledger", 5, { kind: "possession", quote: "But Elspeth still had the ferry ledger in her coat pocket" })],
    match: [ELSPETH, ITEM],
  },
  {
    chapter: 4, description: "Elspeth carries the lantern Jonas carries.",
    edits: [ins(4, "Elspeth carried the strongbox down the hill herself, though it bruised her arms.", "She carried the lantern too, in her other hand.")],
    add: [fact("Elspeth Marrow", "holds", "lantern", 4, { until: 4, kind: "possession", quote: "She carried the lantern too, in her other hand." })],
    match: [ELSPETH, ITEM],
  },
  {
    chapter: 2, description: "Rook produces Crane's ledger while Crane holds it (free-form 'took possession of').",
    edits: [ins(2, "Rook nodded slowly.", "Then he took Crane's ferry ledger out from under the bar and set it down by her bowl.")],
    add: [fact("Rook", "took possession of", "ferry ledger", 2, { until: 2, kind: "possession", quote: "Then he took Crane's ferry ledger out from under the bar" })],
    match: [ROOK, ITEM],
  },
  {
    chapter: 5, description: "Thorne is carrying the compass Jonas wears (free-form 'is carrying', labelled possession).",
    edits: [ins(5, "She tucked the ledger inside her cloak.", "Beside it, Elspeth saw, Thorne was carrying the silver compass.")],
    add: [fact("Ida Thorne", "is carrying", "silver compass", 5, { kind: "possession", quote: "Beside it, Elspeth saw, Thorne was carrying the silver compass." })],
    match: [THORNE, ITEM],
  },
  {
    chapter: 1, description: "Crane is carrying Elspeth's compass while it is in her pocket.",
    edits: [ins(1, "Crane had not moved from his seat.", "Elspeth's silver compass was in his hand; she had no idea how he had come by it.")],
    add: [fact("Absalom Crane", "carrying", "silver compass", 1, { until: 1, quote: "Elspeth's silver compass was in his hand" })],
    match: [CRANE, ITEM],
  },
  {
    chapter: 5, description: "The iron key hangs from Thorne's belt while Elspeth holds it (item-first 'bearer').",
    edits: [ins(5, "She tucked the ledger inside her cloak.", "Elspeth's iron key hung from Thorne's belt as well, though Elspeth had never given it to her.")],
    add: [fact("iron key", "bearer", "Ida Thorne", 5, { quote: "Elspeth's iron key hung from Thorne's belt as well" })],
    match: [THORNE, ITEM],
  },
]);

const NINE = { subject: "Elspeth Marrow", predicate: "money", object: "9 shillings", validFromChapter: 2 } as const;
const SEVEN = { subject: "Elspeth Marrow", predicate: "money", object: "7 shillings", validFromChapter: 4 } as const;
const TWELVE = { subject: "Elspeth Marrow", predicate: "money", object: "12 shillings", validFromChapter: 1 } as const;
const ROOM = "Elspeth paid him three shillings for the room and their supper, which left her nine.";
const SMITH = "The smith wanted two shillings for the pair, and she paid him, which left her seven.";

export const negativeResourceMutator: Mutator = mutator("continuity/negative-resource", "A tracked resource goes below zero.", () => [
  {
    chapter: 2, description: "Elspeth pays fifteen shillings at the Heron with twelve in her purse.",
    edits: [rewrite(2, ROOM, "Elspeth paid him fifteen shillings for the room and their supper.")],
    change: [{ target: NINE, set: { object: "-3 shillings", evidence: { quote: "Elspeth paid him fifteen shillings for the room and their supper." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 4, description: "Elspeth pays the smith eleven shillings with nine.",
    edits: [rewrite(4, SMITH, "The smith wanted eleven shillings for the pair, and she paid him.")],
    change: [{ target: SEVEN, set: { object: "-2 shillings", evidence: { quote: "The smith wanted eleven shillings for the pair, and she paid him." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 4, description: "As above, recorded under predicate 'shillings' with a resource label.",
    edits: [rewrite(4, SMITH, "The smith wanted eleven shillings for the pair, and she paid him.")],
    change: [{ target: SEVEN, set: { predicate: "shillings", object: "-2", evidence: { quote: "The smith wanted eleven shillings for the pair, and she paid him." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 4, description: "As above, recorded as 'purse · -2 shillings' with no label (unit outside the resource vocabulary).",
    edits: [rewrite(4, SMITH, "The smith wanted eleven shillings for the pair, and she paid him.")],
    change: [{ target: SEVEN, set: { predicate: "purse", object: "-2 shillings", kind: undefined, evidence: { quote: "The smith wanted eleven shillings for the pair, and she paid him." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 5, description: "Jonas pays ten pennies for the licence out of six pennies earned.",
    edits: [rewrite(5, "\"Two pennies each,\" he said. \"Six pennies. I am a man of business.\"", "\"Two pennies each,\" he said. \"Six pennies, and I paid the vicar ten for the licence. I am a man of business.\"")],
    change: [{ target: { subject: "Jonas Marrow", predicate: "money", object: "6 pennies", validFromChapter: 5 }, set: { object: "-4 pennies", evidence: { quote: "Six pennies, and I paid the vicar ten for the licence." } } }],
    match: [JONAS, MONEY],
  },
  {
    chapter: 1, description: "Elspeth pays a fourteen-shilling bill with twelve ('minus 2 shillings').",
    edits: [rewrite(1, "That night Elspeth sat by the window of their cottage and counted her twelve shillings twice.", "That night Elspeth paid the doctor's old bill of fourteen shillings and sat by the window of their cottage counting what was left.")],
    change: [
      { target: TWELVE, set: { validUntilChapter: 0 } },
      { target: { subject: "Elspeth Marrow", predicate: "location", object: "Marrow cottage, Wenlow", validFromChapter: 1 }, set: { evidence: { quote: "sat by the window of their cottage" } } },
    ],
    add: [fact("Elspeth Marrow", "money", "minus 2 shillings", 1, { until: 1, kind: "resource", quote: "That night Elspeth paid the doctor's old bill of fourteen shillings" })],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 2, description: "Thorne spends five shillings more than she has on a horse ('coins').",
    edits: [ins(2, "Captain Thorne was indeed already in Stavely.", "She had spent every coin she had on the hired horse, and five shillings more than that.")],
    add: [fact("Ida Thorne", "coins", "-5 shillings", 2, { quote: "She had spent every coin she had on the hired horse, and five shillings more than that." })],
    match: [THORNE, MONEY],
  },
  {
    chapter: 3, description: "Elspeth pays the nurse ten shillings out of nine.",
    edits: [ins(3, "The parish nurse let them in.", "Elspeth paid her ten shillings for a week of nursing, there and then.")],
    change: [{ target: NINE, set: { validUntilChapter: 2 } }],
    add: [fact("Elspeth Marrow", "money", "-1 shillings", 3, { until: 3, kind: "resource", quote: "Elspeth paid her ten shillings for a week of nursing, there and then." })],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 2, description: "Elspeth pays fifteen at the Heron, recorded as 'remaining money · −3 shillings' (Unicode minus).",
    edits: [rewrite(2, ROOM, "Elspeth paid him twelve shillings for the room, and three more for their supper.")],
    change: [{ target: NINE, set: { predicate: "remaining money", object: "−3 shillings", kind: undefined, evidence: { quote: "Elspeth paid him twelve shillings for the room, and three more for their supper." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 4, description: "Elspeth pays fourteen to the smith, recorded as 'savings · -5 shillings'.",
    edits: [rewrite(4, SMITH, "The smith wanted fourteen shillings for the pair, and she paid him.")],
    change: [{ target: SEVEN, set: { predicate: "savings", object: "-5 shillings", kind: undefined, evidence: { quote: "The smith wanted fourteen shillings for the pair, and she paid him." } } }],
    match: [ELSPETH, MONEY],
  },
  {
    chapter: 2, description: "Elspeth overspends at the Heron, recorded as prose ('in debt by 3 shillings'), which no number parser reads.",
    edits: [rewrite(2, ROOM, "Elspeth paid him fifteen shillings for the room and their supper, three more than she had.")],
    change: [{ target: NINE, set: { object: "in debt by 3 shillings", evidence: { quote: "Elspeth paid him fifteen shillings for the room and their supper, three more than she had." } } }],
    match: [ELSPETH, MONEY],
  },
]);

export const singleValuedConflictMutator: Mutator = mutator("continuity/single-valued-conflict", "A character has two ages, or is both alive and dead, in the same chapter.", () => [
  {
    chapter: 4, description: "Jonas is seventeen in ch4 while still sixteen.",
    edits: [ins(4, "Jonas went ahead with the compass.", "He was seventeen now, or said he was, and walked like it.")],
    add: [fact("Jonas Marrow", "age", "17", 4, { kind: "age", quote: "He was seventeen now" })],
    match: [JONAS, AGE],
  },
  {
    chapter: 2, description: "Crane is sixty-eight in ch2 while seventy-one.",
    edits: [ins(2, "Absalom Crane is ill.", "He is only sixty-eight, but the river has worn him out.")],
    add: [fact("Absalom Crane", "age", "68", 2, { kind: "age", quote: "He is only sixty-eight" })],
    match: [CRANE, AGE],
  },
  {
    chapter: 4, description: "Thorne is forty in ch1 and forty-five in ch4.",
    edits: [
      ins(1, "She had a weathered face and grey eyes that did not blink much.", "She was forty years old."),
      ins(4, "Captain Ida Thorne stood in the doorway with the mist behind her.", "She looked every one of her forty-five years."),
    ],
    add: [
      fact("Ida Thorne", "age", "40", 1, { kind: "age", quote: "She was forty years old." }),
      fact("Ida Thorne", "age", "45 years old", 4, { kind: "age", quote: "She looked every one of her forty-five years." }),
    ],
    match: [THORNE, AGE],
  },
  {
    chapter: 2, description: "Rook is fifty and fifty-eight in the same chapter (current age).",
    edits: [
      ins(2, "The innkeeper was a heavy, careful man named Rook, who wiped every coin before he took it.", "He was fifty, he said, and had kept the Heron for thirty years."),
      ins(2, "Rook nodded slowly.", "Fifty-eight years he had lived by that river."),
    ],
    add: [
      fact("Rook", "current age", "50", 2, { quote: "He was fifty, he said" }),
      fact("Rook", "age", "58", 2, { quote: "Fifty-eight years he had lived by that river." }),
    ],
    match: [ROOK, AGE],
  },
  {
    chapter: 4, description: "The smith says Crane is alive in ch4 while his death stands.",
    edits: [ins(4, "Before they left, Elspeth went to the smithy and bought a spade and a lantern.", "The smith said Absalom Crane was alive and well and asking after them.")],
    add: [fact("Absalom Crane", "status", "alive", 4, { kind: "status", quote: "The smith said Absalom Crane was alive and well" })],
    match: [CRANE, LIFE],
  },
  {
    chapter: 2, description: "Rook says Tobias is alive in ch2 ('alive · true').",
    edits: [ins(2, "\"Our father,\" said Jonas.", "Rook looked surprised. \"Tobias? But he is alive. He drinks here every Friday.\"")],
    add: [fact("Tobias Marrow", "alive", "true", 2, { quote: "Tobias? But he is alive." })],
    match: [TOBIAS, LIFE],
  },
  {
    chapter: 5, description: "Jonas is seventeen in ch5 (GLM 'years old', labelled age).",
    edits: [ins(5, "Jonas was sitting in the stern.", "At seventeen he was the youngest ferryman the Lune had ever had.")],
    add: [fact("Jonas Marrow", "years old", "17", 5, { kind: "age", quote: "At seventeen he was the youngest ferryman the Lune had ever had." })],
    match: [JONAS, AGE],
  },
  {
    chapter: 3, description: "Jonas is 'seventeen' in ch3, written as a word, which the age reader does not parse.",
    edits: [ins(3, "Jonas stood at the foot of it with his cap in his hands.", "He was seventeen that week.")],
    add: [fact("Jonas Marrow", "age", "seventeen", 3, { kind: "age", quote: "He was seventeen that week." })],
    match: [JONAS, AGE],
  },
  {
    chapter: 1, description: "Crane is seventy-five in the same chapter he is seventy-one.",
    edits: [ins(1, "He had three passengers that morning.", "Not bad, Elspeth thought, for a man of seventy-five.")],
    add: [fact("Absalom Crane", "age", "75 years", 1, { kind: "age", quote: "Not bad, Elspeth thought, for a man of seventy-five." })],
    match: [CRANE, AGE],
  },
  {
    chapter: 5, description: "Crane, living and well, attends his own burial ('condition · living').",
    edits: [ins(5, "Half the village came.", "Absalom Crane, living and well, came with them to watch.")],
    add: [fact("Absalom Crane", "condition", "living", 5, { quote: "Absalom Crane, living and well, came with them to watch." })],
    match: [CRANE, LIFE],
  },
  {
    chapter: 4, description: "Tobias's letter shows he is alive in ch4 ('life status · alive').",
    edits: [ins(4, "She did not read it. She could not, not there.", "It was dated last spring. Tobias Marrow was alive.")],
    add: [fact("Tobias Marrow", "life status", "alive", 4, { quote: "Tobias Marrow was alive." })],
    match: [TOBIAS, LIFE],
  },
]);

export const currentMutators: ReadonlyArray<Mutator> = [
  deadEntityActsMutator, deadThenAliveMutator, twoPlacesAtOnceMutator, itemTwoHoldersMutator, negativeResourceMutator, singleValuedConflictMutator,
];
