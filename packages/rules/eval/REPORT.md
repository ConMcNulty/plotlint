# Seeded-error evaluation

Generated 2026-10-28T04:56:07.356Z by `pnpm --filter @plotlint/rules eval` (see "How to run" below). Book: `wenlow + thornbury`, 9 clean chapters, 340 mutants.

Phase 3 gate (PLAN.md): recall and false-alarm rate per rule, and each rule beats the LLM-only auditor on false positives. Phase 4 adds the structural (L4), genre-pack and prose-metric (L2) rules, scored the same way; the auditor was run on the continuity mutants only, so its columns are empty for the rest.

## Per rule

| Rule | Mutants | Recall | Clean findings (per ch) | Collateral (per other mutant) | Auditor recall (strict) | Auditor clean issues per ch: all / on topic | Fewer FPs than auditor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dead-entity-acts` | 11 | 11/11 (100%) | 0 (0.00) | 0 (0.00) | 3/4 75% (75%) | 0.07 / 0.07 | yes |
| `dead-then-alive` | 11 | 11/11 (100%) | 0 (0.00) | 0 (0.00) | 2/4 50% (50%) | 0.07 / 0.07 | yes |
| `two-places-at-once` | 11 | 11/11 (100%) | 0 (0.00) | 0 (0.00) | 1/4 25% (25%) | 0.07 / 0.00 | yes |
| `item-two-holders` | 11 | 11/11 (100%) | 0 (0.00) | 0 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `negative-resource` | 11 | 9/11 (82%) | 0 (0.00) | 0 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `single-valued-conflict` | 11 | 11/11 (100%) | 0 (0.00) | 0 (0.00) | 1/4 25% (25%) | 0.07 / 0.07 | yes |
| `item-from-nowhere` | 10 | 6/10 (60%) | 0 (0.00) | 0 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `world-rule-broken` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `knowledge-leak` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `impossible-travel` | 10 | 10/10 (100%) | 0 (0.00) | 0 (0.00) | 1/4 25% (25%) | 0.07 / 0.00 | yes |
| `timeline-order` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | 3/4 75% (75%) | 0.07 / 0.00 | yes |
| `invariant` | 10 | 10/10 (100%) | 0 (0.00) | 1 (0.00) | 0/4 0% (0%) | 0.07 / 0.00 | yes |
| `structure/unpaid-setup` | 12 | 12/12 (100%) | 0 (0.00) | 1 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/unearned-payoff` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/cut-candidate` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/open-questions` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/subplot-balance` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/scene-turn` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/goal-conflict-outcome` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/protagonist-agency` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/tension-curve` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/pov-discipline` | 10 | 10/10 (100%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `structure/fair-play` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / – | yes |
| `structure/hopeful-ending` | 10 | 8/10 (80%) | 0 (0.00) | 0 (0.00) | – | 0.07 / – | yes |
| `structure/central-relationship` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / – | yes |
| `structure/both-leads-pov` | 10 | 10/10 (100%) | 0 (0.00) | 0 (0.00) | – | 0.07 / – | yes |
| `style/invented-term-spelling` | 11 | 9/11 (82%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `metrics/repeated-phrase` | 10 | 9/10 (90%) | 2 (0.22) | 0 (0.00) | – | 0.07 / 0.00 | no |
| `metrics/lexical-diversity` | 10 | 10/10 (100%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `metrics/sentence-rhythm` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `metrics/dialogue-ratio` | 11 | 9/11 (82%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `metrics/sensory-detail` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |
| `metrics/wall-of-text` | 10 | 9/10 (90%) | 0 (0.00) | 0 (0.00) | – | 0.07 / 0.00 | yes |

All rules: 303/340 mutants caught (89%), 2 findings on the clean book, 2 collateral findings over 340 mutants.
Auditor (`glm-4.5-flash`): 1 issues over 15 clean chapter audits (0.07 per chapter, 3 runs per chapter); recall 11/48 (23%), strict 11/48; 0 audits failed after retries and are left out.

## Findings on the clean book

- `metrics/repeated-phrase` ch3: "the river went past" recurs in 3 chapters
- `metrics/repeated-phrase` ch5: "the river went past" recurs in 3 chapters

## Misses

Mutants the seeded rule did not report in the mutant's chapter. Most are deliberate: free-form predicates or values outside the rule's vocabulary, kept so recall reflects what a real settler writes.

- `negative-resource/4` (ch4): As above, recorded as 'purse · -2 shillings' with no label (unit outside the resource vocabulary).
- `negative-resource/11` (ch2): Elspeth overspends at the Heron, recorded as prose ('in debt by 3 shillings'), which no number parser reads.
- `item-from-nowhere/5` (ch1): Thorne reads the ledger Crane keeps under his seat.
- `item-from-nowhere/6` (ch5): Elspeth writes in the ledger she has just given to Thorne.
- `item-from-nowhere/7` (ch3): Jonas lights the lantern that is only bought in ch4.
- `item-from-nowhere/8` (ch3): Elspeth digs with the spade that is only bought in ch4.
- `world-rule-broken/8` (ch5): Jonas (not the ferry) carries five across ('Jonas Marrow · carried · 5 passengers across the Lune').
- `world-rule-broken/9` (ch1): The ferry comes in with four passengers ('passenger count').
- `knowledge-leak/5` (ch2): Thorne, who is never told, means to dig under the third flagstone in ch2.
- `knowledge-leak/10` (ch2): Jonas draws the abbey chapel floor and marks the third flagstone in ch2.
- `timeline-order/7` (ch5): Ch5 is dated '3 Oct', with no year (the time parser reads no date without a year).
- `timeline-order/9` (ch5): Ch5 is dated 'the third day of October' under the predicate 'day' (free-form, no year).
- `unearned-payoff/9` (ch5): Expected miss: the strongbox question (opened ch2) is answered in ch5 with nothing in between; spotting the gap needs chapter summaries.
- `unearned-payoff/10` (ch5): Expected miss: the break-in (ch4) is explained in ch5, one chapter on, which the rule allows.
- `cut-candidate/9` (ch2): Expected miss: the appended scene's object, a lantern, happens to be named again in ch4, so it reads as depended on.
- `cut-candidate/10` (ch3): Expected miss: the appended scene's fact has no evidence quote, so it cannot be placed in the scene and counts for the whole chapter.
- `open-questions/10` (ch3): Expected miss: everything is answered in ch3, but the settler leaves the hooks 'progressing', so the ledger still reads them as open.
- `subplot-balance/9` (ch2): Expected miss: GLM-style rows 'hook-12' and 'hook-13' name no character and are not linked, so they form no subplot.
- `subplot-balance/10` (ch1): Expected miss: a Thorne thread (two hooks naming her) is dropped after ch1, but Thorne herself is on the page in every chapter, so it reads as alive.
- `scene-turn/9` (ch1): Expected miss: ch1–3 flat, but the annotator names the end on another axis ('truth' to 'trust'), so the scenes read as turning.
- `scene-turn/10` (ch1): Expected miss: ch1–4 flat, but the annotator leaves ch3's end value blank, which breaks the run into two short ones.
- `goal-conflict-outcome/9` (ch1): Expected miss: ch1–2 have no goal, but the annotator writes 'none' instead of leaving the field empty.
- `goal-conflict-outcome/10` (ch2): Expected miss: nothing in the way in ch2–3, which the annotator words as an opposition ('nothing stands in her way').
- `protagonist-agency/10` (ch4): Expected miss: Thorne decides ch4, but the annotator records no turning point for ch3, leaving four (fewer than the five the rule needs).
- `tension-curve/10` (ch3): Expected miss: the peak is Crane's deathbed in ch3, three-fifths of the way, just at the rule's cut-off.
- `fair-play/10` (ch4): Expected miss: no clues before the reveal, which GLM words 'was responsible for the death of', outside the reveal vocabulary.
- `hopeful-ending/9` (ch4): Expected miss: GLM records Nell as 'single again', naming no one, so the fact is not about the couple.
- `hopeful-ending/10` (ch4): Expected miss: 'feelings for Tom Hale · cooled' reads as neither together nor ended.
- `central-relationship/10` (ch1): Expected miss: Tom's part in ch1 goes to Will Pryce, but Tom is named in passing ('Tom Hale's bicycle'), which counts as on the page.
- `invented-term-spelling/10` (ch2): Expected miss: 'Rooke' for Rook; names under five letters are too short to judge.
- `invented-term-spelling/11` (ch1): Expected miss: 'Throne' only at the start of a sentence, where any word is capitalised.
- `repeated-phrase/10` (ch3): Expected miss: "like a door swinging shut" in only two chapters (ch1, ch3).
- `sentence-rhythm/10` (ch4): Expected miss: only six nine-word sentences in a row, under the eight the rule looks for.
- `dialogue-ratio/10` (ch1): Expected miss: ch1 recast as speech but for its long first paragraph, which leaves 73% of its words in quotes, inside the band.
- `dialogue-ratio/11` (ch5): Expected miss: ch5 recast as speech; at 455 words it is under the 500 the rule needs to judge a chapter.
- `sensory-detail/10` (ch5): Expected miss: ch5 with every sensory word replaced; at 455 words it is under the 500 the rule needs to judge a chapter.
- `wall-of-text/10` (ch3): Expected miss: a 330-word paragraph of history, just under the ceiling.

## Collateral

New findings of other rules on a mutant. Some are true positives (one slip can break two rules, e.g. a death and an alive status at once); they are listed so each can be judged.

- `invariant` on `knowledge-leak/6` ch2: Invariant "Alderman Pask is not named before chapter 5." fails in chapter 2: the text says "Pask".
- `structure/unpaid-setup` on `subplot-balance/6` ch3: "Which member of the parish council paid to sink the Margery", opened in ch3, is never resolved by the last chapter (ch5).

## Auditor issues on the clean book

- clean:3:3 `PARISH_COUNCIL_THREAT`: Crane warns that one of the men who sank the Margery is still alive and serving on the parish council, creating an ongoing danger that needs to be addressed.

## Method

- **Corpus.** `eval/corpus/wenlow`: a five-chapter story written for the eval with no continuity errors, and `facts.json`, hand-written oracle facts in the shape InkOS's settler writes (free-form subject, predicate and object; validity; `kind`; an evidence quote that is verbatim in the chapter). `story/plotlint/` holds its travel graph and four approved author invariants, all true of the clean book. For the structural rules it also has `hooks.json`, the oracle hook ledger in InkOS's shape (the story's real setups and payoffs; the break-in left open on purpose and advanced in the last chapter), `story/plotlint/scenes.json`, the author's own scene annotations (`annotator: "author"`), `book.json` marking it finished at five chapters, and `story/plotlint/rules.json`, which sizes three rules for a five-chapter book (tension-curve `minChapters` 5 and `flatRun` 3, subplot-balance `gap` 2, goal-conflict-outcome `window` 3 and `minScenes` 2). Wenlow has no culprit the state unmasks and no couple, so `eval/corpus/thornbury`, a four-chapter village mystery with a romance written the same way, hosts fair play and the romance checks. Every rule's clean findings and collateral are measured on both books.
- **Clean findings.** The only ones are `metrics/repeated-phrase` on "the river went past", wenlow's refrain (ch2, ch3, ch5), which is deliberate: a writer would suppress them.
- **Mutants.** Each mutator (`src/eval/mutators/`) seeds one plausible slip per mutant into the prose (an inserted or rewritten sentence, so the auditor can see it) and into the facts as a settler would record it, and names the chapter it should be reported in. A mutator only runs when its rule id is registered. Structural mutants change the hook ledger or the scene annotations as a settler or annotator reading the mutated prose would; metric mutants change only the prose (a 600-word wall, twelve equal-length sentences, a chapter recast as speech, its sensory words replaced). Several mutants of each rule are written as a GLM-style settler or annotator would record them (bare hook ids, `none` for an empty field, free-form predicates), and some are expected misses, marked so in the list below.
- **Rule scores.** Rules run over the oracle facts with `checkSnapshot`, chapter text and book data. Recall: the seeded rule reports the mutant's chapter. False alarms: findings on the clean book, and collateral (other rules' new findings on a mutant). A seeded rule's findings in other chapters are echoes and not counted as false alarms. Rules that judge the whole book (protagonist agency, central relationship, both leads' POV) report no chapter, so any new finding of theirs catches their mutant. The L2 metric rules come from `@plotlint/metrics` (which depends on this package) and run on every chapter beside the state rules.
- **Auditor.** InkOS's `ContinuityAuditor` on each clean chapter (repeated, temperature 0.3) and on each mutant's chapter, with all earlier chapters as context. Free `glm-4.5-flash` manages about one audit a minute, so it audits an evenly spaced sample of each mutator's mutants (`--sample`, 4 by default; the recall column gives the count). Clean issues are its false positives; "on topic" counts only those matching a rule's topic words, a fairer per-rule comparison. A mutant is caught when an issue's summary or evidence has a word from each of the mutant's keyword groups (a name and a topic); strict recall leaves out mutants whose keywords also match the clean audit of that chapter.
- **Limits.** Two short books, written by the same hand as the mutants; structural recall on a five-chapter book says the mechanism works, not that its thresholds suit a novel (three rules are configured for the length); oracle facts, not a real settler's (extracted mode is not built yet), so rule recall here is an upper bound for the facts a settler gets right and a lower bound where it phrases them unusually. Keyword matching can over- or under-credit the auditor; its issues are listed in `report.json`.

## How to run

```
pnpm --filter @plotlint/metrics... build   # the rules and their dependencies, and the metric rules
cd packages/rules
node eval/run.mjs                      # rules only; reuses eval/auditor-results.json if present
node eval/run.mjs --auditor            # also run the auditor (needs INKOS_LLM_API_KEY; cached in eval/.cache/)
node eval/run.mjs --auditor --sample all --repeats 3 --concurrency 2
```
