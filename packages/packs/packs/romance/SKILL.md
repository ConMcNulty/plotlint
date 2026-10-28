---
name: romance
description: Check pack for romance. Turns protagonist agency, subplot balance and the tension curve down to notes; checks for a happy or hopeful ending, the relationship's share of the book and both leads' points of view; adds romance clichés.
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
| `structure/hopeful-ending` | warning | RWA's definition of the genre: "a central love story and an emotionally satisfying and optimistic ending" (HEA, happily ever after, or HFN, happy for now). In a finished book, warns when the last relationship fact between the leads is a break-up, a parting or a death with nothing hopeful after it. The leads are the rule option `leads` (two names) or else the pair with the most relationship facts with each other. |
| `structure/central-relationship` | note | The relationship is the main plot (RWA; Hayes): notes when the leads appear together, or their relationship changes, in less than `minShare` (default 40%) of the chapters. |
| `structure/both-leads-pov` | note | Dual-POV convention: notes a lead who never has the point of view in the scene annotations (`story/plotlint/scenes.json`); silent until a book has them. |
| `style/romance.Cliches` | note | The "breath she didn't know she was holding" family of stock phrases, skipped in dialogue. |

## Planned

These need rule functions that come in a later wave:

The happy or hopeful ending, the relationship's share of the book and both leads' points of view are now the checks above. Still to come:

- **Interiority without POV**: a lead who never has a POV scene but whose thoughts the narration does show.
- **The relationship drives the turning points**: each turning point involves both leads.
- **Required beats**: meet, rising bond, crisis (black moment), grand gesture, in order (*Romancing the Beat*).
