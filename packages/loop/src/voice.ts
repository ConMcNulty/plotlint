import { dialogueRatio, proseWords, sentences } from "@plotlint/metrics";

// Voice distance: how far a revision has moved from the author's voice sample.
// Stylometry's most robust signal is the rate of common function words
// (Mosteller and Wallace 1964; Burrows 2002, "Delta"), which writers use without
// choosing them and which a reviser sanding the prose down shifts. Sentence length,
// its spread, word length and the share of dialogue are added as log ratios. The
// number has no unit; compare it with the distance between two chapters of the
// same book, which is what `voiceLimit` does.

const FUNCTION_WORDS = [
  "the", "and", "a", "of", "to", "in", "he", "she", "it", "was", "had", "that", "his", "her", "i", "you", "with", "as", "on", "at",
  "for", "but", "not", "they", "be", "were", "from", "by", "is", "said", "him", "all", "so", "there", "one", "or", "an", "have",
  "would", "we", "if", "no", "out", "up", "into", "then", "could", "been", "this", "what", "when", "their", "them", "which", "my",
  "me", "down", "like", "back", "only", "over", "now", "before", "through", "still", "even", "just", "very", "too", "again", "who",
  "upon", "though", "while", "where", "about", "after", "some", "more", "than", "its", "our", "your", "did", "do", "are", "will",
] as const;
const INDEX = new Map<string, number>(FUNCTION_WORDS.map((word, index) => [word, index]));

export interface VoiceProfile {
  /** Rate of each function word per word of prose. */
  readonly rates: ReadonlyArray<number>;
  readonly meanSentence: number;
  readonly sentenceCv: number;
  readonly meanWordLength: number;
  readonly dialogue: number;
  readonly words: number;
}

export function voiceProfile(text: string): VoiceProfile {
  const tokens = proseWords(text);
  const counts = new Array<number>(FUNCTION_WORDS.length).fill(0);
  let letters = 0;
  for (const token of tokens) {
    const index = INDEX.get(token.norm);
    if (index !== undefined) counts[index]! += 1;
    letters += token.end - token.start;
  }
  const lengths = sentences(text).map((sentence) => sentence.words);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const sd = lengths.length > 1 ? Math.sqrt(lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (lengths.length - 1)) : 0;
  const n = Math.max(tokens.length, 1);
  return {
    rates: counts.map((count) => count / n),
    meanSentence: mean,
    sentenceCv: mean > 0 ? sd / mean : 0,
    meanWordLength: letters / n,
    dialogue: dialogueRatio(text).ratio,
    words: tokens.length,
  };
}

// Small offsets keep a log ratio finite when one side is zero.
const logRatio = (a: number, b: number, floor: number) => Math.abs(Math.log((a + floor) / (b + floor)));

/**
 * Distance between two texts' voices: 1 − cosine similarity of the function-word
 * rates (square-rooted, so the commonest words do not swamp the rest), plus a
 * quarter of the mean log ratio of the four other features. 0 for identical texts.
 */
export function voiceDistance(a: VoiceProfile | string, b: VoiceProfile | string): number {
  const pa = typeof a === "string" ? voiceProfile(a) : a;
  const pb = typeof b === "string" ? voiceProfile(b) : b;
  let dot = 0, na = 0, nb = 0;
  for (let index = 0; index < pa.rates.length; index += 1) {
    const x = Math.sqrt(pa.rates[index]!);
    const y = Math.sqrt(pb.rates[index]!);
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const cosine = na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : na === nb ? 1 : 0;
  const shape = (logRatio(pa.meanSentence, pb.meanSentence, 1) + logRatio(pa.sentenceCv, pb.sentenceCv, 0.05)
    + logRatio(pa.meanWordLength, pb.meanWordLength, 0.5) + logRatio(pa.dialogue, pb.dialogue, 0.05)) / 4;
  return Math.max(0, 1 - cosine) + shape / 4;
}

/**
 * The default voice-distance limit for a book: half the median distance between two
 * of its chapters (chapters of at least 300 words). A revision that has moved from the
 * sample by half as much as a different chapter of the same book is no longer a
 * revision of that voice. Without two usable chapters, `fallback`.
 */
export function voiceLimit(chapters: ReadonlyArray<string>, fallback = 0.04): number {
  const profiles = chapters.map(voiceProfile).filter((profile) => profile.words >= 300);
  const distances: number[] = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) distances.push(voiceDistance(profiles[i]!, profiles[j]!));
  }
  if (distances.length === 0) return fallback;
  distances.sort((x, y) => x - y);
  const mid = Math.floor(distances.length / 2);
  const median = distances.length % 2 ? distances[mid]! : (distances[mid - 1]! + distances[mid]!) / 2;
  return median / 2;
}
