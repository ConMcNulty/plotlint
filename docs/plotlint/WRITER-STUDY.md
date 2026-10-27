# Writer study

The phase 4 gate reads: *accept rate per check, and no check rejected more than half the time stays on by default.* This document is the protocol for that study and for the per-book safeguard behind it (PLAN.md, "Human verdicts close the loop"): how verdicts are recorded, who takes part, what counts as accepting or rejecting a finding, how much data a check needs, how the default-off decision is made and recorded, and how verdict data is kept private.

## What is recorded

Every time a writer acts on a finding, plotlint appends one line to the book's verdict log, `works/<id>/source/story/plotlint/verdicts.jsonl`:

```json
{"ruleId":"style/general.Cliches","fingerprint":"9f2c41d07a3be815","chapter":3,"verdict":"rejected","action":"intentional","at":"2026-10-27T14:02:11.000Z","quote":"at the end of the day","layer":"style","confidence":"deterministic"}
```

| Field | Meaning |
| --- | --- |
| `ruleId` | The check. |
| `fingerprint` | `diagnosticFingerprint` of the finding (rule, chapter, evidence, quotes, facts; never offsets), the same id that suppressions use. |
| `chapter` | Where the finding was, when it has a chapter. |
| `verdict` | `accepted` or `rejected`. |
| `action` | What the writer did (table below). It decides the verdict; a line where the two disagree is invalid. |
| `at` | When, in ISO 8601. |
| `author` | Optional, who decided (the CLI's `--author`). |
| `quote` | The flagged text or the finding's summary, at most 500 characters, so the file reads well to a human. |
| `layer`, `confidence` | Copied from the finding, so reports can be split by layer and by deterministic, extracted or judged. |

The schema is `VerdictSchema` in `@plotlint/diagnostics/verdicts`; `@plotlint/diagnostics/node` has `loadVerdicts` and `appendVerdicts`. The file is append-only JSON lines: Studio, the CLI and agents only ever add whole lines, a crash can tear at most the last line, and the reader skips lines it cannot parse (reporting their numbers) instead of failing. CRLF line ends, as an editor on Windows may leave them, are fine.

### What counts as accept and reject

| Action | Verdict | Where it comes from |
| --- | --- | --- |
| `fix` | accepted | The writer applied a quick fix from the hover card. |
| `edited` | accepted | The writer typed inside the flagged text and the next re-lint no longer finds it. Studio judges this conservatively: the finding must have been edited into (not just moved), the re-lint must drop it, and no finding of the same check, nor one with the same fingerprint, may now sit on or touch that text. Deleting the flagged text outright, or rewording so the check fires on the next word, is not counted. Each finding counts as edited at most once per editor session. |
| `intentional` | rejected | "Mark as intentional" (an instance suppression with a reason). |
| `not-useful` | rejected | "Not useful" on the hover card. The finding is also hidden for the rest of the session, without a suppression. |
| `dismissed` | rejected | A rejection without a reason; the default for `inkos lint verdict reject`. |

Turning a whole check off for a book (a rule suppression or `rules.json`) is not a verdict: it says nothing about any one finding. Findings the writer never touches are not verdicts either; the study measures what writers do with findings, not what they scroll past.

### One finding, one vote

Writers change their mind. Every report counts only the **latest verdict per check and fingerprint** (by `at`, ties to the later line): a finding marked intentional and later fixed counts once, as accepted. Older lines stay in the file as history.

## Protocol

1. **Recruit writers.** Aim for at least eight writers across at least three of the genres the packs cover (general, mystery, romance, fantasy), each with a manuscript of their own in English of at least 20,000 words. Writers of draft manuscripts are better subjects than writers of finished, edited books, since a check's job is to find what is still there to fix. Record each writer's genre and experience (first book, published) in the study notes, not in the project.
2. **Import.** Each writer imports their own manuscript into a fresh InkOS project on their own machine (`inkos import`), so the story state, findings and verdicts are theirs. Settle the state with the configured model so the continuity checks run too.
3. **Work in Studio.** Each writer does at least **five revision sessions of 30 minutes or more** in Studio's chapter editor, spread over at least a week, with every check at its pack default. Tell them only this: *fix what you want to fix, mark what is deliberate as intentional, and press "Not useful" on anything that wastes your time.* Do not explain individual checks, do not ask them to process every finding, and do not review their verdicts during the study.
4. **No tuning mid-study.** Do not change check wording, severities or packs while the study runs; a change splits the sample. If a check is broken (crashes, floods a chapter), note it, fix it, and start that check's count again from the fix.
5. **Collect.** At the end, each writer runs `inkos lint study --all --json` in their own project and sends the output, and, only if they agree, their `verdicts.jsonl` files (see Privacy).

### Minimum sample

A check needs at least **20 standing verdicts pooled over all writers** before the gate decides anything about it (`inkos lint study --min 20`, the default). Below that it is *not enough data*: it keeps its current default, and the study report says so. With 20 verdicts the 95% interval on the reject rate is still about plus or minus 20 points, so the report also says whether a decision is **settled**: the whole interval is on the decision's side of 50%. An unsettled "turn off" or "stays on" is a decision taken on the point estimate, and should be revisited with more data.

Pooling counts every verdict equally, so a writer with many verdicts on one check weighs more than a writer with few. The JSON report gives the number of books with verdicts on each check (`books`); a check where one book holds most of the verdicts should be called out in the decision.

## The decision

For each check the pooled standing verdicts give accepted, rejected, `n`, the accept rate and the reject rate with its 95% Wilson interval. The gate, `studyReport` in `@plotlint/diagnostics/verdicts`:

- `n` below the minimum: **not enough data**.
- reject rate **above 50%**: **turn off by default (rejected > 50%)**. Exactly half is not more than half and stays on.
- otherwise: **stays on**.

`studyDefaults` returns just the checks to turn off. A check turned off by default is not deleted: it stays in its pack, off, and writers or a genre pack can turn it back on in `rules.json`.

### Recording the decision

The decision goes in the general pack (or the genre pack the check belongs to), as a change reviewed like any other rule change:

1. Set the check to `off` in the pack's default settings, with a note citing the study: the date, `n`, the reject rate and its interval, and the number of writers, for example `off: writer study 2026-11, n=34, rejected 71% (54%-83%), 7 writers`.
2. Commit the pooled report (`inkos lint study --all --json` output merged across writers, with book ids replaced by `writer-1`, `writer-2`, ...) to `docs/plotlint/study/<date>.json`. It holds counts per check only, no text.
3. Add a line to the phase 4 status in PLAN.md with the checks turned off and the checks still short of data.

A check that stays on but is close (reject rate above 40%, or unsettled) is a candidate for rewording or tighter matching before the next round, not for turning off.

## The per-book safeguard

The same verdicts lower checks for the one book where the author keeps rejecting them, without waiting for a study. `adaptiveOverlay(verdicts, { minVerdicts = 5, rejectAbove = 0.5 })` in `@plotlint/rules` (and `loadAdaptiveOverlay(bookDir)` in `@plotlint/rules/node`) returns a `rules.json`-shaped overlay:

1. With at least `minVerdicts` (5) standing verdicts on a check and more than half of them rejecting it, the check's findings become **notes**.
2. With at least `offAfter` (three times `minVerdicts`, so 15) standing verdicts, more than half still rejecting it, **and** more than half of the most recent `minVerdicts` rejecting it too (the author kept rejecting it after it became a note), the check is turned **off** for that book.

It never raises a severity. It lifts on its own while the check still runs: when the author starts accepting findings again and the reject rate falls to half or below, the check drops out of the overlay. The overlay sits between the pack defaults and the book's own `rules.json`, so an explicit setting there always wins and is the way to undo it. `inkos lint study <book-id>` lists what the overlay lowers in that book.

## Privacy

- Verdict files stay in the writer's project, next to their manuscript, and are never uploaded by plotlint, Studio or the CLI. There is no telemetry.
- A verdict line quotes up to 500 characters of the writer's text. The pooled report (`inkos lint study --json`) holds only counts per check, so that is what writers send by default. Raw `verdicts.jsonl` files are shared only if the writer chooses to, and they can strip the `quote` and `author` fields first.
- Writers can read, edit or delete their verdict file at any time; deleting it resets the per-book overlay for that book.
- Study notes (genre, experience) are kept apart from verdict data and refer to writers by number.

## Running the report

Record a verdict from the command line (agents use this too); fingerprints are in `inkos lint --json` and `inkos lint --verbose`:

```
inkos lint verdict accept 9f2c41d07a3be815 my-book --action fix
inkos lint verdict reject 9f2c41d07a3be815 my-book --action not-useful
inkos lint verdict accept 9f2c41d07a3be815 my-book --rule style/general.Cliches --chapter 3   # a finding already fixed
```

`accept` defaults to `--action edited` and `reject` to `--action dismissed`. A fingerprint that is no longer in the book (the writer already fixed it) needs `--rule`.

Report one book or the whole project:

```
inkos lint study my-book
inkos lint study --all
inkos lint study --all --json --min 20 --reject-above 0.5
```

```
3 books: 61 verdicts on 4 checks; a check needs 20 to decide
  check                        books   n  accept  reject (95% CI)  verdict
  mechanics/harper                 3  24     88%      13% (4%-31%)  stays on
  style/general.Cliches            3  27      7%     93% (77%-98%)  turn off by default (rejected > 50%)
  style/general.FilterWords        2   8     50%     50% (22%-78%)  not enough data
  style/general.Intensifiers       1   2      0%   100% (34%-100%)  not enough data
Turn off by default: style/general.Cliches
```

Studio serves the same per-book numbers at `GET /api/v1/plotlint/verdicts?bookId=<id>` (and records verdicts with `POST /api/v1/plotlint/verdicts`, `{ bookId, verdicts: [...] }`).
