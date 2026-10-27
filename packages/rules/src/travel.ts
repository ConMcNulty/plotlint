import { z } from "zod";
import { nested, normalizeValue } from "./rules/facts.js";

// `travel.json`: how long it takes to get between the book's places, written by
// the author (or proposed by an agent and approved). Each route is the fastest
// way the story allows between two places, in the file's unit; the shortest path
// over all routes is the least time a journey can take. Places reached by no
// route are unknown, not unreachable, so the rules say nothing about them.
//
//   { "version": 1, "unit": "hours",
//     "places": { "the capital": { "aliases": ["Varn", "王都"] } },
//     "routes": [{ "from": "Calder Reach", "to": "the capital", "time": 72 }] }

export const TravelUnitSchema = z.enum(["minutes", "hours", "days"]);
export type TravelUnit = z.infer<typeof TravelUnitSchema>;

export const TravelRouteSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /** The fastest the story allows, in the file's unit. */
  time: z.number().nonnegative(),
  /** Routes run both ways unless this is false (a river current, a one-way portal). */
  bidirectional: z.boolean().default(true),
  /** How the journey is made ("by coach", "by the night ferry"), for the author. */
  note: z.string().optional(),
}).strict();
export type TravelRoute = z.infer<typeof TravelRouteSchema>;

export const TravelPlaceSchema = z.object({
  /** Other names for the place, as the prose and the settler write them. */
  aliases: z.array(z.string().min(1)).default([]),
  note: z.string().optional(),
}).strict();

export const TravelFileSchema = z.object({
  version: z.literal(1),
  unit: TravelUnitSchema.default("hours"),
  places: z.record(TravelPlaceSchema).default({}),
  routes: z.array(TravelRouteSchema).default([]),
}).strict();
export type TravelFile = z.infer<typeof TravelFileSchema>;

const UNIT_HOURS: Record<TravelUnit, number> = { minutes: 1 / 60, hours: 1, days: 24 };

/** A travel file as a weighted graph over normalized place names. */
export class TravelGraph {
  /** Normalized name or alias → the place's key. */
  readonly #names = new Map<string, string>();
  /** Place key → the name to show. */
  readonly #display = new Map<string, string>();
  readonly #edges = new Map<string, Map<string, number>>();
  readonly #distances = new Map<string, Map<string, number>>();

  constructor(file: TravelFile) {
    for (const [name, place] of Object.entries(file.places)) {
      const key = this.#place(name);
      for (const alias of place.aliases) {
        const normalized = normalizeValue(alias);
        if (normalized && !this.#names.has(normalized)) this.#names.set(normalized, key);
      }
    }
    const unit = UNIT_HOURS[file.unit];
    for (const route of file.routes) {
      const from = this.#place(route.from);
      const to = this.#place(route.to);
      this.#edge(from, to, route.time * unit);
      if (route.bidirectional) this.#edge(to, from, route.time * unit);
    }
  }

  #place(name: string): string {
    const normalized = normalizeValue(name);
    const existing = this.#names.get(normalized);
    if (existing) return existing;
    this.#names.set(normalized, normalized);
    this.#display.set(normalized, name.trim());
    return normalized;
  }

  #edge(from: string, to: string, hours: number): void {
    const edges = this.#edges.get(from) ?? new Map<string, number>();
    // Two routes between the same places: the faster one counts.
    edges.set(to, Math.min(edges.get(to) ?? Infinity, hours));
    this.#edges.set(from, edges);
  }

  /**
   * The place a free-text location names: an exact name or alias, else the one
   * place whose name it contains or is contained in ("the capital's south gate"
   * is the capital). Null when it names none, or more than one.
   */
  resolve(location: string): string | null {
    const normalized = normalizeValue(location);
    if (normalized === "") return null;
    const exact = this.#names.get(normalized);
    if (exact) return exact;
    const matches = new Set<string>();
    for (const [name, key] of this.#names) if (name.length >= 2 && nested(normalized, name)) matches.add(key);
    return matches.size === 1 ? [...matches][0]! : null;
  }

  display(key: string): string {
    return this.#display.get(key) ?? key;
  }

  /** The least time in hours to get from one place key to another; Infinity when no route joins them. */
  hours(from: string, to: string): number {
    if (from === to) return 0;
    let distances = this.#distances.get(from);
    if (!distances) {
      distances = this.#dijkstra(from);
      this.#distances.set(from, distances);
    }
    return distances.get(to) ?? Infinity;
  }

  #dijkstra(source: string): Map<string, number> {
    // Travel graphs are small (tens of places), so a linear scan for the nearest node is enough.
    const distances = new Map<string, number>([[source, 0]]);
    const done = new Set<string>();
    for (;;) {
      let current: string | undefined;
      for (const [node, distance] of distances) {
        if (!done.has(node) && (current === undefined || distance < distances.get(current)!)) current = node;
      }
      if (current === undefined) return distances;
      done.add(current);
      for (const [next, hours] of this.#edges.get(current) ?? []) {
        const distance = distances.get(current)! + hours;
        if (distance < (distances.get(next) ?? Infinity)) distances.set(next, distance);
      }
    }
  }
}
