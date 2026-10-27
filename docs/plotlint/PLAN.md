# Fork plan: InkOS into a checked fiction IDE

Oct 26, 2026 · @Cob · revised Oct 27, 2026 against InkOS 2.0.0

## Summary

Fork InkOS and turn it into a fiction IDE: a word processor where conventional checks (grammar, style) and story checks (continuity, structure, craft) show up as inline diagnostics, the way a code editor shows compiler errors and lint warnings. InkOS already has the hardest piece, structured story state that updates chapter by chapter. The fork adds three things it lacks: a deterministic rule engine over that state, an editor-first interface, and a closed loop in which editor agents send findings back to an author agent until a draft passes.

Goals:

- **Writer-first UX.** A manuscript editor with squiggles, a problems panel, quick fixes, tracked-change suggestions and a side chat, not a dashboard for an autonomous pipeline.
- **Checks that say how sure they are.** Every finding is labelled deterministic (code proved it), extracted (code checked facts an LLM pulled from the text) or judged (an LLM or rubric opinion), with the evidence quoted.
- **Opinionated, selectable craft checks.** Genre packs (mystery, romance, fantasy and others, plus a general pack) that the writer agent picks from automatically and the author can override.
- **A closed loop that stops at the right time.** Author agent drafts, editor agents review, author agent revises or defends, and the loop ends on clear stop conditions, with human gates where the author wants them.
- **Works on human manuscripts too.** Import a draft and get the same checks, without any AI writing a word.

## Starting point: what InkOS gives us

Verified against InkOS 2.0.0, upstream commit `53adac4` (2026-10-24), which is what `ConMcNulty/plotlint` was forked from. It is a pnpm TypeScript monorepo (Node 22.16+) with three packages: `core` (agents, state, harness, pipeline, skills), `cli` (commands and a terminal UI) and `studio` (a local web workbench on Vite, React 19 and Hono).

| Piece | What it does today (2.0.0) | What the fork does with it |
| --- | --- | --- |
| Runtime story state | Four Zod-validated JSON files in each book's `story/state/`: `manifest.json` (schema v2, `lastAppliedChapter`), `current_state.json`, `hooks.json` and `chapter_summaries.json`, with Markdown projections (`current_state.md`, `pending_hooks.md`, `chapter_summaries.md`) and per-chapter snapshots. Schemas in `core/src/models/runtime-state.ts` | Keep as the canonical state. It is the input to the rule engine |
| Temporal facts | `current_state` holds subject–predicate–object facts with `validFromChapter`, `validUntilChapter` and `sourceChapter`. Character knowledge, location, resources and cast are all expressed as facts | Already a bitemporal-ish store at chapter granularity. The fork adds scene and character-offset evidence and a typed predicate vocabulary so rules can match on it |
| State reducer | `applyRuntimeStateDelta` (`core/src/state/state-reducer.ts`) is a pure function: a delta of `factOps` (upsert, expire), `hookOps` (upsert, mention, resolve, defer), `newHookCandidates` and a chapter summary, validated before it is applied | The single seam for the rule engine: rules run over the proposed next snapshot before it is committed, and findings attach to the delta |
| Settler agent | `agents/settler-*.ts` plus the `inkos-long-writing` skill's `state-projection.md` extract each chapter's delta: explicit changes only, knowledge scoped to who witnessed it, resource deltas that must reconcile | Keep; require an evidence span for every fact op and add a second-pass cross-check |
| Hook lifecycle | Hooks move through open, progressing, deferred, resolved and superseded, with `dependsOn`, `paysOffInArc`, `lastAdvancedChapter` and a defined difference between a mention and an advance | Reuse directly for setup/payoff and stale-promise checks |
| Continuity auditor | `agents/continuity.ts` is now a skill-driven LLM review (`inkos-story-review`, `review-matrix.md`). It returns `Observation` records (`code`, `summary`, `category`, `assessment`, `sourceRefs`), and the host rejects any quote that is not an exact excerpt of the source. It also diffs before/after revisions to catch edits outside the permitted range | `Observation` is close to the fork's `Diagnostic`; extend it with a text range, layer, severity and confidence label. The exact-quote validation is the "no finding without evidence" rule, already enforced |
| Reviser and range edits | `agents/reviser.ts`, `utils/text-range-edits.ts` and `harness/artifact-edit-policy.ts` revise only a permitted range and preserve everything outside it | Becomes the author agent's revise step; range-bounded edits map one-to-one onto tracked suggestions |
| Works and artifact revisions | `harness/work-store.ts` and `artifact-revisions.ts` keep each Work under `works/<id>/` with checksummed revisions and journaled multi-file writes | Pin every diagnostic to a revision id; each loop round is a revision, so rounds can be diffed and rolled back |
| Skills | `packages/core/skills/*/SKILL.md`: long writing, short writing, story review, story deslop, story import, continuation, fanfic, translation and others | Genre check packs ship as skills plus rule modules |
| Story import | `inkos-story-import` reconstructs state from existing chapters | Entry point for human manuscripts |
| AIGC detection | `agents/detector.ts` calls an external API (GPTZero, Originality or custom). Anti-slop work is a prompt skill (`inkos-story-deslop`), not code | L1 needs its own local, deterministic AI-tell rules |
| Studio editor | `pages/ChapterReader.tsx` edits a chapter in a plain `<textarea>` | No rich editor to reuse; the Tiptap editor is new work |
| Multi-model routing | Different models per agent, including local ones | Keep; cheaper models for extraction, stronger for judgment |

**What changed from the earlier draft of this plan.** The draft assumed the 1.x layout. In 2.0 there are four state files, not seven: the resource ledger, subplot board, emotional arcs and character matrix are no longer separate files, and their content lives in temporal facts and hooks. There are no Observer or Reflector agents, and the auditor no longer has 37 fixed dimensions; it follows an adaptive review matrix in a skill. None of this weakens the plan. Temporal facts, a pure reducer and host-validated evidence quotes make the rule engine easier to add than it would have been on 1.x.

**License.** Confirmed `AGPL-3.0-only` in the root `package.json` at the forked commit. The fork must stay AGPL, and a hosted version must offer its source to users. MIT and Apache-2.0 parts can be combined into it; anything that should stay proprietary has to run as a separate service.

**Upstream sync.** Forked from 2.0.0 `master`, which answers the earlier "1.8 or 2.0" question. Add `Narcooo/inkos` as an `upstream` remote and merge it on a schedule. Put new work in new packages and touch `core` only at a few named seams (the reducer, the settler's delta schema, `Observation`, Studio's routes), so upstream merges stay cheap.

## Architecture

New work lives in four new packages between a new editor and the existing InkOS core, so upstream changes merge with little friction.

```
┌──────────────────────── Studio (React 19 + Hono) ────────────────────────┐
│  Binder │ Tiptap manuscript editor + diagnostics │ Side chat │ Problems   │
└───────────────┬───────────────────────────────────────────────┬──────────┘
                │ diagnostics, suggestions                       │ agent turns
┌───────────────▼────────────┐  ┌────────────────────┐  ┌────────▼──────────┐
│ @plotlint/diagnostics      │◄─┤ @plotlint/rules    │  │ @plotlint/loop    │
│ Diagnostic schema (extends │  │ L0–L4 runners,     │  │ author + editor   │
│ Observation), suppressions,│  │ rule registry,     │  │ agents, arbiter,  │
│ problem store per revision │  │ invariants, packs  │  │ stop conditions   │
└───────────────▲────────────┘  └─────────┬──────────┘  └────────┬──────────┘
                │                          │ reads snapshots      │ calls agents
┌───────────────┴──────────────────────────▼──────────────────────▼──────────┐
│ InkOS core: state reducer · settler · hooks · continuity auditor · reviser │
│             works/artifact revisions · skills · model routing              │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ HTTP
                        ┌───────────▼────────────┐
                        │ Python sidecar: BookNLP,│
                        │ LexicalRichness, slop   │
                        │ lists; Harper/Vale CLIs │
                        └────────────────────────┘
```

`@plotlint/editor` holds the Tiptap extensions (diagnostic decorations, suggestion marks, state-at-cursor) and is consumed by Studio. The editor talks only to the new packages; they read story state and call InkOS agents. The Python sidecar holds the English NLP tools, and model calls are routed per agent as InkOS already does.

## Editor UX

The main screen is a manuscript editor that behaves like a modern code editor: the text is central, problems are underlined in place, and agents work through a side chat and reviewable suggestions. It replaces the Studio dashboard as the default view; the dashboard stays as a secondary page.

**Layout (three panes).**

- **Left: binder.** Book, parts, chapters and scenes as a tree; the story bible (truth files shown as editable cards); active check pack; outline.
- **Centre: editor.** A rich-text editor on Tiptap's open-source core (MIT), which is built on ProseMirror. Paginated or continuous view, focus mode, word counts per scene and chapter.
- **Right: side chat.** Conversations with named agents (`@author`, `@continuity`, `@dev-editor`, `@line-editor`, `@beta-readers`), scoped to the selection, scene, chapter or whole book.
- **Bottom: problems panel.** Every finding in one sortable list, filterable by layer, severity, confidence and chapter, like an IDE's problems view.

**Inline diagnostics.** Each check layer gets its own underline style so the writer can tell a typo from a plot hole at a glance: spelling and grammar, style and prose, continuity, structure, and judged notes. Gutter markers flag scene-level issues. Hovering shows the message, the rule that fired, its confidence label and the quoted evidence, with a jump link to where a contradicting fact was established.

**Quick fixes.** A lightbulb on each finding offers actions: apply a suggested rewrite, mark as intentional (suppresses that instance and records why), update the story bible instead of the text, or ask an agent to propose options.

**Suggestions as tracked changes.** Every agent edit arrives as an accept/reject suggestion, never a silent overwrite. Tiptap's own tracked-changes and AI toolkit are paid add-ons, so the fork builds its own suggestion marks on ProseMirror (its changeset utilities are MIT) or adopts an open-source suggestion extension after a license check.

**IDE-style navigation.**

- **Go to definition.** From a character, object or place name, jump to where it was introduced, or to where the fact under the cursor was established.
- **Find all references.** Every appearance of an entity, grouped by chapter.
- **State at cursor.** A debugger-style inspector showing the world as of the cursor position: who is where, alive, holding what, knowing what.
- **Command palette.** Run any check, agent or export by name.
- **Ghost text (optional, off by default).** Inline continuation suggestions accepted with Tab, for writers who want them.

**Views beyond the page.** Timeline (events on a time axis, with conflicts highlighted), cast board (characters and relationships), hook board (open promises and their age), and a tension curve across chapters. Each view links back to the text.

## Check layers

Checks run in six layers, ordered from most to least objective. Lower layers are cheap and run as you type; higher layers run on save, on demand or in the closed loop. Every finding carries one of three confidence labels: **deterministic** (code proved it from the text or state), **extracted** (code checked facts that an LLM pulled from the text, so it is as good as the extraction) or **judged** (an LLM or rubric opinion).

| Layer | What it catches | How | Label | When it runs |
| --- | --- | --- | --- | --- |
| L0 Mechanics | Spelling, grammar, punctuation, dialogue formatting | Harper (English, fast, local) or LanguageTool (multilingual); a project dictionary seeded from story-bible names | Deterministic | As you type |
| L1 Style lint | Pet phrases, clichés, AI tells, filter words, adverb clusters, house style | Vale rules in YAML per pack; antislop phrase and regex lists; InkOS's AI-tell heuristics | Deterministic | As you type |
| L2 Prose metrics | Low lexical diversity (MTLD), flat sentence rhythm, dialogue ratio, sensory-detail density, repetition across chapters, predictability (surprisal from a small local model) | Metric scripts compared against genre baselines, flagging only outside a band | Deterministic | On save |
| L3 Continuity | Dead characters acting, impossible travel, missing items, knowledge leaks, timeline contradictions, ledger going negative | Rule engine over the story-state event log (next section) | Extracted | On save, per scene |
| L4 Structure | Scenes that don't turn, cut-test candidates, passive protagonist, unpaid setups, flat tension, unanswered questions | Structural analyses over state plus scene annotations | Extracted, some judged | On demand, per chapter |
| L5 Judgment | Voice, theme, whether a twist is earned, whether a scene works | Rubric critics and a beta-reader panel, each finding quoting the passage it is about | Judged | On demand, in the loop |

**Rules for presenting findings.**

- A finding without quoted evidence is not shown.
- Judged findings are never shown as errors, only as notes, and never block the loop on their own.
- Each check has an ID, a short rationale (why it matters) and a link to the craft source it comes from, so the writer can decide whether they agree with it.
- Suppressions are per instance with a reason, or per check per book; both are saved in the project so agents respect them. They live in `works/<id>/source/story/plotlint/suppressions.json` (`SuppressionFileSchema` in `@plotlint/diagnostics`). An instance is matched by `diagnosticFingerprint`, a hash of the rule, chapter, evidence, quotes and facts rather than character offsets, so it survives text moving. From the CLI: `inkos lint suppress <rule-id> [book-id] --reason <text> [--fingerprint <fp>]` and `inkos lint unsuppress`; `inkos lint --verbose` or `--json` prints fingerprints, `--show-suppressed` lists hidden findings.

## Story state and the rule engine

The core addition is a deterministic checker: an LLM extracts facts, but plain code decides whether they contradict each other. That separation is what gives continuity findings a reliability the current LLM-only auditor can't.

**1. Event log under the state files.** InkOS 2.0's facts already carry `validFromChapter`, `validUntilChapter` and `sourceChapter`. The fork adds a finer event log beneath them: each scene produces typed events with an exact evidence span, and the four state files become projections of this log, so InkOS's existing agents keep working.

```
{ id, scene: "ch12.s3", type: "possession_change",
  entity: "brass_key", from: "mira", to: "tomas",
  evidence: { start: 18422, end: 18490, quote: "..." },
  extractor: "settler@model-x", confidence: 0.92 }
```

Event types to start with: entity introduced, status change (alive, dead, injured, missing), location change, possession change, knowledge gained (who learns which fact, and how), relationship change, resource change, world-rule statement, time marker (explicit dates, "three days later", ages).

**2. Extraction with cross-checks.**

- BookNLP runs first on English text: it clusters character names ("Tom", "Mr. Sawyer" into one character), resolves coreference and attributes quotes to speakers. That gives the LLM extractor a fixed cast list and lets code verify who said each line of dialogue.
- The LLM extractor (InkOS's settler, extended) must cite the exact passage (character offsets) for every event. Events without a valid span are dropped.
- Two extraction passes, ideally with different models, on anything that would raise an error. Disagreement lowers confidence and routes the finding to the judged layer instead.

**3. Rules as code.** Rules are small TypeScript functions over the event log, each returning findings with evidence. Examples:

- **Dead men don't talk:** no speech, action or point-of-view scene for an entity after a death event, unless a world rule allows it (ghosts, flashbacks, letters).
- **Can't be in two places:** location changes must be possible given a travel-time graph between places (author-editable) and the time elapsed.
- **No item from nowhere:** an entity can only use an object it possesses at that point.
- **No knowledge leaks:** a character can't act on a fact before a knowledge-gained event for them (InkOS 2.0 already scopes knowledge facts to the characters who witnessed them).
- **Timeline sanity:** time markers form a consistent order (interval reasoning over "before", "after", "during"); ages match birth dates; seasons match months.
- **Ledger never negative:** money, mana, ammunition and other tracked resources can't go below zero without an explanation event.
- **World rules hold:** stated costs and limits of a magic or tech system are applied to every later use.

**4. Author-written invariants (story unit tests).** The author can add their own rules in plain language, compiled to rule code by an agent and then shown for approval. Examples: "Mira must not learn the captain's identity before chapter 20", "the reader never sees inside the vault until the finale", "Tomas never lies". These run on every save like tests, and failing ones show in the problems panel.

**5. Flashbacks, unreliable narrators and dreams.** Scenes carry a frame attribute (main timeline, flashback, dream, story-within-story, unreliable POV). Rules apply per frame, and an unreliable-narrator flag downgrades contradictions in that POV to notes rather than errors.

## Structural checks

Developmental editing is broken into narrower questions that produce evidence. The checks describe the manuscript; the author (or a judged layer) decides what that means. Each needs a light scene annotation that the extractor fills in: POV character, scene goal, opposition, outcome, value at start and end.

| Check | Question it answers | Method | Typical finding |
| --- | --- | --- | --- |
| Scene turn | Does anything change in this scene? | Compare the scene's start and end values (safety, love, status, knowledge) | "Scenes 14 to 17 end where they began" |
| Goal, conflict, outcome | Does the POV character want something, meet opposition and end somewhere new? | Scene annotation completeness | "No opposition in 6 of 9 scenes in Act 2" |
| Cut test | Does anything later depend on this scene? | Causal graph: an edge when a later event needs an earlier event, possession or piece of knowledge | "Nothing downstream depends on scene 15" |
| Protagonist agency | Who drives the plot? | Share of turning points caused by the protagonist's choices versus things done to them | "Protagonist causes 2 of 11 turning points" |
| Setup and payoff | Is every promise kept, and every payoff set up? | InkOS hook ledger plus the event log; payoffs without earlier setups are flagged as unearned | "The poisoned ring, shown in ch. 3, never returns" |
| Open questions | Is the reader curious, or confused? | Track questions raised and answered per chapter | "Ch. 9 to 11 have no open question; ch. 2 has nine at once" |
| Tension curve | Does pressure build toward the climax? | Per-chapter stakes estimate (judged) plotted as a curve, flags on long flat runs or an early peak | "Peak tension is in ch. 18 of 30" |
| Predictability probe | Is the plot too obvious, or a twist unearned? | A model reads up to a turning point and guesses what comes next, several samples | "All 5 guesses predicted the betrayal" or "No guess was close, and no clue points to it" |
| Subplot balance | Do subplots get attention and resolve? | Subplot board share of scenes over time | "The sister subplot vanishes after ch. 7" |
| POV discipline | Does the scene stay in its viewpoint? | Knowledge checks against the POV character's knowledge only | "POV character reports another's private thoughts" |

These are the most opinionated checks, so the genre packs (next section) decide which ones are on and how strict they are. Literary fiction, for example, turns scene-turn and agency checks down to notes.

## Genre check packs

Craft rules differ by genre, so checks come in packs: a general pack always on, plus one or more genre packs layered on top. Packs are opinionated on purpose, and every rule cites the craft tradition it comes from so the writer can disagree with it.

**How a pack is defined.** One folder per pack, written as an InkOS SKILL.md plus machine-readable files: `checks.yaml` (which checks are on, severity and thresholds), Vale style rules for L1, metric baselines for L2, extra rule functions for L3 and rubrics for L5. Packs can extend other packs ("cozy-mystery extends mystery").

**How packs are chosen.** The writer agent proposes packs from the brief or, for an imported manuscript, from the first chapters, and shows its reasoning. The author confirms or changes the selection. Mixed genres stack packs (romantasy = romance + fantasy), with the stricter threshold winning on conflicts unless the author overrides it.

| Pack | Opinionated checks it adds or tightens |
| --- | --- |
| General (always on) | Continuity rules, setup and payoff, cut test, AI-tell and cliché lists, rhythm floor, dialogue attribution, POV discipline |
| Literary | Loosens scene-turn, agency and tension-curve checks to notes; tightens cliché, slop and lexical-diversity floors; adds voice-consistency and image-freshness rubrics |
| Mystery / detective | Fair play: every clue needed for the solution appears on the page before the reveal; the culprit is introduced early; no solution by coincidence or hidden information; red herrings get explained |
| Thriller / suspense | Rising stakes and a ticking clock; chapter-end hooks; tension curve must climb with no long flat runs; antagonist agency |
| Romance | Both leads get POV or interiority; the central relationship drives the main plot; required beats (meet, rising bond, crisis, grand gesture); a happy or hopeful ending, with a warning if missing |
| Fantasy / science fiction | World-rule compliance (stated costs and limits of magic or technology); exposition density; invented-term consistency; travel and distance rules |
| Progression / xianxia / LitRPG | Power-scaling consistency, resource ledger, level and rank order (largely inherited from InkOS's existing genre profiles) |
| Horror | Dread curve with releases; restraint on early reveals of the threat; isolation and escape logic |
| Historical | Era accuracy for technology, idiom and prices, using InkOS's traceable web research; anachronism word lists |
| Young adult / middle grade | Age-appropriate content flags; protagonist age and voice consistency; reading-level band |
| Short story | Single-effect check; fewer subplots; cut test applied at paragraph level |

**Misc genres.** Anything that doesn't match runs the general pack only. The writer agent can draft a custom pack from comparable books the author names, which the author then reviews like any other rule change.

## Closed loop: author agent and editor agents

The loop works like code review. The author agent submits a draft; editor agents file findings as review comments; the author agent fixes, defends or defers each one; checks rerun; the loop ends when stop conditions are met and a draft is handed to the human.

```
 author agent drafts/revises ──► settler updates state ──► editors run layers in parallel
        ▲                                                            │
        │                                                            ▼
 fix / defend / defer ◄── arbiter dedupes, ranks ◄────────── findings with evidence
                               │
                               ▼
                 stop conditions met? ── yes ──► human gate ──► accepted revision
                               │ no
                               └──► rerun checks on changed scenes only
```

Every round reruns checks only on changed scenes; the loop exits through the stop decision and an optional human gate.

**Roles.**

- **Author agent.** Plans and drafts (InkOS Planner, Composer and Writer), then revises. It may answer a finding with *fix*, *defend* (keep the text, with a reason tied to intent, such as "deliberate ambiguity") or *defer* (log it for later).
- **Continuity editor.** Runs L0 to L3 and reports only extracted or deterministic findings.
- **Developmental editor.** Runs L4 and the pack's structural rubrics; works at chapter and book level.
- **Line editor.** Runs L1, L2 and the line-level rubrics; proposes edits as tracked changes, never rewrites whole chapters.
- **Beta-reader panel.** Several reader personas set by the pack (a genre fan, a skeptical reader, a newcomer to the genre) report confusion, boredom, where they would stop and what they predict next.
- **Arbiter.** Not a writer: merges duplicate findings, resolves conflicting notes (one editor wants more description, another less) by pack priority, and decides when to stop.

**One round.**

1. The author agent drafts or revises a chapter.
2. Settlement updates the event log and truth files.
3. Editors run their layers in parallel and file findings with evidence.
4. The arbiter dedupes and ranks findings: errors first, then warnings, then notes.
5. The author agent responds to each finding: fix, defend or defer.
6. Defences go to the arbiter, which accepts them or escalates to the human gate.
7. Checks rerun only on changed scenes; the next round starts.

**Stop conditions (any one ends the loop).**

- No open errors, and warnings below the pack's threshold.
- Two rounds with no measurable improvement.
- Round or token budget reached.
- The edit distance from the author's chosen voice sample exceeds a limit (stops the loop from sanding off the style).

**Human gates (configurable).** After the outline, after each chapter, at the end of the book, or only when the arbiter escalates. Fully automatic runs are possible, but every gate decision is logged so the human can audit it later.

**Same loop, human author.** When a person writes the chapter, they take the author role: findings land in the problems panel, and agents only propose suggestions.

## Guarding against Goodhart

A closed loop is an optimizer, and an optimizer pointed at checks will learn to game them. These safeguards are built in from the start, not added later.

- **Floors and bands, never targets.** Metrics only flag text outside a band taken from the pack's reference books; nothing rewards going further past the floor.
- **Held-out checks.** A set of checks and rubrics the author agent never sees runs only at the end of the loop. If held-out scores fall while visible scores rise, the loop is gaming and stops.
- **Rotating critics.** L5 rubrics and beta-reader personas rotate between rounds and models, so the author agent can't tune to one judge.
- **Limited pressure.** Capped rounds, the voice-distance limit above, and edits restricted to flagged spans unless the human widens the scope.
- **Defend is a real option.** The author agent is rewarded for well-reasoned defences, not only for clearing findings, so it doesn't fix things that aren't broken.
- **Gaming detectors.** Flag when revisions add thesaurus words, uniformly vary sentence length or insert empty "setup" lines just to satisfy a check.
- **Human verdicts close the loop.** Accept and reject decisions on suggestions are logged per check, and checks the author keeps rejecting are lowered automatically for that book.

## Additional features

Other features that fit the same design, roughly in order of value:

- **Provenance per span.** Every passage records who wrote it (human, which agent and model, edited by whom). Platforms such as Qidian and Fanqie are cracking down on unlabeled AI writing, so honest labelling and an exportable provenance report matter for anyone publishing.
- **Character voice fingerprints.** Stylometry on each character's dialogue (word choice, sentence length, verbal tics) flags when two characters start sounding alike or one drifts out of voice.
- **What-if branches.** Git-style branches of the manuscript and its state, building on InkOS's plot forecasting, with a diff view of both text and world state between branches.
- **Series bible.** State and rules shared across books, using InkOS's cross-book canon import, so book three is checked against books one and two.
- **Reader-experience heatmap.** Estimated reading time per scene with beta-reader boredom and confusion marks, shown beside the scroll bar.
- **Revision memory.** The author's accepted and rejected suggestions train a per-book style profile used by the line editor.
- **Research panel.** InkOS's traceable web research for setting and era details, with sources linked to the facts they support.
- **Local and private mode.** All L0 to L3 checks run offline; LLM calls can go to local models, for writers who don't want their manuscript leaving their machine.
- **Export.** Manuscript formats (standard manuscript, EPUB via InkOS, DOCX) plus a submission package: synopsis, outline and query-letter drafts generated from state.
- **Check marketplace.** Packs as shareable folders, versioned, so editors and writing teachers can publish their own rule sets.

## Supporting open-source projects

These fill specific gaps around InkOS. Licenses marked "verify" were not confirmed for this plan; check each against AGPL compatibility before adding it, and run anything incompatible as a separate service.

| Project | Used for | Layer | License |
| --- | --- | --- | --- |
| [InkOS](https://github.com/Narcooo/inkos) | Base: agents, truth files, pipeline, Studio, skills | All | AGPL-3.0 |
| [Tiptap](https://tiptap.dev/docs/editor/introduction) (open-source core) on ProseMirror | Editor, decorations for diagnostics, custom suggestion marks | UX | MIT (AI toolkit and tracked changes are paid; not used) |
| [Hocuspocus](https://tiptap.dev/open-source-to-platform) + Yjs | Real-time sync between the editor and agents, later co-writing | UX | MIT (Yjs: verify) |
| [Harper](https://community.chocolatey.org/packages/harper) | Fast local English grammar checking; has a JS build and language server | L0 | Apache-2.0 |
| LanguageTool | Grammar for non-English manuscripts | L0 | Verify (run as a separate server) |
| [Vale](https://github.com/jdkato/vale) | YAML-defined style rules per genre pack | L1 | MIT |
| [antislop-sampler / antislop-vllm](https://github.com/sam-paech/antislop-sampler) | Slop phrase and regex lists; optional generation-time banning for local models | L1 | Verify |
| [LexicalRichness](https://www.github.com/LSYS/lexicalrichness) | MTLD, MATTR, HD-D lexical diversity | L2 | MIT |
| [BookNLP](https://github.com/dumpmemory/booknlp) | Character clustering, coreference, quote attribution for English books | L3 | Verify (a maintained fork states MIT) |
| [ConStory-Bench](https://raw.githubusercontent.com/Picrew/ConStory-Bench/main/README.md) | Consistency error taxonomy, evidence-quoting checker, 2,000-prompt benchmark | L3, evaluation | MIT |
| [SCORE](https://arxiv.org/pdf/2503.23512) | Reference design for item-status tracking and retrieval of related episodes | L3 | Verify |
| [LitBench](https://aclanthology.org/2026.eacl-long.362) | Human-preference story pairs for calibrating judged critics | L5, evaluation | Verify |

The Python pieces (BookNLP, LexicalRichness, antislop lists) run in one sidecar service with a small HTTP API, so the TypeScript core stays clean.

## Roadmap

Seven phases, each ending in a gate. No dates are set because team size and model budget aren't known yet.

| Phase | Builds | Gate to move on |
| --- | --- | --- |
| 0. Fork hygiene | `upstream` remote and merge routine; CI on the fork; `@plotlint/diagnostics` and `@plotlint/rules` wired into the workspace (`@plotlint/editor` and `@plotlint/loop` arrive with phases 1 and 5); `Diagnostic` schema extending `Observation`; one no-op rule that emits a diagnostic from the CLI | Upstream tests still pass; a diagnostic round-trips from rule to CLI output |
| 1. Editor with L0–L1 | Tiptap editor replacing the `ChapterReader` textarea; problems panel; Harper and Vale behind the rule runner; project dictionary from state; suppressions | A human writer imports a manuscript and sees squiggles; under 100 ms per keystroke on a 10k-word chapter |
| 2. Evidence-backed state | Scene segmentation; evidence spans on every settler fact op; typed predicates; state at cursor and go to definition | At least 95% of fact ops on the test books carry a span that validates |
| 3. Continuity rules (L3) | Rule registry with the seven starter rules; author invariants; frames for flashback and unreliable POV | Seeded-error corpus: recall and false-alarm rate per rule published, and each rule beats the LLM-only auditor on false positives |
| 4. Structure, metrics, packs (L2, L4) | Prose metrics against bands; structural checks; general, mystery, romance and fantasy packs | Writer study: accept rate per check, and no check rejected more than half the time stays on by default |
| 5. Closed loop | Author and editor agents, arbiter, stop conditions, held-out checks and the other Goodhart safeguards | Blind readers prefer loop output over single-pass output, and held-out scores don't fall as visible scores rise |
| 6. Beyond the page | Provenance per span, timeline and hook boards, what-if branches, series bible, exports | Driven by user demand |

Phases 1 and 2 already help human writers on their own, so the editor can ship before the autonomous loop exists. If the first users are people running the loop instead, phase 5 can move up after phase 3.

**First week of code (phase 0).** Add the `upstream` remote; get `pnpm install && pnpm test` green on the fork; scaffold `packages/diagnostics` and `packages/rules`; define `Diagnostic` as `Observation` plus `range`, `layer`, `severity`, `confidence` and `ruleId`; add a hook after `applyRuntimeStateDelta` that runs registered rules over the proposed snapshot; ship one rule (a fact asserted for an entity after a fact that it is dead) end to end in the CLI.

**Status.** Phase 0 code is in: `@plotlint/diagnostics` (the `Diagnostic` schema), `@plotlint/rules` (`checkSnapshot`, and `checkDelta`, which wraps `applyRuntimeStateDelta` rather than patching core), the continuity rules `dead-entity-acts`, `two-places-at-once`, `item-two-holders`, `negative-resource` and `single-valued-conflict` (alive and dead, or two ages, at once), which run on today's temporal facts ahead of the phase 2 event log, and an `inkos lint [book-id] [--json]` command. The `upstream` merge routine is `.github/workflows/upstream-sync.yml` (weekly, or run by hand), which opens a PR per merge. Still open: GitHub Actions has to be enabled on the fork for CI and the sync to run. Phase 1 has started with L1: `@plotlint/style` runs a TypeScript subset of Vale's YAML rules (`existence`, `substitution`, `occurrence`) as text rules with ids `style/<Style>.<Rule>`, and ships the general pack in `packages/style/packs/general` (filter words, clichés, InkOS's English AI-tell words, adverb clusters, intensifiers, redundancies).

## Evaluation

Each layer gets measured against known answers, so it's clear which checks to trust.

- **Seeded-error manuscripts (mutation testing).** Take public-domain novels, inject known errors (a dead character speaks, an item reappears, a date contradicts, a clue is removed before the reveal) and measure what fraction each check catches and how many false alarms it raises on the untouched text.
- **ConStory-Bench.** Run the continuity layer on its stories and compare with its LLM-only checker; the goal is equal recall with fewer false positives on factual and timeline errors.
- **Classic novels as a false-positive baseline.** Well-edited published books should produce few errors. Every error the checker reports on them is reviewed and either fixed or turned into a known exception (flashback handling, unreliable narration).
- **Judged-layer calibration.** Measure agreement between L5 critics and human preferences using LitBench pairs; the best off-the-shelf judge there agreed with humans 73% of the time, so that is the bar to beat, not assume.
- **Loop studies.** Run the closed loop on the same briefs with and without each safeguard, and have blind human readers compare outputs, to check that the loop improves books rather than scores.
- **Writer studies.** Accept and reject rates per check, time to fix, and which checks writers turn off: the most direct signal of which checks are useful.

## Risks and open questions

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Extraction errors | Deterministic rules on wrong facts produce confident wrong findings | Evidence spans required, double extraction, confidence labels, easy "wrong fact" correction that updates the log |
| False-positive fatigue | Writers turn off checkers that cry wolf | Conservative defaults, per-check acceptance tracking, auto-demotion of rejected checks |
| Homogenized prose | The loop pulls every book toward the same style | Voice-distance limit, floors not targets, literary pack loosens structure checks |
| Upstream churn | InkOS is moving fast (2.0 shipped on a new harness in October 2026) | New code in separate packages, narrow interfaces into core |
| AGPL obligations | A hosted version must publish its source | Decide licensing strategy before any hosted launch; keep proprietary parts as separate services |
| English-only NLP | BookNLP and Harper are English-only, while InkOS's user base is largely Chinese-language | LLM-only extraction path for other languages, LanguageTool for grammar, labelled as lower confidence |
| Cost | Double extraction and multi-agent loops multiply tokens | Cheap models for extraction, checks rerun only on changed scenes, per-book budgets |

**Open questions.**

- Who is the first user: novelists editing their own drafts, or people running the autonomous loop? The answer decides whether the editor or the loop ships first.
- Should packs be community-maintained from the start, or curated until the format stabilises?

## Sources

- [InkOS overview (DeepWiki)](https://deepwiki.com/Narcooo/inkos)
- [InkOS truth files reference (DeepWiki)](https://deepwiki.com/Narcooo/inkos/7.1-truth-files-reference)
- [InkOS continuity auditor (DeepWiki)](https://deepwiki.com/Narcooo/inkos/5.5-continuity-auditor)
- [InkOS listing with license and version (EveryDev)](https://www.everydev.ai/tools/inkos)
- [Tiptap open-source core and paid tiers](https://tiptap.dev/open-source-to-platform)
- [Tiptap AI Toolkit review](https://makerstack.co/reviews/tiptap-ai-toolkit-review/)
- [Vale](https://github.com/jdkato/vale)
- [Harper package and license](https://community.chocolatey.org/packages/harper/2.8.0)
- [BookNLP](https://github.com/dumpmemory/booknlp)
- [LexicalRichness](https://www.github.com/LSYS/lexicalrichness)
- [antislop-sampler](https://github.com/sam-paech/antislop-sampler) and [antislop-vllm](https://github.com/sam-paech/antislop-vllm)
- [ConStory-Bench repository](https://raw.githubusercontent.com/Picrew/ConStory-Bench/main/README.md) and [paper](https://arxiv.org/abs/2603.05890)
- [SCORE framework](https://arxiv.org/pdf/2503.23512)
- [LitBench (EACL 2026)](https://aclanthology.org/2026.eacl-long.362)
- [AI writing crackdown on Chinese web-novel platforms (36Kr)](https://eu.36kr.com/en/p/3915063450801288)
