---
name: romance
description: Check pack for romance. Turns protagonist agency, subplot balance and the tension curve down to notes; raises the dialogue floor; adds romance clichés.
---

# Romance pack

For romance and romantic fiction, alone or stacked (romantasy = romance + fantasy).
Stacks on the general pack. Where it conflicts with another selected pack the
stricter setting wins; your `rules.json` overrides both.

## What it changes, and why

| Check | Setting | Tradition |
| --- | --- | --- |
| `structure/protagonist-agency` | note | Romance has two protagonists and the plot is what they do to each other (Romance Writers of America's definition: "a central love story"; Gwen Hayes, *Romancing the Beat*). A single-protagonist agency share misreads it. |
| `structure/subplot-balance` | note | The relationship is the main plot; subplots receding during the crisis is the genre's shape. |
| `structure/tension-curve` | note | Tension in romance is emotional (the "black moment", the dark night before the grand gesture), which a stakes estimate tracks poorly. |
| `structure/scene-turn` | note | Many romance scenes turn on a look or a withheld word; value turns read them badly. |
| `metrics/dialogue-ratio` | min 0.15 | Banter and confession carry the genre (Hayes; Jennifer Crusie's essays on romantic comedy); a near-silent chapter is worth a look. |
| `style/romance.Cliches` | note | The "breath she didn't know she was holding" family of stock phrases, skipped in dialogue. |

## Planned

These need rule functions that come in a later wave:

- **Both leads get POV or interiority**: each lead's thoughts appear on the page, not only one's (dual-POV convention).
- **The relationship drives the main plot**: turning points involve both leads.
- **Required beats**: meet, rising bond, crisis (black moment), grand gesture, in order (*Romancing the Beat*).
- **Happy or hopeful ending (HEA/HFN)**: a warning when the ending is neither, since readers of the genre rely on it (RWA).
