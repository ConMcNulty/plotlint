import type { RuleConfigFile } from "./book.js";
import { readRuleSetting } from "./registry.js";
import type { TextRule } from "./text.js";
import type { RuleSetting } from "./types.js";

/**
 * Apply a rule config (`rules.json`, or one built from check packs) to text rules,
 * the way `RuleRegistry.configure` does for state rules: rules set to `"off"` are
 * left out, a severity replaces the severity of every finding (judged findings
 * stay notes), and `options` reach the rule as `context.options`. Rules the
 * config does not name come back unchanged, so `configureTextRules(rules)` is a no-op.
 */
export function configureTextRules(rules: ReadonlyArray<TextRule>, config?: RuleConfigFile): TextRule[] {
  const configured: TextRule[] = [];
  for (const rule of rules) {
    const raw = config?.rules[rule.id] as RuleSetting | undefined;
    if (raw === undefined) {
      configured.push(rule);
      continue;
    }
    const { enabled, severity, options } = readRuleSetting(raw);
    if (!enabled) continue;
    configured.push({
      id: rule.id,
      layer: rule.layer,
      rationale: rule.rationale,
      async check(context) {
        const found = await rule.check({ ...context, options: { ...context.options, ...options } });
        return severity ? found.map((d) => (d.confidence === "judged" ? d : { ...d, severity })) : found;
      },
    });
  }
  return configured;
}
