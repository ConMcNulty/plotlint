---
name: fantasy
description: Check pack for fantasy and science fiction. World rules, travel and resource ledgers become errors; a tighter wall-of-text band against exposition dumps; fantasy clichés.
---

# Fantasy and science fiction pack

For secondary-world fantasy, science fiction and web-novel genres such as xuanhuan
and xianxia. Stacks on the general pack, and with romance for romantasy. Where it
conflicts with another selected pack the stricter setting wins; your `rules.json`
overrides both.

## What it tightens, and why

| Check | Setting | Tradition |
| --- | --- | --- |
| `continuity/world-rule-broken` | error | Sanderson's laws of magic ("limitations are greater than powers"): a stated cost or limit that a later scene ignores breaks the reader's trust in every later stake. Hard SF's equivalent is the rule that the science is consistent once stated. |
| `continuity/impossible-travel` | error | Tolkien's practice of plotting journeys against the map and the calendar; readers of the genre check. |
| `continuity/negative-resource` | error | Mana, ammunition and qi are the genre's stakes; spending what was never there (LitRPG and progression-fantasy ledgers) undoes them. |
| `metrics/wall-of-text` | max 300 words per paragraph | "As you know, Bob" exposition (the SF workshop tradition, e.g. the Turkey City Lexicon) tends to arrive as one long block. |
| `style/fantasy.Cliches` | note | "An ancient evil", "the chosen one" (Diana Wynne Jones, *The Tough Guide to Fantasyland*). |

## Planned

These need rule functions that come in a later wave:

- **Invented-term consistency**: invented names and terms keep one spelling and one meaning.
- **Exposition density**: flags chapters where world-explaining sentences outweigh scene.
- **Power-scaling order**: levels and ranks only move in the stated order (shared with a future progression pack).
