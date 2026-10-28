# Planted structure: The Sluice at Lessing Fen

Ground truth for the `lessing-fen` corpus book: a 13-chapter English village
mystery with a romantic subplot (22,616 words, 39 scenes, `* * *` scene
breaks, 3 scenes per chapter). The chapters were drafted by `glm-4.5-flash`
one at a time from a hand-written scene outline (the outline is the source of
everything below); the prose was not edited afterwards, so it has the model's
own small slips, listed at the end.

Scene ids are `ch<chapter>.s<n>`, as `segmentScenes` numbers them.

## Planted problems (a check should fire)

| # | Problem | Where | Expected check |
| --- | --- | --- | --- |
| P1 | **Dropped subplot.** Nell's sister Bea is leaving for Canada with her indebted fiance Leonard Fawley. The thread is raised and argued over three times, then Bea leaves "promising to write from the ship" and is never mentioned again (no Bea, Leonard, Canada or Liverpool in ch6 to ch13). | ch2.s3, ch4.s2, ch5.s2; silent ch6 to ch13 | `structure/subplot-balance` (subplot vanishes after ch5); also `structure/unpaid-setup` on the Bea/Canada hook |
| P2 | **Planted object that never returns.** In Tarrant's coat Nell finds a silver bosun's whistle engraved "H.M.S. Cormorant 1916", dwells on it, is "certain it matters" and pockets it. It is never mentioned again. (Trap: ch5.s2 has an unrelated train whistle, "The whistle blew.") | ch2.s2 | `structure/unpaid-setup` (emphasised object never returns) |
| P3 | **A chapter where nothing changes.** Ch8: Nell and Aunt Maud bake and recap the case; the church fete, where nothing happens; Nell copies out the same notes and goes to bed "no further on, and no different". No new fact, decision or relationship change. | ch8.s1, ch8.s2, ch8.s3 | `structure/scene-turn` (3 flat scenes in a row); `structure/cut-candidate` (nothing later depends on ch8); possibly `structure/goal-conflict-outcome` (no opposition) and a flat stretch in `structure/tension-curve` |

## Planted correct structure (a check should stay quiet)

| What | Where | Check that should not fire |
| --- | --- | --- |
| Culprit Ambrose Vane on the page from the start (offers keys, wants the ledgers "for the bank") | ch1.s2 | `structure/fair-play` (culprit early) |
| Clues before the reveal: missing last-quarter ledger (ch2.s1); fen clay on Vane's boots against his alibi (ch3.s2); Tarrant's audit request (ch4.s1); empty key hook in the mill office (ch4.s3, ch6.s1); lantern on the sluice bank (ch5.s3); mill-office lantern hidden in the reeds (ch7.s1); new will cutting Vane out (ch9.s2); Drainage Board sums in Vane's hand (ch10.s1) | ch2 to ch10 | `structure/fair-play` (solution rests on earlier clues) |
| Reveal and confession | ch12.s1 | — |
| Red herring raised and explained: Silas Rudd's debts and the burning papers (ch6.s2, ch7.s3), explained by Owen's letter forgiving the debt | ch9.s1 | `structure/unpaid-setup` on Silas |
| Romance: Nell and Kit Merrow; spark (ch3.s3), near kiss (ch6.s3), crisis quarrel (ch10.s2), apology and kiss (ch11.s2), courtship accepted (ch13.s2) | ch3 to ch13 | `structure/central-relationship`, `structure/hopeful-ending` |
| Both leads get a POV: Kit Merrow narrates ch7.s1 and ch7.s2 | ch7 | `structure/both-leads-pov` |
| Protagonist agency: Nell drives most turns (finds clues, sets the trap ch11.s1, closes the sluice ch12.s2) | throughout | `structure/protagonist-agency` |
| Setup and payoff kept: Kit gives Nell his sluice key (ch11.s2), she uses it on the gate (ch12.s2) | ch11 to ch12 | `structure/unpaid-setup` on the key |
| Tension rises to the climax in ch12 | ch9 to ch12 | `structure/tension-curve` early peak |

## The model's own slips (not planted)

- ch11/ch12: the trap was a lie ("the ledger has turned up"), but in ch12.s1 Nell holds the real ledger, and Vane says he burned it.
- ch12.s2: Nell hands Kit the key, then turns the wheel herself while "Kit closed the other gate".
- ch8.s2: Kit has entered damson jam at the fete, a small new detail in the static chapter.
