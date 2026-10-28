---
name: fantasy
description: Check pack for fantasy and science fiction. World rules, travel and resource ledgers become errors; dialogue, sensory-detail and wall-of-text bands measured on fantasy reference books; one spelling per invented term; fantasy clichés.
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
| `style/invented-term-spelling` | warning | Invented names have no dictionary, so spellcheck cannot keep them straight; series editors keep a bible of terms for that. Flags a rare spelling one or two letters, a hyphen or an apostrophe away from a capitalised term the book uses often ("Aes Sedia" for "Aes Sedai", "Mist-born" for "Mistborn"), at each use, with a quick fix to the usual spelling. Names the story state records as separate entities are left alone. A note in the general pack. |
| `metrics/dialogue-ratio` | 0 to 0.69 | Measured on the fantasy reference books (MacDonald, Morris, Dunsany, Haggard, Baum): quests alone or among strangers leave chapters almost without dialogue, so there is no floor; the ceiling is their 95th percentile. |
| `metrics/sensory-detail` | min 7 per 1,000 words | Secondary worlds are built through the senses; the reference books' 5th percentile sits well above general fiction's. |
| `metrics/wall-of-text` | max 541 words per paragraph | Their 95th percentile. Exposition ("As you know, Bob", the Turkey City Lexicon) arrives as long blocks, but the genre's own paragraphs run long: a 300-word ceiling flagged two reference chapters in five. |
| `style/fantasy.Cliches` | note | "An ancient evil", "the chosen one" (Diana Wynne Jones, *The Tough Guide to Fantasyland*). |

## Planned

These need rule functions that come in a later wave:

One spelling per invented term is now `style/invented-term-spelling` above. Still to come:

- **Invented-term meaning**: an invented term keeps one meaning.
- **Exposition density**: flags chapters where world-explaining sentences outweigh scene.
- **Power-scaling order**: levels and ranks only move in the stated order (shared with a future progression pack).
