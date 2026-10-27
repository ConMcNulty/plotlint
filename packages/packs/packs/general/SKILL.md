---
name: general
description: Plotlint's always-on check pack. Continuity, setup and payoff, cut test, POV discipline, AI-tell and cliché lists, loose prose-metric floors.
---

# General pack

Every book runs this pack. Genre packs layer on top of it and may loosen or tighten
any check here; your own `story/plotlint/rules.json` overrides both.

These checks are opinions with a source. Each one names where it comes from so you
can disagree with it: turn it off or down in `rules.json`, or suppress one finding
with a reason.

## Checks

| Check | Setting | Tradition |
| --- | --- | --- |
| `continuity/*` (dead characters acting, impossible travel, items from nowhere, knowledge leaks, timeline order, ledgers, world rules) | rule defaults | Continuity editing: the reader's trust depends on the world holding still when nobody moves it. |
| `structure/unpaid-setup` | warning | Chekhov's gun: "If in the first act you have hung a pistol on the wall, then in the following one it should be fired." |
| `structure/unearned-payoff` | warning | Setup and payoff (screenwriting craft, e.g. McKee, *Story*): a payoff the reader was not prepared for reads as a cheat. |
| `structure/pov-discipline` | warning | Limited-POV craft: the narration knows only what its viewpoint character can know. |
| `structure/cut-candidate` | note | The cut test (developmental editing): if nothing later depends on a scene, it may not be pulling its weight. Advisory only. |
| `structure/open-questions` | note | Narrative questions (Lee Child, "ask a question and delay the answer"): curiosity, not confusion. |
| `structure/subplot-balance` | note | Subplot boards (outlining practice): a thread that vanishes leaves a promise unkept. |
| `structure/scene-turn`, `structure/goal-conflict-outcome` | note | Scene and sequel (Dwight Swain, *Techniques of the Selling Writer*); value turns (McKee). Many good scenes break these, so they stay notes here. |
| `structure/protagonist-agency` | note | Active protagonist (screenwriting craft). Genres differ a lot here. |
| `structure/tension-curve` | note | Rising action (Freytag's pyramid). Judged, so it is only ever a note. |
| `style/invented-term-spelling` | note | The copyeditor's style sheet of names (*Chicago Manual of Style* 2.54): a rare spelling one or two letters, a hyphen or an apostrophe away from a name the book uses often ("Elpseth" for "Elspeth"), with a quick fix. The fantasy pack makes it a warning. |
| `structure/fair-play`, `structure/hopeful-ending`, `structure/central-relationship`, `structure/both-leads-pov` | off | Genre conventions, not general craft: the mystery and romance packs turn them on. |
| `style/general.*` | per rule | Filter words (Janet Burroway, *Writing Fiction*), clichés (Orwell, "Politics and the English Language"), AI-tell words (InkOS's own list), adverb clusters, intensifiers, redundancies. |

## Metric bands

Floors and bands, never targets: nothing rewards going further past a floor.

- `metrics/lexical-diversity` min 40 (MTLD): only very repetitive prose is flagged.
- `metrics/dialogue-ratio` 0.03 to 0.9: an almost dialogue-free or almost all-dialogue chapter.
- `metrics/wall-of-text` max 400 words per paragraph.

These are loose on purpose; genre packs narrow them.
