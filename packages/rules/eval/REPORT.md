# Seeded-error evaluation

Generated 2026-10-27T19:14:01.331Z by `pnpm --filter @plotlint/rules eval` (see "How to run" below). Book: `wenlow`, 5 clean chapters, 126 mutants.

Phase 3 gate (PLAN.md): recall and false-alarm rate per rule, and each rule beats the LLM-only auditor on false positives.

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
| `invariant` | 10 | 10/10 (100%) | 0 (0.00) | 1 (0.01) | 0/4 0% (0%) | 0.07 / 0.00 | yes |

All rules: 114/126 mutants caught (90%), 0 findings on the clean book, 1 collateral findings over 126 mutants.
Auditor (`glm-4.5-flash`): 1 issues over 15 clean chapter audits (0.07 per chapter, 3 runs per chapter); recall 11/48 (23%), strict 11/48; 0 audits failed after retries and are left out.

## Findings on the clean book

None.

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

## Collateral

New findings of other rules on a mutant. Some are true positives (one slip can break two rules, e.g. a death and an alive status at once); they are listed so each can be judged.

- `invariant` on `knowledge-leak/6` ch2: Invariant "Alderman Pask is not named before chapter 5." fails in chapter 2: the text says "Pask".

## Auditor issues on the clean book

- clean:3:3 `PARISH_COUNCIL_THREAT`: Crane warns that one of the men who sank the Margery is still alive and serving on the parish council, creating an ongoing danger that needs to be addressed.

## Method

- **Corpus.** `eval/corpus/wenlow`: a five-chapter story written for the eval with no continuity errors, and `facts.json`, hand-written oracle facts in the shape InkOS's settler writes (free-form subject, predicate and object; validity; `kind`; an evidence quote that is verbatim in the chapter). `story/plotlint/` holds its travel graph and four approved author invariants, all true of the clean book.
- **Mutants.** Each mutator (`src/eval/mutators/`) seeds one plausible slip per mutant into the prose (an inserted or rewritten sentence, so the auditor can see it) and into the facts as a settler would record it, and names the chapter it should be reported in. A mutator only runs when its rule id is registered.
- **Rule scores.** Rules run over the oracle facts with `checkSnapshot`, chapter text and book data. Recall: the seeded rule reports the mutant's chapter. False alarms: findings on the clean book, and collateral (other rules' new findings on a mutant). A seeded rule's findings in other chapters are echoes and not counted as false alarms.
- **Auditor.** InkOS's `ContinuityAuditor` on each clean chapter (repeated, temperature 0.3) and on each mutant's chapter, with all earlier chapters as context. Free `glm-4.5-flash` manages about one audit a minute, so it audits an evenly spaced sample of each mutator's mutants (`--sample`, 4 by default; the recall column gives the count). Clean issues are its false positives; "on topic" counts only those matching a rule's topic words, a fairer per-rule comparison. A mutant is caught when an issue's summary or evidence has a word from each of the mutant's keyword groups (a name and a topic); strict recall leaves out mutants whose keywords also match the clean audit of that chapter.
- **Limits.** One book, written by the same hand as the mutants; oracle facts, not a real settler's (extracted mode is not built yet), so rule recall here is an upper bound for the facts a settler gets right and a lower bound where it phrases them unusually. Keyword matching can over- or under-credit the auditor; its issues are listed in `report.json`.

## How to run

```
pnpm --filter @actalk/inkos-core --filter @plotlint/diagnostics --filter @plotlint/rules build
cd packages/rules
node eval/run.mjs                      # rules only; reuses eval/auditor-results.json if present
node eval/run.mjs --auditor            # also run the auditor (needs INKOS_LLM_API_KEY; cached in eval/.cache/)
node eval/run.mjs --auditor --sample all --repeats 3 --concurrency 2
```
