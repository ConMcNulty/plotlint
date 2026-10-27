import type { DiagnosticSeverity } from "@plotlint/diagnostics";
import type { RuleConfigFile } from "./book.js";
import type { Rule, RuleSetting } from "./types.js";

/** A rule as a book's config sets it up: whether it runs, a severity override and its options. */
export interface ConfiguredRule {
  readonly rule: Rule;
  readonly enabled: boolean;
  /** Every finding of the rule takes this severity, when set. */
  readonly severity?: DiagnosticSeverity;
  readonly options: Readonly<Record<string, unknown>>;
}

function readSetting(setting: RuleSetting | undefined): Omit<ConfiguredRule, "rule"> {
  if (setting === undefined) return { enabled: true, options: {} };
  if (typeof setting === "string") {
    return setting === "off" ? { enabled: false, options: {} } : { enabled: true, severity: setting, options: {} };
  }
  const options = setting.options ?? {};
  if (setting.severity === "off") return { enabled: false, options };
  return { enabled: true, ...(setting.severity ? { severity: setting.severity } : {}), options };
}

/**
 * The rules the engine knows, by id. Rule ids are unique and stable, since
 * suppressions and book configs refer to them.
 */
export class RuleRegistry {
  readonly #rules = new Map<string, Rule>();

  constructor(rules: Iterable<Rule> = []) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: Rule): this {
    if (!/^[a-z]+\/[a-z0-9][a-z0-9.-]*$/u.test(rule.id)) throw new Error(`rule id "${rule.id}" is not <layer>/<kebab-name>`);
    if (!rule.id.startsWith(`${rule.layer}/`)) throw new Error(`rule ${rule.id} must start with its layer "${rule.layer}/"`);
    if (this.#rules.has(rule.id)) throw new Error(`rule ${rule.id} is already registered`);
    this.#rules.set(rule.id, rule);
    return this;
  }

  get(id: string): Rule | undefined {
    return this.#rules.get(id);
  }

  list(): Rule[] {
    return [...this.#rules.values()];
  }

  /** Every registered rule with the book's settings applied, in registration order. */
  configure(config?: RuleConfigFile): ConfiguredRule[] {
    return this.list().map((rule) => ({ rule, ...readSetting(config?.rules[rule.id] as RuleSetting | undefined) }));
  }

  /** Ids in a book's config that name no registered rule, usually typos. */
  unknownIds(config?: RuleConfigFile): string[] {
    return Object.keys(config?.rules ?? {}).filter((id) => !this.#rules.has(id));
  }
}
