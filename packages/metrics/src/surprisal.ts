/**
 * Surprisal scorers for `metrics/predictability`. A scorer gives every word of a
 * chapter's sentences a surprisal in bits (-log2 of the probability its model
 * gave that word in context). The band logic in predictability.ts reads only
 * these numbers, so any model can stand behind it: the built-in one is a word
 * trigram model with Kneser-Ney smoothing trained on the book's other chapters,
 * and a local neural language model can replace it by implementing `Scorer`.
 */

/** One chapter as the scorers see it: sentences of lowercased words. */
export type TokenizedChapter = ReadonlyArray<ReadonlyArray<string>>;

export interface Scorer {
  /** What the numbers are relative to, for the evidence line ("this book's other chapters"). */
  readonly reference: string;
  /** Short name of the model, for the evidence line. */
  readonly name: string;
  /**
   * Surprisal in bits for each word of each sentence of each chapter, in the same
   * shape as the input. Synchronous, since lint rules are: a scorer backed by a
   * slow model should score ahead of time and serve cached numbers here.
   */
  score(book: ReadonlyMap<number, TokenizedChapter>): Map<number, number[][]>;
}

export interface KneserNeyOptions {
  /** Absolute discount at every order (0.75). */
  readonly discount?: number;
}

const BOS = "\u0002";
const SEP = "\u0001";

type Counts = Map<string, number>;
const add = (map: Counts, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const get = (map: ReadonlyMap<string, number>, key: string) => map.get(key) ?? 0;

interface Grams { readonly tri: Counts; readonly bi: Counts }

// Every word of a sentence is predicted from the two before it, `BOS` padding the start.
function grams(chapter: TokenizedChapter, into: Grams = { tri: new Map(), bi: new Map() }): Grams {
  for (const sentence of chapter) {
    let u = BOS;
    let v = BOS;
    for (const w of sentence) {
      add(into.tri, u + SEP + v + SEP + w);
      add(into.bi, v + SEP + w);
      u = v;
      v = w;
    }
  }
  return into;
}

/** Type-level statistics of interpolated Kneser-Ney, kept so a chapter's share can be taken out again. */
interface Stats {
  readonly tri: Counts;        // c(uvw)
  readonly ctx3: Counts;       // c(uv·)
  readonly types3: Counts;     // N1+(uv·)
  readonly cont2: Counts;      // N1+(·vw), which is > 0 exactly when bigram vw occurs
  readonly ctx2: Counts;       // N1+(·v·)
  readonly types2: Counts;     // N1+(v·) over continuation counts
  readonly cont1: Counts;      // N1+(·w)
  cont1Total: number;          // N1+(··)
  vocab: number;               // word types seen
}

function stats(all: Grams): Stats {
  const s: Stats = { tri: all.tri, ctx3: new Map(), types3: new Map(), cont2: new Map(), ctx2: new Map(), types2: new Map(), cont1: new Map(), cont1Total: 0, vocab: 0 };
  for (const [key, count] of all.tri) {
    const [u, v, w] = key.split(SEP) as [string, string, string];
    add(s.ctx3, u + SEP + v, count);
    add(s.types3, u + SEP + v);
    add(s.cont2, v + SEP + w);
    add(s.ctx2, v);
  }
  for (const key of all.bi.keys()) {
    const [v, w] = key.split(SEP) as [string, string];
    add(s.types2, v);
    add(s.cont1, w);
    s.cont1Total++;
  }
  s.vocab = s.cont1.size;
  return s;
}

/**
 * The statistics with one chapter's counts taken out (`held`), as deltas over the
 * whole-book ones: only n-grams that occur in the held-out chapter can change, so
 * leave-one-chapter-out costs one pass over that chapter rather than a retrain.
 */
function heldOut(s: Stats, held: Grams) {
  const tri = new Map<string, number>();
  const ctx3 = new Map<string, number>();
  const types3 = new Map<string, number>();
  const cont2 = new Map<string, number>();
  const ctx2 = new Map<string, number>();
  const types2 = new Map<string, number>();
  const cont1 = new Map<string, number>();
  let cont1Total = 0;
  let vocab = 0;
  for (const [key, count] of held.tri) {
    const [u, v, w] = key.split(SEP) as [string, string, string];
    tri.set(key, count);
    add(ctx3, u + SEP + v, count);
    if (count < get(s.tri, key)) continue;
    // The trigram type vanishes without this chapter.
    add(types3, u + SEP + v);
    add(cont2, v + SEP + w);
    add(ctx2, v);
  }
  for (const [key, removed] of cont2) {
    if (removed >= get(s.cont2, key)) add(types2, key.split(SEP)[0]!);
  }
  for (const [key] of held.bi) {
    // A bigram type vanishes exactly when every trigram ending in it does.
    if (get(cont2, key) < get(s.cont2, key)) continue;
    add(cont1, key.split(SEP)[1]!);
    cont1Total++;
  }
  for (const [w, removed] of cont1) if (removed >= get(s.cont1, w)) vocab++;
  return {
    tri: (k: string) => get(s.tri, k) - get(tri, k),
    ctx3: (k: string) => get(s.ctx3, k) - get(ctx3, k),
    types3: (k: string) => get(s.types3, k) - get(types3, k),
    cont2: (k: string) => get(s.cont2, k) - get(cont2, k),
    ctx2: (k: string) => get(s.ctx2, k) - get(ctx2, k),
    types2: (k: string) => get(s.types2, k) - get(types2, k),
    cont1: (k: string) => get(s.cont1, k) - get(cont1, k),
    cont1Total: s.cont1Total - cont1Total,
    vocab: s.vocab - vocab,
  };
}

/**
 * A word trigram language model with interpolated Kneser-Ney smoothing, scoring
 * each chapter with a model trained on all the others (leave one chapter out).
 * Its surprisal is relative to this book's own prose, not to English: a passage
 * scores low when the rest of the book makes its words easy to guess (stock
 * phrasing, a description reused from another chapter, a ritual exchange). Needs
 * no download and gives the same numbers on every run.
 */
export function kneserNeyScorer(options: KneserNeyOptions = {}): Scorer {
  const D = options.discount ?? 0.75;
  return {
    name: "word trigram model, Kneser-Ney smoothing",
    reference: "this book's other chapters, so predictable for this book, not for English",
    score(book) {
      const all: Grams = { tri: new Map(), bi: new Map() };
      for (const chapter of book.values()) grams(chapter, all);
      const full = stats(all);
      const result = new Map<number, number[][]>();
      for (const [number, chapter] of book) {
        const m = heldOut(full, grams(chapter));
        // An unseen word shares the leftover mass with one slot for "anything else".
        const uniform = 1 / (m.vocab + 1);
        const p1 = (w: string) => {
          if (m.cont1Total <= 0) return uniform;
          return Math.max(m.cont1(w) - D, 0) / m.cont1Total + (D * m.vocab / m.cont1Total) * uniform;
        };
        const p2 = (v: string, w: string) => {
          const ctx = m.ctx2(v);
          if (ctx <= 0) return p1(w);
          return Math.max(m.cont2(v + SEP + w) - D, 0) / ctx + (D * m.types2(v) / ctx) * p1(w);
        };
        const p3 = (u: string, v: string, w: string) => {
          const ctx = m.ctx3(u + SEP + v);
          if (ctx <= 0) return p2(v, w);
          return Math.max(m.tri(u + SEP + v + SEP + w) - D, 0) / ctx + (D * m.types3(u + SEP + v) / ctx) * p2(v, w);
        };
        result.set(number, chapter.map((sentence) => {
          let u = BOS;
          let v = BOS;
          return sentence.map((w) => {
            const bits = -Math.log2(p3(u, v, w));
            u = v;
            v = w;
            return bits;
          });
        }));
      }
      return result;
    },
  };
}
