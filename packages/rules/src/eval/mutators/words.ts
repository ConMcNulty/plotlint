// Keyword groups for judging whether an auditor issue is about a seeded error
// (see Mutant.match): a name group and a topic group, each matched as a
// case-insensitive substring of the issue's summary and evidence.

export const ELSPETH = ["Elspeth"];
export const JONAS = ["Jonas"];
export const CRANE = ["Crane", "Absalom", "ferryman"];
export const THORNE = ["Thorne", "warden"];
export const ROOK = ["Rook", "innkeeper"];
export const TOBIAS = ["Tobias", "father"];

export const DEATH = ["dead", "died", "dies", "death", "deceased", "alive", "killed", "drown", "corpse", "ghost", "buried", "funeral", "resurrect", "revive", "living", "back from"];
export const PLACE = ["location", "place", "two places", "same time", "simultaneous", "both", "at once", "already", "meanwhile", "elsewhere", "whereabouts", "presence", "present", "stavely", "wenlow", "saltmere", "gorse", "abbey", "mill", "heron", "cottage", "landing"];
export const ITEM = ["compass", "ledger", "key", "strongbox", "lantern", "box"];
export const MONEY = ["shilling", "money", "penn", "coin", "negative", "debt", "afford", "more than she had", "funds", "purse", "spent", "paid"];
export const AGE = ["age", "years old", "year-old", "older", "younger", "sixteen", "seventeen", "seventy", "sixty", "forty", "fifty"];
export const LIFE = ["alive", "dead", "died", "death", "living", "deceased"];
export const TRAVEL = ["travel", "journey", "distance", "days", "day's walk", "too quickly", "too fast", "impossible", "saltmere", "same day", "same night", "time"];
export const DATE = ["date", "october", "september", "timeline", "chronolog", "earlier", "backward", "before", "day"];
export const PASSENGERS = ["passenger", "three", "licen", "limit", "capacity", "overload", "rule"];
export const SECRET = ["flagstone", "strongbox", "know", "learn", "secret", "how did", "before", "not yet", "told"];
export const PASK = ["Pask", "alderman"];
