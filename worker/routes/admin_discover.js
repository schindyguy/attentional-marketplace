import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';

export async function handleAdminDiscover(request, env) {
  const { DB } = env;

  if (request.method === 'GET') {
    const rows = await queryMany(DB, `SELECT key, value FROM admin_discover_settings`);
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return json({
      result_count: parseInt(s.result_count || '10', 10),
      pinned_brand_keys: JSON.parse(s.pinned_brand_keys || '[]'),
    });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const resultCount = Math.max(1, Math.min(50, parseInt(body.result_count ?? 10, 10)));
    const pinnedKeys = Array.isArray(body.pinned_brand_keys) ? body.pinned_brand_keys : [];

    await DB.prepare(
      `INSERT INTO admin_discover_settings (key, value) VALUES ('result_count', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(String(resultCount)).run();

    await DB.prepare(
      `INSERT INTO admin_discover_settings (key, value) VALUES ('pinned_brand_keys', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(JSON.stringify(pinnedKeys)).run();

    return json({ ok: true, result_count: resultCount, pinned_brand_keys: pinnedKeys });
  }

  return json({ error: 'Method not allowed' }, 405);
}
