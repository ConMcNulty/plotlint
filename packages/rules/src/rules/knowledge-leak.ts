import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../evidence.js";
import { frameResolver, OFF_TIMELINE, type FrameResolver } from "../frames.js";
import { hasKind } from "../predicates.js";
import type { Rule } from "../types.js";
import { factFinding, normalize, normalizeValue } from "./facts.js";

// InkOS scopes knowledge to the character who witnessed or learned it: the
// settler records "Mira · learned · Pell is Harrow's son" under the knower. This
// rule pairs such a knowledge-gained fact with a secret ("Pell · true identity ·
// Harrow's son", "vault · location · hidden beneath the chapel") and looks for
// the knower acting on the secret before the chapter they learn it: a goal or a
// deliberate action that names it, or (with chapter text) a line of their
// dialogue that says it. Without a later knowledge fact for the character the
// rule says nothing: plenty of characters know things the state never records.

// Predicates whose very name says the value is concealed.
const SECRET_PREDICATES = new Set([
  "trueidentity", "secretidentity", "realidentity", "hiddenidentity", "realname", "truename", "trueparentage",
  "realparentage", "truefather", "realfather", "secret", "secrets", "truth",
  "真实身份", "真正身份", "隐藏身份", "秘密身份", "真名", "本名", "真实姓名", "秘密", "真相",
]);

// Words in a predicate or value that mark it as concealed.
const SECRET_MARK = /(?<!\p{L})(?:secret(?:ly)?|hidden|concealed|unknown|undisclosed|nobody knows|no one knows)(?!\p{L})|秘密|隐藏|隐瞒|暗中|藏在|藏于|无人知晓|没人知道|不为人知/iu;

// Knowledge-gained predicates, compared after `normalize` as prefixes ("learned that", "discovered the truth about").
const GAINED = /^(?:knows|knew|knowledge|aware|isaware|learn|discover|foundout|findsout|realis|realiz|witnessed|hasseen|overheard|wastold|istold|知道|得知|知晓|获悉|发现|察觉|目睹|听说|知情|明白)/u;
// A belief or a suspicion is not knowledge, and "does not know" is the opposite of it.
const DOUBT = /(?<!\p{L})(?:believes?|suspects?|thinks?|guess(?:es)?|wonders?|whether|if|maybe|perhaps|rumou?rs?|could|might|not|never|no longer|nothing|unaware|doesn't|didn't|isn't|wasn't)(?!\p{L})|怀疑|认为|相信|猜测|猜|是否|难道|也许|或许|传言|据说|莫非|不知|不晓|未|没有|并不|吗/iu;
// Looking for the truth is not having it ("goal · find out whether Pell is Harrow's son").
const INQUIRY = /(?<!\p{L})(?:find(?:s|ing)? out|learn|discover|investigat\w*|uncover|confirm|verify|prove|ask(?:s|ed)? about|question)(?!\p{L})|查明|查清|打听|调查|探查|求证|弄清|证实/iu;

// Predicates for deliberate acts that presuppose knowing their object: telling,
// exposing, seeking out. Plain location is left out: a character can be held in
// the hidden vault without knowing that it is the vault.
const ACTION = /^(?:tell|told|reveal|expos|confront|accus|address|call|blackmail|threat|seek|search|head(?:s|ed)?to|travel\w*to|go(?:es)?to|went(?:to)?|set\w*outfor|dig|dug|open|retriev|plan\w*to|intend\w*to|告诉|告知|揭穿|揭露|透露|质问|称呼|威胁|要挟|前往|去往|寻找|搜寻|打开|挖)/u;

// Words that point at the concealed aspect of a subject without stating it ("learned Pell's true identity").
const ASPECT = /(?<!\p{L})(?:identity|true|real|secret|who|where|whereabouts|location|hidden|parentage|father|mother|truth)(?!\p{L})|身份|真相|秘密|下落|位置|藏/iu;

const LEADING_PLACE = /^(?:in|inside|beneath|under|underneath|below|behind|within|at|on)\s+/iu;
const CJK = /\p{Script=Han}/u;
const ARTICLES = new Set(["the", "a", "an", "of", "and", "lord", "lady", "sir"]);

interface Secret {
  readonly fact: CurrentStateFact;
  /** The concealed value as a normalized string ("harrowsson", "chapel"). */
  readonly value: string;
  /** Long enough to name the secret on its own, without its subject alongside. */
  readonly distinctive: boolean;
}

const cjkCount = (text: string) => [...text].filter((char) => CJK.test(char)).length;

/** The concealed value of a secret fact, or null when the fact does not record one. */
function readSecret(fact: CurrentStateFact): Secret | null {
  if (hasKind(fact, "knowledge") || isKnowledgeGained(fact)) return null;
  const marked = SECRET_PREDICATES.has(normalize(fact.predicate)) || SECRET_MARK.test(fact.predicate);
  let raw = fact.object;
  const mark = SECRET_MARK.exec(raw);
  if (mark) {
    // "beneath the chapel (secret)", "Harrow's son, a secret he keeps", "hidden beneath the chapel".
    const before = raw.slice(0, mark.index).split(/[,;(（，；—–]/u)[0]!.trim();
    raw = before || raw.slice(mark.index + mark[0].length).split(/[,;(（，；—–]/u)[0]!.trim();
  } else if (!marked) {
    return null;
  }
  // "unknown to Mira", "hidden from all": who it is hidden from is not the value.
  raw = raw.replace(/^(?:to|from)\s+\S+\s*/iu, "").replace(/\s+(?:to|from)\s+(?:all|everyone|others)$/iu, "").replace(LEADING_PLACE, "")
    // "secret · is Harrow's son" records the same value as "true identity · Harrow's son".
    .replace(/^(?:is|was|are)\s+/iu, "").replace(/^是/u, "");
  const value = normalizeValue(raw);
  const cjk = cjkCount(value);
  if (cjk ? cjk < 2 : value.length < 4) return null;
  return { fact, value, distinctive: cjk ? cjk >= 3 : value.length >= 8 };
}

/** The forms a name appears in: the full name, and for a multi-word name its first and last words. */
function nameForms(name: string): string[] {
  const full = name.trim().replace(/^(?:the|a|an)\s+/iu, "");
  const words = full.split(/\s+/u).filter((word) => !ARTICLES.has(word.toLowerCase()) && word.length >= 3);
  return [...new Set([full, ...(words.length > 1 ? [words[0]!, words[words.length - 1]!] : [])])];
}

// A name as a pattern: whole words for Latin names ("Pell" not in "dispelled");
// a Chinese name not right after 对/向/跟 ("苏晴对林远说" is 苏晴 speaking).
const formPattern = (form: string) => CJK.test(form)
  ? `(?<![对向跟和朝给])${escapeRegex(form)}`
  : `(?<!\\p{L})${form.split(/\s+/u).map(escapeRegex).join("\\s+")}(?!\\p{L})`;
const namePattern = (name: string) => nameForms(name).map(formPattern).join("|");

/** True when `text` names `subject` by its full name or a first or last word. */
const mentions = (text: string, subject: string) => new RegExp(namePattern(subject), "iu").test(text);

/** True when `text` states the secret: its value, plus its subject unless the value names it alone. */
function states(text: string, secret: Secret, aboutSubject = false): boolean {
  if (!normalizeValue(text).includes(secret.value)) return false;
  return secret.distinctive || aboutSubject || mentions(text, secret.fact.subject);
}

const isKnowledgeGained = (fact: CurrentStateFact) =>
  (GAINED.test(normalize(fact.predicate)) || fact.kind === "knowledge")
  && !DOUBT.test(`${fact.predicate} ${fact.object}`);

/** True when a knowledge fact is about the secret: it states it, or names its subject and the concealed aspect. */
function knowsSecret(knowledge: CurrentStateFact, secret: Secret): boolean {
  const text = `${knowledge.predicate} ${knowledge.object}`;
  return states(text, secret) || (mentions(knowledge.object, secret.fact.subject) && ASPECT.test(text));
}

const presupposing = (fact: CurrentStateFact) =>
  fact.validUntilChapter === null || fact.validUntilChapter >= fact.validFromChapter
    ? (hasKind(fact, "goal") || ACTION.test(normalize(fact.predicate)))
      && !hasKind(fact, "knowledge")
      && !INQUIRY.test(fact.object)
      && !DOUBT.test(fact.object)
    : false;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// Dialogue: a quote and a speech tag naming the speaker right before or after it.
const QUOTE = /“[^”]*”|"[^"\n]*"|「[^」]*」|『[^』]*』/gu;
const PARAGRAPH = /(?:[^\n]|\n(?![ \t]*\r?\n))+/gu;
const SPEECH = "said|says|asked|asks|replied|replies|answered|whispered|shouted|muttered|murmured|called|cried|added|snapped|told\\s+\\p{L}+";
const SPEECH_CJK = "说|(?<!知)道|问|答|喊|叫";

function speakerPatterns(name: string): { after: RegExp; before: RegExp } {
  const forms = namePattern(name);
  const tag = `(?:${forms})\\s+(?:${SPEECH})|(?:${SPEECH})\\s+(?:${forms})|(?:${forms})[^“”"「」。！？\\n]{0,6}(?:${SPEECH_CJK})`;
  return {
    after: new RegExp(`^\\s*[,，]?\\s*(?:${tag})`, "iu"),
    before: new RegExp(`(?:(?:${tag})\\s*[,:：，]?|(?:^|\\n)\\s*(?:${forms})\\s*[:：])\\s*$`, "iu"),
  };
}

interface Line {
  readonly chapter: number;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly paragraph: string;
}

/** The first line of `speaker`'s dialogue in `chapter` that states the secret. */
function spokenLeak(chapters: ChapterTexts, chapter: number, speaker: string, secret: Secret, frames: FrameResolver): Line | null {
  const text = chapters.get(chapter);
  if (text === undefined) return null;
  const { after, before } = speakerPatterns(speaker);
  for (const paragraph of text.matchAll(PARAGRAPH)) {
    const quotes = [...paragraph[0].matchAll(QUOTE)];
    for (const [i, quote] of quotes.entries()) {
      const inner = quote[0].slice(1, -1);
      // A question or a doubt is not knowledge ("Is Pell Harrow's son?").
      if (/[?？]\s*$/u.test(inner) || DOUBT.test(inner) || !states(inner, secret)) continue;
      const qStart = quote.index;
      const qEnd = qStart + quote[0].length;
      const tagBefore = paragraph[0].slice(i > 0 ? quotes[i - 1]!.index + quotes[i - 1]![0].length : 0, qStart);
      const tagAfter = paragraph[0].slice(qEnd, i + 1 < quotes.length ? quotes[i + 1]!.index : undefined);
      if (!after.test(tagAfter) && !before.test(tagBefore)) continue;
      // Dialogue in a flashback, dream or story within the story is not the present.
      const probe: CurrentStateFact = {
        subject: speaker, predicate: "says", object: inner, validFromChapter: chapter, validUntilChapter: chapter,
        sourceChapter: chapter, evidence: { quote: paragraph[0] },
      };
      if (OFF_TIMELINE.has(frames.frameOf(probe)?.frame ?? "main")) continue;
      const start = paragraph.index + qStart;
      return { chapter, start, end: start + quote[0].length, quote: quote[0], paragraph: paragraph[0] };
    }
  }
  return null;
}

export const knowledgeLeak: Rule = {
  id: "continuity/knowledge-leak",
  layer: "continuity",
  title: "Knowledge leaks",
  rationale: "A character can only act on what they know. One who names a secret, seeks it out or says it aloud before the chapter in which they learn it either knew it all along (so the later discovery is wrong) or is leaking the author's knowledge.",
  check({ snapshot, chapters, book }) {
    const facts = snapshot.currentState.facts;
    const secrets = facts.map(readSecret).filter((secret): secret is Secret => secret !== null);
    if (secrets.length === 0) return [];
    const knowledge = facts.filter(isKnowledgeGained);
    const frames = frameResolver(book?.frames, chapters);
    // One finding per knower and secret, at the earliest leak.
    const findings = new Map<string, Diagnostic>();

    for (const secret of [...secrets].sort((a, b) => a.fact.validFromChapter - b.fact.validFromChapter)) {
      const byKnower = new Map<string, CurrentStateFact>();
      for (const fact of knowledge) {
        if (!knowsSecret(fact, secret)) continue;
        const knower = normalize(fact.subject);
        const first = byKnower.get(knower);
        if (!first || fact.validFromChapter < first.validFromChapter) byKnower.set(knower, fact);
      }

      for (const [knower, learned] of byKnower) {
        const key = `${knower}\u0000${normalize(secret.fact.subject)}\u0000${secret.value}`;
        if (findings.has(key)) continue;
        const learnedAt = learned.validFromChapter;
        const aboutSelf = normalize(secret.fact.subject) === knower;

        const acted = facts
          .filter((fact) => normalize(fact.subject) === knower && fact.validFromChapter < learnedAt
            && fact !== learned && fact !== secret.fact && presupposing(fact)
            && states(`${fact.predicate} ${fact.object}`, secret, aboutSelf))
          .sort((a, b) => a.validFromChapter - b.validFromChapter)[0];

        let spoken: Line | null = null;
        if (chapters) {
          // Dialogue in the chapter of the earliest acting fact wins: it has a range to underline.
          const last = Math.min(learnedAt - 1, acted ? acted.validFromChapter : Infinity);
          for (let chapter = secret.fact.validFromChapter + 1; chapter <= last && !spoken; chapter += 1) {
            spoken = spokenLeak(chapters, chapter, learned.subject, secret, frames);
          }
        }

        const where = `before learning it in chapter ${learnedAt}`;
        if (spoken) {
          const finding = factFinding(this, {
            chapter: spoken.chapter,
            summary: `${learned.subject} says ${secret.fact.subject}'s secret (${secret.fact.object}) in chapter ${spoken.chapter}, ${where}.`,
            evidence: [
              ...(acted?.validFromChapter === spoken.chapter ? [["acts on it", acted] as const] : []),
              ["secret", secret.fact], ["learns it", learned],
            ],
          });
          const sourceId = `chapter:${spoken.chapter}`;
          findings.set(key, {
            ...finding,
            evidence: [`dialogue (ch${spoken.chapter}): ${spoken.quote}`, ...finding.evidence],
            range: { sourceId, start: spoken.start, end: spoken.end },
            sourceRefs: [{ sourceId, quote: spoken.quote }],
          });
        } else if (acted) {
          findings.set(key, factFinding(this, {
            chapter: acted.validFromChapter,
            summary: `${learned.subject} acts on ${secret.fact.subject}'s secret (${secret.fact.object}) in chapter ${acted.validFromChapter}, ${where}.`,
            evidence: [["acts on it", acted], ["secret", secret.fact], ["learns it", learned]],
          }));
        }
      }
    }
    return [...findings.values()];
  },
};
