import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';

export async function handleAdminDiscover(request, env) {
  const { DB } = env;

  if (request.method === 'GET') {
    const rows = await queryMany(DB, `SELECT key, value FROM admin_discover_settings`);
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return json({
      result_count: parseInt(s.result_count || '10', 10),
    });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const resultCount = Math.max(1, Math.min(50, parseInt(body.result_count ?? 10, 10)));

    await DB.prepare(
      `INSERT INTO admin_discover_settings (key, value) VALUES ('result_count', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(String(resultCount)).run();

    return json({ ok: true, result_count: resultCount });
  }

  return json({ error: 'Method not allowed' }, 405);
}
