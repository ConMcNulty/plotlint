---
name: mystery
description: Check pack for mystery and detective fiction. Tightens knowledge leaks, timeline order and setup/payoff toward fair play, and checks that the culprit appears early and the solution is clued before the reveal.
---

# Mystery pack

For whodunits, procedurals, cozies and noir. Stacks on the general pack. Where it
conflicts with another selected pack the stricter setting wins; your `rules.json`
overrides both.

## What it tightens, and why

| Check | Setting | Tradition |
| --- | --- | --- |
| `continuity/knowledge-leak` | error | Fair play (Ronald Knox's "Decalogue", 1929; S. S. Van Dine's "Twenty Rules", 1928): the detective may not act on information the reader has not been given. A character acting on a secret before learning it is the commonest fair-play break. |
| `continuity/timeline-order` | error | Alibi logic (Golden Age puzzle tradition, Christie, Crofts): a solution that rests on times needs a timeline that holds. |
| `structure/unpaid-setup` | error | Knox and Van Dine again: every clue planted is a promise; a mystery that plants and drops clues frustrates the reader who played along. |
| `structure/unearned-payoff` | error | "The culprit must be someone mentioned early" (Knox, rule 1): a solution with no earlier setup breaks fair play. |
| `structure/fair-play` | warning | Knox's Decalogue rule 1 ("the criminal must be someone mentioned in the early part of the story") and Van Dine's rules 1 and 15 (the reader has an equal chance to solve it; the clues are all there). From the story state it finds the reveal (facts such as "is the killer", "murdered by", "true identity", in the chapter a mystery hook resolves) and warns when the culprit first appears after the first third of the book (option `culpritBy`: a fraction of the book, or a number of chapters before the reveal), or when nothing before the reveal links the culprit to what the solution rests on: "solution rests on information first given in the reveal chapter". |
| `structure/open-questions` | warning | The mystery is a question held open; long stretches with nothing unresolved lose the reader. |
| `metrics/dialogue-ratio` | min 0.1 | Interrogation and interview carry the genre; a near-silent chapter is worth a look. |
| `style/mystery.Cliches` | note | Genre stock phrases ("the game is afoot"), fine once as pastiche. |

## Planned

These need rule functions that come in a later wave; they are listed so you know what
the pack will add:

Fair play (clue before reveal, culprit introduced early) is now `structure/fair-play` above.

- **No solution by coincidence**: the solving step rests on a deduction from clues, not luck or a confession out of nowhere.
- **Red herrings explained**: each false lead is resolved before the end.
