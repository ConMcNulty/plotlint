import type { Diagnostic } from "@plotlint/diagnostics";
import { textDiagnostic, type ChapterTexts, type Rule } from "@plotlint/rules";
import { metricRuleInfo } from "./rules.js";
import { isMostlyCjk, proseParagraphs, sentences, words, type Span } from "./text.js";

// Function words: a gram made only of these ("and then he was") is ordinary English, not a tic.
const STOPWORDS = new Set(`
a an the and or but nor so yet for of to in on at by with from into onto upon over under about above below after before
between through during without within against among across along around behind beyond near off out up down than then
as if when while where whence until till because since though although unless whether that this these those there here
i me my mine we us our ours you your yours he him his she her hers it its they them their theirs one ones oneself
myself yourself himself herself itself ourselves themselves who whom whose which what whatever whoever
is am are was were be been being have has had having do does did doing done will would shall should can could may might must
not no yes all any some each every both either neither such own same other another more most much many few little less least
very too quite just only even still also again ever never always now once how why
s t d ll re ve m don't didn't won't can't couldn't wouldn't wasn't weren't isn't aren't hadn't hasn't haven't i'm i'd i'll i've
he's she's it's that's there's what's let's you're you'd you'll we're they're they'd they'll
`.split(/\s+/u).filter(Boolean));

// Speech verbs: "she said to him" and the like are dialogue tags, repeated by design.
const SPEECH_VERBS = new Set(`
say says said saying ask asks asked asking reply replies replied answer answers answered tell tells told
whisper whispered murmur murmured mutter muttered shout shouted cry cried call called add added continue continued
repeat repeated exclaim exclaimed snap snapped sigh sighed laugh laughed nod nodded begin began
`.split(/\s+/u).filter(Boolean));

export interface RepeatedPhraseOptions {
  /** Shortest and longest grams, in words (4 to 7). */
  readonly minWords?: number;
  readonly maxWords?: number;
  /** A phrase is reported once it appears in at least this many chapters (3). */
  readonly minChapters?: number;
  /** Character and place names (e.g. the project dictionary); grams of only names, tags and function words are ignored. */
  readonly names?: ReadonlyArray<string>;
}

export interface RepeatedPhrase {
  /** The normalised words of the phrase, space-separated. */
  readonly phrase: string;
  /** Chapters it appears in, ascending. */
  readonly chapters: number[];
  readonly occurrences: Array<Span & { chapter: number }>;
}

interface Token { readonly norm: string; readonly start: number; readonly end: number; readonly sentence: number }

function tokenize(text: string): Token[] {
  const paragraphs = proseParagraphs(text);
  return sentences(text, paragraphs).flatMap((sentence, index) =>
    words(text.slice(sentence.start, sentence.end), sentence.start).map((word) => ({ ...word, sentence: index })));
}

const nameWords = (names: ReadonlyArray<string>) =>
  new Set(names.flatMap((name) => words(name).map((word) => word.norm.replace(/'s$/u, ""))));

/**
 * Phrases of `minWords` to `maxWords` words that recur in `minChapters` or more
 * chapters. Grams stay inside one sentence. Longer phrases win: a shorter gram is
 * reported only where it is not part of a longer repeated phrase. Grams whose
 * words are all function words, speech verbs or names are ignored. CJK chapters
 * are skipped.
 */
export function findRepeatedPhrases(chapters: ChapterTexts, options: RepeatedPhraseOptions = {}): RepeatedPhrase[] {
  const minWords = options.minWords ?? 4;
  const maxWords = options.maxWords ?? 7;
  const minChapters = options.minChapters ?? 3;
  const names = nameWords(options.names ?? []);
  const tokens = new Map<number, Token[]>();
  for (const [chapter, text] of chapters) if (!isMostlyCjk(text)) tokens.set(chapter, tokenize(text));
  if (tokens.size < minChapters) return [];

  // How often each word and word pair occurs in the whole book, to spot the book's own terms.
  const counts = new Map<string, number>();
  for (const list of tokens.values()) {
    list.forEach((token, i) => {
      counts.set(token.norm, (counts.get(token.norm) ?? 0) + 1);
      const next = list[i + 1];
      if (next && next.sentence === token.sentence) counts.set(`${token.norm} ${next.norm}`, (counts.get(`${token.norm} ${next.norm}`) ?? 0) + 1);
    });
  }
  const bookTermFloor = 2 * tokens.size;
  const plain = (word: string) => STOPWORDS.has(word) || SPEECH_VERBS.has(word) || names.has(word.replace(/'s$/u, "")) || /^\d+$/u.test(word);
  const ignorable = (gram: ReadonlyArray<string>) => {
    const content = gram.map((word, index) => ({ word, index })).filter(({ word }) => !plain(word));
    if (content.length === 0) return true;
    // "of the lantern house": a book's recurring setting or object (one or two words used
    // twice a chapter or more on average) is vocabulary, not a tic.
    if (content.length <= 2 && content.at(-1)!.index - content[0]!.index === content.length - 1) {
      return (counts.get(content.map(({ word }) => word).join(" ")) ?? 0) >= bookTermFloor;
    }
    return false;
  };
  const covered = new Set<string>();
  const found: RepeatedPhrase[] = [];
  for (let n = maxWords; n >= minWords; n--) {
    const grams = new Map<string, Array<{ chapter: number; index: number }>>();
    for (const [chapter, list] of tokens) {
      for (let i = 0; i + n <= list.length; i++) {
        if (list[i]!.sentence !== list[i + n - 1]!.sentence) continue;
        const key = list.slice(i, i + n).map((token) => token.norm).join(" ");
        let occurrences = grams.get(key);
        if (!occurrences) grams.set(key, occurrences = []);
        occurrences.push({ chapter, index: i });
      }
    }
    for (const [key, occurrences] of grams) {
      const inChapters = new Set(occurrences.map((occurrence) => occurrence.chapter));
      if (inChapters.size < minChapters || ignorable(key.split(" "))) continue;
      const fresh = occurrences.filter(({ chapter, index }) =>
        Array.from({ length: n }, (_, k) => `${chapter}:${index + k}`).some((position) => !covered.has(position)));
      if (new Set(fresh.map((occurrence) => occurrence.chapter)).size < minChapters) continue;
      for (const { chapter, index } of occurrences) for (let k = 0; k < n; k++) covered.add(`${chapter}:${index + k}`);
      found.push({
        phrase: key,
        chapters: [...inChapters].sort((a, b) => a - b),
        occurrences: fresh.map(({ chapter, index }) => {
          const list = tokens.get(chapter)!;
          return { chapter, start: list[index]!.start, end: list[index + n - 1]!.end };
        }).sort((a, b) => a.chapter - b.chapter || a.start - b.start),
      });
    }
  }
  return found.sort((a, b) => b.chapters.length - a.chapters.length || a.phrase.localeCompare(b.phrase));
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const positive = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined);

/**
 * `metrics/repeated-phrase`: a book-level state rule over `context.chapters`.
 * Each occurrence after the phrase's first chapter gets a ranged note. Options
 * come from the factory and from the book's rule config (`minChapters`,
 * `minWords`, `maxWords`, `names`), and names are taken from the story state's
 * fact subjects too.
 */
export function repeatedPhraseRule(defaults: RepeatedPhraseOptions = {}): Rule {
  const info = metricRuleInfo["metrics/repeated-phrase"];
  const rule: Rule = {
    ...info,
    layer: "metrics",
    check(context): Diagnostic[] {
      if (!context.chapters) return [];
      const options = context.options ?? {};
      const stateNames = (context.snapshot?.currentState?.facts ?? []).map((fact) => fact.subject);
      const phrases = findRepeatedPhrases(context.chapters, {
        minWords: positive(options.minWords) ?? defaults.minWords,
        maxWords: positive(options.maxWords) ?? defaults.maxWords,
        minChapters: positive(options.minChapters) ?? defaults.minChapters,
        names: [...(defaults.names ?? []), ...stringList(options.names), ...stateNames],
      });
      const diagnostics: Diagnostic[] = [];
      for (const phrase of phrases) {
        const first = phrase.chapters[0]!;
        const seen = new Set<number>();
        for (const occurrence of phrase.occurrences) {
          // One note per later chapter, at the phrase's first use there.
          if (occurrence.chapter === first || seen.has(occurrence.chapter)) continue;
          seen.add(occurrence.chapter);
          const text = context.chapters.get(occurrence.chapter)!;
          const here = phrase.occurrences.filter((other) => other.chapter === occurrence.chapter).length;
          const others = phrase.chapters.filter((chapter) => chapter !== occurrence.chapter).map((chapter) => `ch${chapter}`);
          diagnostics.push(textDiagnostic({
            rule,
            document: { sourceId: `chapter:${occurrence.chapter}`, chapter: occurrence.chapter, text },
            start: occurrence.start,
            end: occurrence.end,
            severity: "note",
            summary: `"${phrase.phrase}" recurs in ${phrase.chapters.length} chapters`,
            evidence: [
              `Also in ${others.join(", ")} (${phrase.chapters.length} chapters; reported from ${positive(options.minChapters) ?? defaults.minChapters ?? 3})`,
              ...(here > 1 ? [`${here} times in this chapter`] : []),
            ],
          }));
        }
      }
      return diagnostics;
    },
  };
  return rule;
}

/** The book-level metric rules, for callers that run state rules (the CLI adds them next to `builtinRegistry`). */
export function metricStateRules(options: RepeatedPhraseOptions = {}): Rule[] {
  return [repeatedPhraseRule(options)];
}
