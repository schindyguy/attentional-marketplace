// Rules engine for the recommendation pipeline.
//
// Rules are stored in the `recommendation_rules` table. Each rule has:
//   - conditions: AND-ed list evaluated against the advertiser's DNA
//   - action: force_include | exclude | boost
//   - brand_keys: target brands (same key space as handles.brand_name → brandKey())
//   - boost_points: signed integer used only when action='boost'
//
// Conflict policy (deterministic, priority-independent):
//   - exclude wins over force_include and boost
//   - force_include adds the brand if not already present
//   - boost values are summed per brand; negative values allowed (demote)
//
// Evaluation order uses ascending priority for deterministic trace output,
// even though the outcome does not depend on order.

export const SCALAR_FIELDS = ['audience_type', 'audience_gender', 'age_skew', 'sell_type', 'tone'];
export const ARRAY_FIELDS = ['categories', 'keywords'];
export const ALL_FIELDS = [...SCALAR_FIELDS, ...ARRAY_FIELDS];

const OPS_SCALAR = ['eq', 'ne', 'in'];
const OPS_ARRAY = ['contains_any', 'contains_all', 'contains_none'];

function getField(dna, field) {
  if (!dna || typeof dna !== 'object') return undefined;
  return dna[field];
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function normStr(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

// Evaluate a single condition against the DNA object.
// Returns false if the field is missing — conservative by design.
export function evalCondition(cond, dna) {
  if (!cond || typeof cond !== 'object') return false;
  const { field, op, value } = cond;
  if (!field || !op) return false;

  const raw = getField(dna, field);
  if (raw === undefined || raw === null) return false;

  if (ARRAY_FIELDS.includes(field)) {
    const haystack = toArray(raw).map(normStr);
    const needles = toArray(value).map(normStr);
    if (op === 'contains_any')  return needles.some(n => haystack.includes(n));
    if (op === 'contains_all')  return needles.every(n => haystack.includes(n));
    if (op === 'contains_none') return !needles.some(n => haystack.includes(n));
    return false;
  }

  if (SCALAR_FIELDS.includes(field)) {
    const h = normStr(raw);
    if (op === 'eq') return h === normStr(value);
    if (op === 'ne') return h !== normStr(value);
    if (op === 'in') return toArray(value).map(normStr).includes(h);
    return false;
  }

  return false;
}

// A rule matches when every condition passes.
// Empty conditions → matches unconditionally (= global rule).
export function evalRule(rule, dna) {
  const conds = safeJson(rule.conditions_json, []);
  if (!Array.isArray(conds) || conds.length === 0) return true;
  return conds.every(c => evalCondition(c, dna));
}

function safeJson(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// Core: evaluate all enabled rules, collect per-brand verdicts, return a trace.
// Input:
//   rules:   array of rule rows (enabled already filtered or not — we filter here)
//   dna:     parsed DNA object
// Output:
//   { fired, skipped, verdicts }
//     fired:   [{rule_id, rule_name, priority, action, brand_keys, boost_points}]
//     skipped: [{rule_id, reason}]
//     verdicts: Map<brand_key, { excluded_by?: rule, force_includes: rule[], boosts: rule[] }>
export function evaluateRules(rules, dna) {
  const fired = [];
  const skipped = [];
  const verdicts = new Map();

  const active = rules
    .filter(r => r.enabled && !r.deleted_at)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of active) {
    if (!evalRule(rule, dna)) {
      skipped.push({ rule_id: rule.id, rule_name: rule.name, reason: 'conditions_not_met' });
      continue;
    }

    const brandKeys = safeJson(rule.brand_keys_json, []);
    const summary = {
      rule_id: rule.id,
      rule_name: rule.name,
      priority: rule.priority,
      action: rule.action,
      brand_keys: brandKeys,
      boost_points: rule.boost_points | 0,
    };
    fired.push(summary);

    for (const bk of brandKeys) {
      if (!verdicts.has(bk)) verdicts.set(bk, { force_includes: [], boosts: [], excluded_by: null });
      const v = verdicts.get(bk);
      if (rule.action === 'exclude' && !v.excluded_by) v.excluded_by = summary;
      else if (rule.action === 'force_include')         v.force_includes.push(summary);
      else if (rule.action === 'boost')                 v.boosts.push(summary);
    }
  }

  return { fired, skipped, verdicts };
}

function formatReach(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

// Apply verdicts to a list of already-scored brand results.
// Mutates `scored` and returns the set of excluded + force-included brand_keys.
//
// brands:  Map<brand_key, {key, name, publisher, categories, total_reach}>
// scored:  existing scored results (from category overlap)
// verdicts: output of evaluateRules()
export function applyVerdicts(scored, brands, verdicts) {
  const excluded = [];
  const forceIncluded = new Set();
  const unknownRefs = [];

  // 1. Exclusions — drop from scored
  for (const [bk, v] of verdicts.entries()) {
    if (!v.excluded_by) continue;
    const idx = scored.findIndex(r => r.brand_key === bk);
    let removed = null;
    if (idx >= 0) removed = scored.splice(idx, 1)[0];
    const b = brands.get(bk);
    excluded.push({
      brand_key: bk,
      brand_name: removed?.brand_name ?? b?.name ?? bk,
      publisher_name: removed?.publisher_name ?? b?.publisher ?? null,
      excluded_by: v.excluded_by,
    });
  }

  // 2. Force-includes — add if missing
  for (const [bk, v] of verdicts.entries()) {
    if (v.excluded_by) continue;
    if (v.force_includes.length === 0) continue;
    if (!brands.has(bk)) {
      unknownRefs.push({ brand_key: bk, rules: v.force_includes });
      continue;
    }
    forceIncluded.add(bk);
    if (scored.find(r => r.brand_key === bk)) continue;
    const b = brands.get(bk);
    const ruleName = v.force_includes[0].rule_name;
    scored.push({
      brand_key: b.key,
      brand_name: b.name,
      publisher_name: b.publisher,
      score: 0,
      match_label: 'Featured',
      reason: `Recommended by rule: ${ruleName}`,
      matched_tags: b.categories.slice(0, 3),
      total_reach: b.total_reach,
      categories: b.categories,
    });
  }

  // 3. Boosts — sum onto score. Also surface dead refs.
  for (const [bk, v] of verdicts.entries()) {
    if (v.excluded_by) continue;
    if (v.boosts.length === 0) continue;
    if (!brands.has(bk)) {
      unknownRefs.push({ brand_key: bk, rules: v.boosts });
      continue;
    }
    const sum = v.boosts.reduce((a, r) => a + (r.boost_points | 0), 0);
    const target = scored.find(r => r.brand_key === bk);
    if (!target) continue; // boost on a brand the category pass didn't surface — ignore
    target.score = Math.max(0, Math.min(100, (target.score | 0) + sum));
    target.match_label = `${target.score}% match`;
  }

  // 4. Attach triggered_rules to each result for the debug view
  for (const r of scored) {
    const v = verdicts.get(r.brand_key);
    if (!v) continue;
    r.triggered_rules = [
      ...v.force_includes.map(s => ({ id: s.rule_id, name: s.rule_name, action: 'force_include' })),
      ...v.boosts.map(s => ({ id: s.rule_id, name: s.rule_name, action: 'boost', boost_points: s.boost_points })),
    ];
  }

  return { excluded, forceIncluded, unknownRefs };
}
