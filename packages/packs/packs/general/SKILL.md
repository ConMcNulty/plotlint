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
| `structure/pov-discipline` | note | Limited-POV craft (Browne and King, *Self-Editing for Fiction Writers*): the narration knows only what its viewpoint character can know. Judged by the scene annotator, so only ever a note. |
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

The bands are measured, about the 5th to 95th percentile of the chapters of four
public-domain novels (Austen's *Emma*, Dickens's *Great Expectations*, Wharton's
*The Age of Innocence* and *The House of Mirth*; `baselines/general.json` in
`@plotlint/metrics`), so about one chapter in twenty of those books falls outside each:

- `metrics/lexical-diversity` min 71 (MTLD).
- `metrics/sentence-rhythm` sentence-length CV min 0.54; a flat stretch is 8 sentences with CV under 0.14.
- `metrics/dialogue-ratio` 0.05 to 0.71: an almost dialogue-free or almost all-dialogue chapter.
- `metrics/sensory-detail` min 4.4 sensory words per 1,000.
- `metrics/wall-of-text` max 427 words per paragraph.
- `metrics/predictability` min -2.5, window 5 sentences: a stretch of five or more sentences whose
  words are far easier to guess than the book's usual prose (robust z of its surprisal below -2.5).
  Stock phrasing, or a description or exchange reused from other chapters. Surprisal comes from a
  word trigram model with Kneser-Ney smoothing trained on the book's other chapters (Kneser and Ney
  1995; surprisal after Hale 2001 and Levy 2008), so it measures predictability relative to this
  book, not to English. Options in `rules.json`: `min`, `window`, `minWindowWords` (40),
  `minWords` (300 per chapter), `minChapters` (3).

Genre packs set their own bands where their genre's reference books measure differently.

## Scene annotations

`structure/scene-turn`, `structure/goal-conflict-outcome`, `structure/protagonist-agency`,
`structure/tension-curve` and `structure/pov-discipline` read `story/plotlint/scenes.json`,
which `inkos lint annotate` fills in with the configured model (POV, goal, opposition,
outcome, value at start and end, turning point, stakes, viewpoint breaks, each with a
quoted passage). They are silent until the book is annotated. Correct any entry by hand
and set its `annotator` to `"author"`; re-annotating never overwrites it. Options, in
`rules.json`: `scene-turn` `minRun` (3); `goal-conflict-outcome` `window` (5 chapters),
`maxMissingShare` (0.5), `minScenes` (4); `protagonist-agency` `minShare` (0.3),
`minTurningPoints` (5), and `protagonist` in scenes.json; `tension-curve` `flatRun` (5),
`flatBand` (1), `minChapters` (8), `earlyPeak` (0.6), `finished`.
