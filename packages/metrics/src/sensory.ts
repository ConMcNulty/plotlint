/**
 * Small, hand-picked word lists per sense, for the sensory-detail density metric.
 *
 * The lists hold concrete perception words (verbs of perceiving and words that
 * name what is perceived: colours, light, noises, odours, flavours, textures,
 * temperatures), not abstract emotion words. They are deliberately short and
 * high-precision: a word that is mostly used figuratively ("feel", "touch" in
 * "touched by her kindness", "see" as "understand") is left out, so the density
 * undercounts rather than overcounts. Matching is on lowercase word forms, with
 * the plain inflections `-s`, `-es`, `-ed`, `-d`, `-ing` and `-ly` stripped, so
 * the lists carry base forms only.
 *
 * The aim is a floor ("this chapter names almost nothing a reader could see,
 * hear, smell, taste or touch"), never a quota.
 */
export type Sense = "sight" | "sound" | "smell" | "taste" | "touch";

export const SENSES: ReadonlyArray<Sense> = ["sight", "sound", "smell", "taste", "touch"];

export const SENSORY_WORDS: Readonly<Record<Sense, ReadonlyArray<string>>> = {
  sight: [
    "glimpse", "glance", "glare", "gleam", "glint", "glitter", "glow", "shimmer", "sparkle", "flicker", "flash", "shadow", "shade",
    "silhouette", "dim", "bright", "dazzle", "blaze", "haze", "hazy", "murk", "murky", "gloom", "dark", "darkness", "light", "lit",
    "lamplight", "moonlight", "sunlight", "candlelight", "firelight", "pale", "red", "crimson", "scarlet", "blue", "green", "yellow",
    "golden", "gold", "silver", "grey", "gray", "black", "white", "brown", "purple", "violet", "orange", "pink", "amber", "ivory",
    "colour", "color", "stare", "gaze", "peer", "squint", "watch", "stain", "blur",
  ],
  sound: [
    "sound", "noise", "hear", "heard", "listen", "echo", "whisper", "murmur", "mutter", "hum", "buzz", "hiss", "crackle", "creak",
    "squeak", "rattle", "clatter", "clang", "clank", "clink", "jingle", "ring", "rang", "chime", "toll", "bang", "thud", "thump",
    "knock", "tap", "crash", "roar", "rumble", "thunder", "howl", "wail", "shriek", "scream", "yell", "shout", "sob", "groan", "moan",
    "sigh", "laugh", "giggle", "snort", "bark", "chirp", "screech", "rustle", "patter", "splash", "drip", "silence", "silent", "hush",
    "quiet", "loud", "shrill", "muffle", "click", "snap", "crunch",
  ],
  smell: [
    "smell", "smelt", "scent", "odour", "odor", "aroma", "fragrance", "fragrant", "perfume", "stench", "stink", "stank", "reek",
    "whiff", "sniff", "musty", "musk", "rank", "acrid", "pungent", "rancid", "smoke", "smoky", "incense",
  ],
  taste: [
    "taste", "tasted", "flavour", "flavor", "sweet", "sour", "bitter", "salt", "salty", "savoury", "savory", "spice", "spicy",
    "tang", "tangy", "honey", "sugar", "lick", "sip", "swallow", "gulp", "chew", "bite", "tongue", "bland", "ripe",
  ],
  touch: [
    "cold", "chill", "chilly", "icy", "frozen", "cool", "warm", "warmth", "hot", "heat", "damp", "wet", "moist", "dry", "rough",
    "smooth", "soft", "hard", "sharp", "blunt", "prickle", "sting", "itch", "tingle", "numb", "ache", "throb", "sticky", "slick",
    "slippery", "greasy", "silky", "velvet", "coarse", "gritty", "grit", "brittle", "jagged", "clammy", "sweat", "shiver", "shudder",
    "pressure", "grip", "stroke", "caress", "brush", "graze", "rub", "texture", "weight", "heavy", "feather",
  ],
};

const bySense = new Map<string, Sense>();
for (const sense of SENSES) for (const word of SENSORY_WORDS[sense]) if (!bySense.has(word)) bySense.set(word, sense);

const SUFFIXES = ["ing", "ed", "es", "ly", "s", "d"];

/** The sense a word names, if any, trying the word itself and then its base form. */
export function senseOf(norm: string): Sense | undefined {
  const direct = bySense.get(norm);
  if (direct) return direct;
  for (const suffix of SUFFIXES) {
    if (norm.length <= suffix.length + 2 || !norm.endsWith(suffix)) continue;
    const stem = norm.slice(0, -suffix.length);
    const hit = bySense.get(stem) ?? bySense.get(`${stem}e`)
      // Doubled consonant before -ing/-ed: "dimmed", "throbbing".
      ?? (stem.length > 2 && stem.at(-1) === stem.at(-2) ? bySense.get(stem.slice(0, -1)) : undefined);
    if (hit) return hit;
  }
  return undefined;
}
