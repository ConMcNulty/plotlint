// Measure reference novels and write packages/metrics/baselines/<genre>.json, then
// regenerate src/baselines-data.ts from every baselines/*.json so the bands ship
// to the browser without JSON imports.
//
//   pnpm --filter @plotlint/metrics baselines                 measure .corpus/<genre>/*.{json,txt}
//   pnpm --filter @plotlint/metrics baselines -- --download   fetch scripts/corpus.json's books first
//   pnpm --filter @plotlint/metrics baselines -- --sync       only regenerate baselines-data.ts
//   options: --corpus <dir>, --genre <name>
//
// Books listed with `standardEbooks` are read from that Standard Ebooks source
// repository's XHTML (spine order, chapter sections only) and cached as
// .corpus/<genre>/<repo>.json; books listed with `gutenberg` are Project
// Gutenberg plain text, cached as .corpus/<genre>/<number>.txt. Book texts stay
// in the gitignored corpus folder; only the stats are committed. They are data:
// nothing in them is run.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBaseline, gutenbergHeader, splitChapters, standardEbooksChapters, standardEbooksSpine, stripGutenberg,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const corpusDir = resolve(value("--corpus") ?? join(root, ".corpus"));
const onlyGenre = value("--genre");
const manifest = JSON.parse(await readFile(join(root, "scripts", "corpus.json"), "utf-8"));
const genres = Object.keys(manifest).filter((key) => key !== "note" && (!onlyGenre || key === onlyGenre));
const baselinesDir = join(root, "baselines");
const MIN_WORDS = 500;

const SE_RAW = "https://raw.githubusercontent.com/standardebooks";
const SE_REPO = "https://github.com/standardebooks";

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** The manifest entry as a baseline source line. */
function sourceBook(book) {
  const { standardEbooks, gutenberg, title, author, year } = book;
  return {
    title,
    author,
    ...(year ? { year } : {}),
    ...(standardEbooks ? { source: "Standard Ebooks", url: `${SE_REPO}/${standardEbooks}` } : {}),
    ...(gutenberg ? { source: "Project Gutenberg", gutenberg, url: `https://www.gutenberg.org/ebooks/${gutenberg}` } : {}),
  };
}

const fileOf = (book) => (book.standardEbooks ? `${book.standardEbooks}.json` : `${book.gutenberg}.txt`);
const wordCount = (text) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

async function fetchText(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((done) => setTimeout(done, 1000 * attempt));
    }
  }
}

/** A Standard Ebooks book as chapter texts, from its source repository's XHTML files in spine order. */
async function fetchStandardEbook(repo) {
  const base = `${SE_RAW}/${repo}/master/src/epub`;
  const spine = standardEbooksSpine(await fetchText(`${base}/content.opf`));
  const chapters = [];
  for (const href of spine) chapters.push(...standardEbooksChapters(await fetchText(`${base}/${href}`)));
  return chapters;
}

async function download() {
  let failed = 0;
  for (const genre of genres) {
    await mkdir(join(corpusDir, genre), { recursive: true });
    for (const book of manifest[genre]) {
      const path = join(corpusDir, genre, fileOf(book));
      if (await exists(path)) continue;
      const url = book.standardEbooks
        ? `${SE_REPO}/${book.standardEbooks}`
        : `https://www.gutenberg.org/cache/epub/${book.gutenberg}/pg${book.gutenberg}.txt`;
      try {
        if (book.standardEbooks) {
          const chapters = await fetchStandardEbook(book.standardEbooks);
          if (chapters.length === 0) throw new Error("no chapters found");
          await writeFile(path, `${JSON.stringify({ book: sourceBook(book), chapters })}\n`);
        } else {
          await writeFile(path, await fetchText(url));
        }
        console.log(`fetched ${book.title} (${url})`);
      } catch (error) {
        failed++;
        console.error(`could not fetch ${book.title} from ${url}: ${error.cause?.message ?? error.message}`);
      }
    }
  }
  if (failed) console.error(`${failed} book(s) not fetched; place their files in ${corpusDir}/<genre>/ by hand.`);
}

/** Chapters of one corpus file: a fetched Standard Ebooks `.json`, or a Gutenberg plain-text `.txt`. */
async function readBook(genre, file) {
  const raw = await readFile(join(corpusDir, genre, file), "utf-8");
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    const listed = manifest[genre].find((book) => fileOf(book) === file);
    const chapters = (Array.isArray(parsed.chapters) ? parsed.chapters : [])
      .filter((chapter) => typeof chapter === "string" && wordCount(chapter) >= MIN_WORDS);
    const book = listed
      ? sourceBook(listed)
      : { title: String(parsed.book?.title ?? file), author: String(parsed.book?.author ?? "unknown") };
    return { book, chapters };
  }
  const header = gutenbergHeader(raw);
  const listed = manifest[genre].find((book) => fileOf(book) === file || (book.gutenberg && book.gutenberg === header.gutenberg));
  const book = listed
    ? sourceBook(listed)
    : { title: header.title ?? file, author: header.author ?? "unknown", ...(header.gutenberg ? { source: "Project Gutenberg", gutenberg: header.gutenberg } : {}) };
  return { book, chapters: splitChapters(stripGutenberg(raw), MIN_WORDS) };
}

async function measure() {
  for (const genre of genres) {
    const dir = join(corpusDir, genre);
    let files;
    try {
      files = (await readdir(dir)).filter((file) => file.endsWith(".txt") || file.endsWith(".json")).sort();
    } catch {
      console.error(`no corpus for ${genre} at ${dir}; keeping baselines/${genre}.json`);
      continue;
    }
    if (files.length === 0) {
      console.error(`no corpus files in ${dir}; keeping baselines/${genre}.json`);
      continue;
    }
    const books = [];
    for (const file of files) {
      const read = await readBook(genre, file);
      books.push(read);
      console.log(`${genre}: ${read.book.title}, ${read.chapters.length} chapters`);
    }
    // Keep the manifest's order in the committed source list.
    const order = (book) => manifest[genre].findIndex((listed) => listed.title === book.title);
    books.sort((a, b) => order(a.book) - order(b.book));
    const path = join(baselinesDir, `${genre}.json`);
    const previous = (await exists(path)) ? JSON.parse(await readFile(path, "utf-8")) : undefined;
    const built = buildBaseline(genre, books, previous?.bands);
    const sources = [...new Set(books.map(({ book }) => book.source ?? "local files"))].join(" and ");
    const baseline = {
      version: built.version,
      genre,
      provisional: false,
      note: `Measured from ${built.chapters} chapters of ${books.length} public-domain novels (texts from ${sources}). Floors and ceilings sit near the 5th and 95th percentiles of those chapters, every book weighing the same whatever its number of chapters.`,
      ...built,
    };
    await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`wrote baselines/${genre}.json from ${baseline.chapters} chapters`);
  }
}

async function sync() {
  const files = (await readdir(baselinesDir)).filter((file) => file.endsWith(".json")).sort();
  const entries = [];
  for (const file of files) {
    const baseline = JSON.parse(await readFile(join(baselinesDir, file), "utf-8"));
    entries.push(`  ${JSON.stringify(baseline.genre)}: ${JSON.stringify(baseline, null, 2).replace(/\n/g, "\n  ")},`);
  }
  const source = [
    "// Generated by scripts/baselines.mjs from baselines/*.json; do not edit by hand.",
    "// Run `pnpm --filter @plotlint/metrics baselines -- --sync` after editing a baseline file.",
    "import type { Baseline } from \"./bands.js\";",
    "",
    "export const BASELINES: Readonly<Record<string, Baseline>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
  await writeFile(join(root, "src", "baselines-data.ts"), source);
  console.log(`wrote src/baselines-data.ts (${files.length} genres)`);
}

if (!flag("--sync")) {
  if (flag("--download")) await download();
  await measure();
}
await sync();
