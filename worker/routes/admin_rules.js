import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';
import { ALL_FIELDS, SCALAR_FIELDS, ARRAY_FIELDS } from '../lib/rules.js';
import { runRecommendationPipeline, normalizeDomain } from './discover.js';

const VALID_ACTIONS = ['force_include', 'exclude', 'boost'];
const VALID_OPS = {
  scalar: ['eq', 'ne', 'in'],
  array:  ['contains_any', 'contains_all', 'contains_none'],
};

function validateConditions(conds) {
  if (!Array.isArray(conds)) return 'conditions must be an array';
  for (const c of conds) {
    if (!c || typeof c !== 'object') return 'each condition must be an object';
    if (!ALL_FIELDS.includes(c.field)) return `unknown field: ${c.field}`;
    const ops = SCALAR_FIELDS.includes(c.field) ? VALID_OPS.scalar : VALID_OPS.array;
    if (!ops.includes(c.op)) return `op "${c.op}" not valid for field "${c.field}"`;
    if (c.value === undefined || c.value === null) return 'condition value required';
  }
  return null;
}

function validateRuleBody(body) {
  if (!body || typeof body !== 'object') return 'body must be an object';
  if (!body.name || typeof body.name !== 'string') return 'name required';
  if (!VALID_ACTIONS.includes(body.action)) return `action must be one of ${VALID_ACTIONS.join(', ')}`;
  const brandKeys = Array.isArray(body.brand_keys) ? body.brand_keys : null;
  if (!brandKeys || brandKeys.length === 0) return 'brand_keys must be a non-empty array';
  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  const condErr = validateConditions(conditions);
  if (condErr) return condErr;
  return null;
}

function ruleRowToPublic(row) {
  return {
    id:            row.id,
    name:          row.name,
    priority:      row.priority,
    enabled:       !!row.enabled,
    conditions:    safeJson(row.conditions_json, []),
    action:        row.action,
    brand_keys:    safeJson(row.brand_keys_json, []),
    boost_points:  row.boost_points,
    notes:         row.notes,
    fire_count:    row.fire_count,
    last_fired_at: row.last_fired_at,
    created_at:    row.created_at,
    updated_at:    row.updated_at,
  };
}

function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

export async function handleAdminRules(request, env) {
  const { DB } = env;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','admin','rules', ...]
  const tail = parts.slice(3); // anything after /api/admin/rules

  // GET /api/admin/rules  → list
  // POST /api/admin/rules → create
  if (tail.length === 0) {
    if (request.method === 'GET') {
      const rows = await queryMany(DB,
        `SELECT * FROM recommendation_rules WHERE deleted_at IS NULL
         ORDER BY priority ASC, id ASC`);
      return json({ rules: rows.map(ruleRowToPublic) });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const err = validateRuleBody(body);
      if (err) return json({ error: err }, 400);

      const res = await DB.prepare(
        `INSERT INTO recommendation_rules
          (name, priority, enabled, conditions_json, action, brand_keys_json, boost_points, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.name,
        body.priority ?? 100,
        body.enabled === false ? 0 : 1,
        JSON.stringify(body.conditions || []),
        body.action,
        JSON.stringify(body.brand_keys),
        body.action === 'boost' ? (body.boost_points | 0) : 0,
        body.notes || null,
      ).run();
      const id = res.meta.last_row_id;
      const row = await DB.prepare(`SELECT * FROM recommendation_rules WHERE id = ?`).bind(id).first();
      return json({ rule: ruleRowToPublic(row) }, 201);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // POST /api/admin/rules/test → dry-run pipeline for a domain
  if (tail[0] === 'test' && tail.length === 1) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const body = await request.json();
    const domain = normalizeDomain(body.domain || '');
    if (!domain || domain.length < 3 || !domain.includes('.')) {
      return json({ error: 'Invalid domain' }, 400);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
    try {
      // skipLog = true → test runs don't pollute the audit log or fire counters
      const out = await runRecommendationPipeline(env, domain, { skipLog: true });
      return json(out);
    } catch (e) {
      return json({ error: 'Analysis failed: ' + e.message }, 500);
    }
  }

  // GET /api/admin/rules/brand_keys → distinct brand_keys from handles (for UI picker)
  if (tail[0] === 'brand_keys' && tail.length === 1) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const rows = await queryMany(DB,
      `SELECT brand_name, SUM(followers) AS total_reach
       FROM handles WHERE status = 'active'
       GROUP BY brand_name
       ORDER BY total_reach DESC`);
    const items = rows.map(r => ({
      brand_key: brandKeyFromName(r.brand_name),
      brand_name: r.brand_name,
      total_reach: r.total_reach,
    }));
    return json({ brands: items });
  }

  // GET /api/admin/rules/log?limit=50 → recent recommendation log
  if (tail[0] === 'log' && tail.length === 1) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10)));
    const rows = await queryMany(DB,
      `SELECT id, domain, dna_json, triggered_rules, excluded_brands, result_keys, created_at
       FROM recommendation_log ORDER BY created_at DESC LIMIT ?`, [limit]);
    return json({
      entries: rows.map(r => ({
        id: r.id,
        domain: r.domain,
        dna: safeJson(r.dna_json, null),
        triggered_rules: safeJson(r.triggered_rules, []),
        excluded_brands: safeJson(r.excluded_brands, []),
        result_keys: safeJson(r.result_keys, []),
        created_at: r.created_at,
      })),
    });
  }

  // /api/admin/rules/:id → PATCH, DELETE
  const id = parseInt(tail[0], 10);
  if (!Number.isFinite(id)) return json({ error: 'Not found' }, 404);

  if (request.method === 'PATCH') {
    const body = await request.json();
    const existing = await DB.prepare(`SELECT * FROM recommendation_rules WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);

    const merged = {
      name:         body.name         ?? existing.name,
      priority:     body.priority     ?? existing.priority,
      enabled:      body.enabled      ?? !!existing.enabled,
      conditions:   body.conditions   ?? safeJson(existing.conditions_json, []),
      action:       body.action       ?? existing.action,
      brand_keys:   body.brand_keys   ?? safeJson(existing.brand_keys_json, []),
      boost_points: body.boost_points ?? existing.boost_points,
      notes:        body.notes        ?? existing.notes,
    };
    const err = validateRuleBody(merged);
    if (err) return json({ error: err }, 400);

    await DB.prepare(
      `UPDATE recommendation_rules SET
         name = ?, priority = ?, enabled = ?, conditions_json = ?,
         action = ?, brand_keys_json = ?, boost_points = ?, notes = ?,
         updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      merged.name,
      merged.priority,
      merged.enabled ? 1 : 0,
      JSON.stringify(merged.conditions),
      merged.action,
      JSON.stringify(merged.brand_keys),
      merged.action === 'boost' ? (merged.boost_points | 0) : 0,
      merged.notes || null,
      id,
    ).run();

    const row = await DB.prepare(`SELECT * FROM recommendation_rules WHERE id = ?`).bind(id).first();
    return json({ rule: ruleRowToPublic(row) });
  }

  if (request.method === 'DELETE') {
    await DB.prepare(`UPDATE recommendation_rules SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

function brandKeyFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
