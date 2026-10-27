import { extractJson, type CompleteFn, type CompileMessage } from "@plotlint/rules";
import { GENERAL_PACK, type PackCatalog } from "./schema.js";

/** A pack selection with the reasoning shown to the author before they accept it. */
export interface PackProposal {
  readonly packs: string[];
  readonly reasoning: string;
}

const ascii = (word: string) => /^[\x20-\x7e]+$/u.test(word);

function mentions(text: string, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  if (!ascii(lower)) return text.includes(lower);
  const escaped = lower.replace(/[.+?^${}()|[\]\\*]/gu, "\\$&").replace(/[\s_-]+/gu, "[\\s_-]*");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "u").test(text);
}

/**
 * Propose packs from InkOS's free-text genre field (`book.json`'s `genre`: "xuanhuan",
 * "romantasy", "cozy mystery", 悬疑...) by each pack's `selection.keywords`. Returns
 * undefined when nothing matches, so the caller can ask the LLM instead.
 */
export function proposeFromGenre(genre: string | undefined, catalog: PackCatalog): PackProposal | undefined {
  const text = genre?.trim().toLowerCase();
  if (!text) return undefined;
  const matches: Array<[string, string]> = [];
  for (const [name, pack] of [...catalog].sort(([a], [b]) => a.localeCompare(b))) {
    if (name === GENERAL_PACK) continue;
    const keyword = pack.manifest.selection?.keywords?.find((word) => mentions(text, word));
    if (keyword) matches.push([name, keyword]);
  }
  if (!matches.length) return undefined;
  return {
    packs: matches.map(([name]) => name),
    reasoning: `The book's genre is "${genre!.trim()}": ${matches.map(([name, keyword]) => `"${keyword}" selects ${name}`).join("; ")}.`,
  };
}

export interface ProposalInput {
  readonly title?: string;
  readonly genre?: string;
  /** The author's brief (`story/author_intent.md`). */
  readonly brief?: string;
  /** Opening chapters, for an imported manuscript. */
  readonly chapters?: ReadonlyArray<string>;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[...]` : text);

export function proposalPrompt(input: ProposalInput, catalog: PackCatalog): CompileMessage[] {
  const packs = [...catalog.values()].filter((pack) => pack.manifest.name !== GENERAL_PACK)
    .map((pack) => `- ${pack.manifest.name}: ${pack.manifest.title}. ${pack.manifest.description}`).join("\n");
  const parts = [
    input.title ? `Title: ${input.title}` : "",
    input.genre ? `Genre field: ${input.genre}` : "",
    input.brief?.trim() ? `Author's brief:\n${clip(input.brief.trim(), 3000)}` : "",
    ...(input.chapters ?? []).map((text, index) => `Chapter ${index + 1} (opening):\n${clip(text.trim(), 4000)}`),
  ].filter(Boolean);
  return [
    {
      role: "system",
      content: [
        "You choose genre check packs for a novel in a fiction linter. The general pack always runs; pick the genre packs whose craft",
        "conventions the book follows. Mixed genres stack (a romantasy is romance + fantasy). Pick none when no pack fits.",
        `Available packs:\n${packs}`,
        "Reply with only a JSON object: {\"packs\": [\"name\", ...], \"reasoning\": \"two or three sentences citing the brief or the text\"}.",
      ].join("\n"),
    },
    { role: "user", content: parts.join("\n\n") || "(no brief or chapters yet)" },
  ];
}

/** Parse a model's proposal, keeping only packs the catalog has. */
export function parseProposal(reply: string, catalog: PackCatalog): PackProposal | string {
  const json = extractJson(reply);
  if (json === null) return "the reply has no JSON object";
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return `the JSON does not parse: ${(error as Error).message}`;
  }
  const { packs, reasoning } = (parsed ?? {}) as { packs?: unknown; reasoning?: unknown };
  if (!Array.isArray(packs) || packs.some((name) => typeof name !== "string")) return "\"packs\" must be an array of pack names";
  if (typeof reasoning !== "string" || !reasoning.trim()) return "\"reasoning\" must be a non-empty string";
  const names = [...new Set((packs as string[]).map((name) => name.trim().toLowerCase()))];
  const unknown = names.filter((name) => !catalog.has(name));
  if (unknown.length) return `unknown packs ${unknown.join(", ")}; choose from ${[...catalog.keys()].join(", ")}`;
  return { packs: names.filter((name) => name !== GENERAL_PACK), reasoning: reasoning.trim() };
}

/** Ask the LLM for a selection; a reply that does not parse is sent back once with the problem. */
export async function proposePacks(input: ProposalInput, catalog: PackCatalog, complete: CompleteFn, attempts = 2): Promise<PackProposal> {
  const messages = proposalPrompt(input, catalog);
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const reply = await complete(messages);
    const result = parseProposal(reply, catalog);
    if (typeof result !== "string") return result;
    lastError = result;
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `That reply could not be used: ${result}. Reply again with only the corrected JSON object.` },
    );
  }
  throw new Error(`Could not get a pack proposal after ${attempts} attempts: ${lastError}`);
}
