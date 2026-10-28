# Score: The Sluice at Lessing Fen

The longer test book for the L4 structure checks and the genre packs. See
`PLANTED.md` for the ground truth and `outline.json` for the scene outline the
chapters were drafted from.

## How it was made

- **Book.** 13 chapters, 22,616 words (1,371 to 2,180 per chapter), 3 scenes
  each split by `* * *`, 39 scenes. Drafted by
  `glm-4.5-flash` one chapter at a time from the outline (temperature 0.7,
  thinking off), with the dropped-subplot and whistle words kept out of
  chapters 6 to 13 by filtering them from the prompt. The prose is unedited.
- **State.** `inkos book create --genre mystery --target-chapters 13` and
  `inkos import chapters` with `glm-4.5-flash` (one timeout on ch13, resumed with
  `--resume-from 13`): 126 facts, 48 hooks (38 on the page, 11 resolved),
  `inkos lint evidence` 187 of 196 fact ops with a valid span (95.4%, meets the
  gate; the misses are in ch10, ch12, ch13).
- **Scenes.** `inkos lint annotate` with `glm-4.5-flash`: all 39 scenes, 139 of
  144 quotes found in their scene (5 dropped). Chapters 2, 12 and 13 needed a
  second run; ch7 failed every run until the reply parser learnt to escape
  dialogue quotes the model leaves unescaped (fix 4 below).
- **Hooks.** `inkos lint hooks reconcile` with `glm-4.5-flash` (one call per
  hook, 29 hooks the ledger leaves open; hook-8 was asked
  again on a second run after its answer was dropped): 21 resolved by a later
  chapter with a located quote, 8 kept open. Saved in `story/plotlint/hooks.json`.
- **Lint.** `inkos lint packs use mystery romance`, then `inkos lint --json`,
  after merging master (measured bands, `metrics/predictability`).
- `extracted/glm-4.5-flash/` holds the settled state and `scenes.json`,
  `story/plotlint/hooks.json` the hook overlay; the test
  `packages/packs/src/__tests__/lessing-fen.test.ts` pins every state-rule
  finding with the three packs and the overlay applied.

## Planted problems

| # | Planted | Expected check | Fired? | Where |
| --- | --- | --- | --- | --- |
| P1 | Sister Bea's Canada subplot dropped after ch5 | `structure/subplot-balance` | **yes, after fix 2** (missed before) | ch5: "The Bea Ashby subplot vanishes after ch5 (8 chapters before the end) with 1 question unresolved." (note: romance pack) |
| P1 | same | `structure/unpaid-setup` | **yes** | ch2: hook-5 "Resolve conflict with sister Bea over her marriage to Leonard Fawley" never resolved |
| P2 | Silver bosun's whistle, ch2.s2, never returns | `structure/unpaid-setup` (hook) | **yes** | ch2: hook-4 "Uncover the significance of the silver bosun's whistle from H.M.S. Cormorant 1916" never resolved |
| P2 | same | `structure/unpaid-setup` (tracked object) | **no** | The settler ended "Nell Ashby · possession · silver whistle" at ch10 for no reason in the text, which counts as a return; and ch5's "The whistle blew" (a train) names the head noun. Either alone silences it. |
| P3 | Ch8: nothing changes in any of its 3 scenes | `structure/cut-candidate` | **yes** | ch8: "Nothing after ch8 depends on what it establishes" (its 7 facts: attended the fete, judged jam, compiled notes, ...) |
| P3 | same | `structure/scene-turn` | **no** | The annotator gave ch8's scenes knowledge 0→1, 1→0, 0→−1 (it reads "the pieces don't fit" as a loss); no run of 3 flat scenes exists. An annotation miss, not a rule bug. |
| P3 | same | `structure/goal-conflict-outcome` | **no** | The annotator invented goals and opposition ("observe suspects at fete" / "lack of suspicious behaviour"). |
| P3 | same | `structure/tension-curve` | no (not expected to) | ch8's stakes dip to 5 between 7 and 8; the rule flags only flat runs and early peaks. |

Caught 3 of 3 planted problems by at least one rule (P1 by two). Of the five
expected-check rows, 3 fire; the two misses on P3 come from the annotator, and
the tracked-object miss on P2 from the settler's state plus a homonym.

## Planted correct structure (should stay quiet)

| What | Check | Quiet? |
| --- | --- | --- |
| Culprit Vane on the page in ch1, clues before the ch12 reveal | `structure/fair-play` | yes |
| Romance: central couple, hopeful ending, Kit's POV in ch7 | `central-relationship`, `hopeful-ending`, `both-leads-pov` | yes, all three |
| Kit's key given ch11, used ch12 | `unpaid-setup` | yes |
| Silas Rudd red herring explained in ch9 | `unpaid-setup` | **yes, with the hook overlay** (was no: hook-17 and hook-20 are never resolved in the ledger; the overlay resolves both in ch9 on Silas's letter) |
| Nell drives the plot | `protagonist-agency` | **no**: "Nell Ashby causes 7 of 36 turning points (19%)" (debatable, below) |
| No POV breaks were written | `pov-discipline` | yes |

## Every other finding, judged

State rules, final run with the hook overlay (13 findings, pinned by the test;
34 without it):

| Finding | Count | Verdict |
| --- | --- | --- |
| `unpaid-setup` on hooks other than P1/P2 | 6 (27 without the overlay) | With the overlay: **5 false alarms** (hook-8, hook-9, hook-21, hook-25, hook-26), 1 debatable (hook-7); see "Hook reconcile" below. Without it: **25 false alarms**, 2 debatable. The settler opens a hook per sub-question ("Discover why the lantern was hidden in the reeds", "Investigate Silas Rudd's potential involvement") and rarely resolves it, even when the prose answers it (Vane's confession in ch12.s1 answers most of them; Silas's letter in ch9.s1 two; ch13 the three sequel-style hooks opened in ch12). Debatable: hook-7 "Nell confronts Ambrose with the mud evidence" (she confronts him, never with the mud) and hook-12 "Examine the ledgers Vane took" (the box of ledgers from ch2 is indeed never examined). The rule is right about the ledger and wrong about the book. |
| `protagonist-agency` 7 of 36 | 1 | **debatable**. The annotator credits revelations to whoever speaks (Hollis, Ivy, Kit, Silas), which is fair for an amateur detective who is told things; Nell's choices drive the investigation, but most turns are information handed to her. Also two turns marked `circumstance` with `by: "Nell"`. |
| `tension-curve` flat ch1–6 (7 to 8) | 1 | **debatable**. True of the annotation; the first act does keep a steady level (an arrest in ch5 is 7). |
| `style/invented-term-spelling` "Dorbit" for "Dorrit" (ch5) | 1 | **true** (a real slip of the drafting model) |

Before the fixes the same state also raised (all now gone):

| Finding | Count | Verdict |
| --- | --- | --- |
| `continuity/dead-entity-acts` ch3: Owen Tarrant "gains new state" | 1 | **false alarm**: the facts were the inquest's "ruling · accidental" and "signs_of_struggle · none". Fix 1. |
| `structure/unearned-payoff` ch10 (hook-3 ledger, hook-10 discrepancy) | 2 | **false alarms**: both were advanced in ch4 and ch8, but the summaries describe numbered hooks in words ("The missing financial ledger hook advances"), never as `hook-3`. Fix 3. |
| `structure/cut-candidate` on scenes | 13 | **2 true** (ch4.s2 and ch5.s2, the dropped Bea scenes), **11 false** (ch3.s1, ch3.s2, ch4.s1, ch5.s3, ch7.s1, ch9.s2, ch9.s3, ch10.s1, ch10.s2, ch10.s3, ch11.s1: the lantern, mud, audit, will, quarrel and stolen notes all return later, in words no fact repeats). Fix 5. |
| `structure/subplot-balance` | 0 | **miss** (P1). Fix 2. |
| (pack severity) mystery `unpaid-setup`/`unearned-payoff` at `error` | 31 | 29 of 31 errors were not real problems. Fix 6. |

Text rules (final run, not pinned: bands are being re-measured):

| Finding | Count | Verdict |
| --- | --- | --- |
| `metrics/repeated-phrase` | 79 findings, 35 phrases | 21 phrases **true** (the drafting model's tics: "a flicker of something" in 6 chapters, "said her voice steady", "his gaze fixed on the", "nell felt a prickle of", "smelled of old paper", "was thick with the", ...); 9 **debatable** idioms ("in the middle of", "for the first time", "the rest of the", "the end of the", "nothing to do with", "a cup of tea", "i need you to", "for a moment the", "she had a partner"); 5 **false alarms**, plot refrains a mystery repeats on purpose ("hook in the mill office", "opened with a key", "it was an accident", "it wasn't an accident", "told the coroner he was at home"). |
| `metrics/predictability` | 7 (ch3, 4, 5, 8, 9 ×2, 11) | 5 **true**: recaps that restate the clues in the same words (ch8's recap is the planted static chapter; ch3, ch9 ×2, ch11 restate the mud, the hook, the tea); 2 **debatable** (ch4 key board, ch5 cell dialogue). |
| `metrics/dialogue-ratio` ch10, 4% (band 8%–94%) | 1 | **true**: the chapter's quarrel is mostly narrated. |
| `style/mystery.Cliches` | 2 | **true**: "This was no accident" (ch1), "The pieces clicked into place" (ch4). |
| Harper (94), general style pack (95) | — | Not scored here (L0/L1). |

## Hook reconcile

`unpaid-setup` warnings before and after `inkos lint hooks reconcile`, judged
as above:

| | Warnings | True (P1, P2) | Debatable | False alarm |
| --- | --- | --- | --- | --- |
| Before (ledger only) | 29 | 2 | 2 (hook-7, hook-12) | 25 |
| After (ledger + overlay) | 8 | 2 | 1 (hook-7) | 5 |

- **Planted problems still caught.** P1 (hook-5, Bea) and P2 (hook-4, the
  whistle) stay open: the model found nothing in ch3–13 that answers them.
  `subplot-balance` still fires on Bea at ch5, `cut-candidate` still on ch8
  (the cut test reads the ledger as is; only the promise-keeping rules
  `unpaid-setup`, `unearned-payoff`, `open-questions`, `subplot-balance` and
  `fair-play` read it through the overlay). `unearned-payoff`,
  `open-questions` and `fair-play` stay quiet.
- **The 21 resolutions.** 20 close false alarms, most on Vane's confession in
  ch12 ("I hid it there after," for the lantern in the reeds; "I pushed him
  in."), Silas's letter in ch9 (hook-17, hook-20), the ledger pages in ch10
  (hook-18, hook-22), and the courtship and clerkship in ch13 (hook-32 to
  hook-35). One closes a debatable one: hook-12 "Examine the ledgers Vane
  took" on Nell taking the ledger from the safe in ch11 (a different ledger
  from the box in ch2). Weakest evidence: hook (ch1, "Nell begins
  investigating...") on a ch3 line where she only *wants* to ask why the gate
  was opened; the hook's own wording is about beginning, so it is not wrong,
  and it was a false alarm either way. No true finding was resolved.
- **The 5 left.** hook-8 (why Ambrose lied: the ch12 confession answers it,
  but the model twice named a chapter its quote was not in, so the answer was
  dropped), hook-9 and hook-26 (the model held that Nell never investigates
  the finances or the codicil herself, which is a fair reading of a badly
  worded hook), hook-21 and hook-25 (no sentence states the link; Vane is
  arrested rather than "more dangerous").
- **Wenlow and the lantern book.** One hook each to check (wenlow hook-2 "What
  happened to the Margery", the lantern book's h1 "Who began scratching Mira's
  name"); the model kept both open, which is right for the lantern book and
  leaves wenlow's findings unchanged.

## Fixes made

1. `continuity/dead-entity-acts` (`POSTHUMOUS_PREDICATE`): what an inquest finds
   about the dead (inquest, verdict, ruling, coroner, autopsy, post-mortem,
   signs of, wound, injury; 验尸, 尸检, 裁定) is posthumous, not the dead acting.
2. `structure/subplot-balance`: a character's thread with one hook counts as a
   subplot when the character has facts in at least `minChapters` (default 3)
   chapters, and hooks name a character by given name as well as full name
   ("Bea" for "Bea Ashby"), never by a shared surname. This catches P1.
3. `structure/unearned-payoff`: a hook whose id no chapter summary ever names is
   not judged "never advanced"; GLM's summaries describe numbered hooks in words.
4. Scene annotation (`parseAnnotationReply`): a reply whose JSON does not parse
   is retried with dialogue quotes the model left unescaped inside a string
   escaped (`escapeStrayQuotes`). ch7 could not be annotated without it.
5. `structure/cut-candidate`: scene-level findings are opt-in (`scenes: true`);
   chapter-level ones are unchanged. 2 of 13 scene flags were real here.
6. Mystery pack: `structure/unpaid-setup` and `structure/unearned-payoff` from
   `error` to `warning`: both read the settler's hook ledger, which leaves most
   answered questions open.
7. CLI: `inkos lint annotate --chapter N` annotated every chapter, since the
   parent `lint` command's own `--chapter` took the flag; it now falls back to it.
8. Hook overlay: `inkos lint hooks reconcile` asks the LLM whether a later
   chapter answers each hook the ledger leaves open, keeps an answer only with a
   quote found in that chapter, and saves `story/plotlint/hooks.json`; the
   promise-keeping structure rules read the ledger through it. 21 of 25 false
   `unpaid-setup` alarms gone, both planted ones kept.

## Open issues

- The hook ledger was the main source of false structure findings (25 of 29
  `unpaid-setup` warnings). With the hook overlay 5 of 8 remain false; they are
  hooks worded as tasks ("Nell investigates ... more thoroughly") that no
  sentence settles, and one answer the model could not quote in the right
  chapter. Reconcile costs one long call per open hook (all later chapters).
- The annotator does not mark static scenes as static (P3 missed by
  `scene-turn`): it reads "nothing new learned" as a small loss. The prompt could
  say that recap and routine scenes keep the same value.
- The tracked-object check is silenced by a settler's unexplained expiry and by
  a homonym of the item's head noun.
- `inkos import chapters` rewrote each chapter's title line from the file name
  ("# Chapter 1: The_Mill_Race").
