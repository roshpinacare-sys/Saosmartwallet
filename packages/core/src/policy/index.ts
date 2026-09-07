/**
 * Saosmartwallet — policy layer barrel (layer 3).
 *
 * Consumers: `import { PolicyEngine, STATIC_RULES, defaultRuleSet } from
 * "…/packages/core/src/policy"`. All shared types live in `../types`.
 */

export { PolicyEngine } from "./engine";
export { STATIC_RULES, defaultRuleSet, formatSats } from "./defaults";
